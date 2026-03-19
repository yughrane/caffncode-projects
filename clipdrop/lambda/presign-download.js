const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const dbClient = new DynamoDBClient({ region: process.env.REGION });
const db = DynamoDBDocumentClient.from(dbClient);
const s3 = new S3Client({ region: process.env.REGION });

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "https://projects.caffncode.com",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const roomCode = event.pathParameters?.code?.toUpperCase();
    const fileName = event.pathParameters?.filename;

    if (!roomCode || !fileName) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "roomCode and filename are required" }),
      };
    }

    // Validate room exists and hasn't expired
    const result = await db.send(new GetCommand({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { roomCode },
    }));

    if (!result.Item) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Room not found or expired" }),
      };
    }

    const now = Math.floor(Date.now() / 1000);
    if (result.Item.expiresAt < now) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Room has expired" }),
      };
    }

    // Verify file belongs to this room
    const fileExists = result.Item.files?.some(f => f.fileName === fileName);
    if (!fileExists) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "File not found in this room" }),
      };
    }

    const s3Key = `rooms/${roomCode}/${fileName}`;

    // Generate presigned GET URL (expires in 1 hour)
    const command = new GetObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: s3Key,
      ResponseContentDisposition: `attachment; filename="${fileName}"`,
    });

    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ presignedUrl }),
    };
  } catch (err) {
    console.error("presign-download error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to generate download URL" }),
    };
  }
};