const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { CognitoIdentityProviderClient, GetUserCommand } = require("@aws-sdk/client-cognito-identity-provider");
const { S3Client, ListObjectsV2Command, DeleteObjectCommand } = require("@aws-sdk/client-s3");

const cognito = new CognitoIdentityProviderClient({ region: process.env.REGION });
const dbClient = new DynamoDBClient({ region: process.env.REGION });
const db = DynamoDBDocumentClient.from(dbClient);
const s3 = new S3Client({ region: process.env.REGION });

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: HEADERS, body: "" };
  }

  try {
    const token = (event.headers?.authorization || event.headers?.Authorization || "").replace("Bearer ", "");
    if (!token) {
      return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: "No token provided" }) };
    }

    // Verify user is authenticated
    await cognito.send(new GetUserCommand({ AccessToken: token }));

    const roomCode = event.pathParameters?.code?.toUpperCase();
    if (!roomCode) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "Room code is required" }) };
    }

    // Get room to verify it exists
    const roomResult = await db.send(new GetCommand({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { roomCode },
    }));

    if (!roomResult.Item) {
      return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: "Room not found" }) };
    }

    // Delete all S3 objects for this room
    let deletedS3Count = 0;
    try {
      const prefix = `rooms/${roomCode}/`;
      let continuationToken;

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
          deletedS3Count++;
        }

        continuationToken = listResult.NextContinuationToken;
      } while (continuationToken);

      console.log(`Deleted ${deletedS3Count} S3 objects for room ${roomCode}`);
    } catch (s3Err) {
      console.error(`Warning: Failed to delete some S3 objects for room ${roomCode}:`, s3Err);
      // Continue with DB update even if S3 cleanup fails
    }

    // Clear files array in DynamoDB (keep room, just empty it)
    await db.send(new UpdateCommand({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { roomCode },
      UpdateExpression: "SET files = :empty",
      ExpressionAttributeValues: { ":empty": [] },
    }));

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        success: true,
        message: `All contents deleted from room ${roomCode}`,
        deletedS3Objects: deletedS3Count,
      }),
    };

  } catch (err) {
    console.error("admin-clipdrop-delete-room-contents error:", err);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: "Failed to delete room contents" }),
    };
  }
};
