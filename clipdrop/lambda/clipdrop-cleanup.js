const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");
const { S3Client, ListObjectsV2Command, DeleteObjectCommand } = require("@aws-sdk/client-s3");

const dbClient = new DynamoDBClient({ region: process.env.REGION });
const db = DynamoDBDocumentClient.from(dbClient);
const s3 = new S3Client({ region: process.env.REGION });

exports.handler = async (event) => {
  console.log("Starting ClipDrop cleanup of expired rooms...");

  try {
    const now = Math.floor(Date.now() / 1000);

    // Scan for expired rooms
    const result = await db.send(new ScanCommand({
      TableName: process.env.DYNAMODB_TABLE,
      FilterExpression: "expiresAt < :now",
      ExpressionAttributeValues: { ":now": now },
    }));

    const expiredRooms = result.Items || [];
    console.log(`Found ${expiredRooms.length} expired rooms to clean up`);

    for (const room of expiredRooms) {
      const roomCode = room.roomCode;
      console.log(`Cleaning up room: ${roomCode}`);

      // Delete all S3 objects for this room
      try {
        const prefix = `rooms/${roomCode}/`;
        let continuationToken;
        let deletedCount = 0;

        do {
          const listResult = await s3.send(new ListObjectsV2Command({
            Bucket: process.env.BUCKET_NAME,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }));

          const objects = listResult.Contents || [];
          for (const obj of objects) {
            await s3.send(new DeleteObjectCommand({
              Bucket: process.env.BUCKET_NAME,
              Key: obj.Key,
            }));
            deletedCount++;
          }

          continuationToken = listResult.NextContinuationToken;
        } while (continuationToken);

        console.log(`Deleted ${deletedCount} S3 objects for room ${roomCode}`);
      } catch (s3Err) {
        console.error(`Failed to delete S3 objects for room ${roomCode}:`, s3Err);
      }

      // Delete room from DynamoDB
      try {
        await db.send(new DeleteCommand({
          TableName: process.env.DYNAMODB_TABLE,
          Key: { roomCode },
        }));
        console.log(`Deleted room record: ${roomCode}`);
      } catch (dbErr) {
        console.error(`Failed to delete room record ${roomCode}:`, dbErr);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Successfully cleaned up ${expiredRooms.length} expired rooms`,
      }),
    };

  } catch (err) {
    console.error("Cleanup error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Cleanup failed" }),
    };
  }
};
