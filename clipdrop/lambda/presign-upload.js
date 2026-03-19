const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const dbClient = new DynamoDBClient({ region: process.env.REGION });
const db = DynamoDBDocumentClient.from(dbClient);
const s3 = new S3Client({ region: process.env.REGION });

const MAX_SIZES = {
  "10mb":  10  * 1024 * 1024,
  "50mb":  50  * 1024 * 1024,
  "200mb": 200 * 1024 * 1024,
  "500mb": 500 * 1024 * 1024,
};

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
    const body = JSON.parse(event.body || "{}");
    const { fileName, fileSize, fileType } = body;

    if (!roomCode || !fileName || !fileSize) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "roomCode, fileName and fileSize are required" }),
      };
    }

    // Fetch room to validate it exists + check max size
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

    const maxBytes = MAX_SIZES[result.Item.maxSize] || MAX_SIZES["50mb"];
    if (fileSize > maxBytes) {
      return {
        statusCode: 413,
        headers,
        body: JSON.stringify({ error: `File exceeds max size of ${result.Item.maxSize}` }),
      };
    }

    // S3 key: rooms/CAFF-4829/filename
    const s3Key = `rooms/${roomCode}/${fileName}`;

    // Generate presigned PUT URL (expires in 15 min)
    const command = new PutObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: s3Key,
      ContentType: fileType || "application/octet-stream",
      ContentLength: fileSize,
    });

    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 900 });

    // Update DynamoDB room record with file metadata
    await db.send(new UpdateCommand({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { roomCode },
      UpdateExpression: "SET files = list_append(if_not_exists(files, :empty), :file)",
      ExpressionAttributeValues: {
        ":empty": [],
        ":file": [{
          fileName,
          fileSize,
          fileType: fileType || "application/octet-stream",
          s3Key,
          uploadedAt: now,
        }],
      },
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ presignedUrl, s3Key }),
    };
  } catch (err) {
    console.error("presign-upload error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to generate upload URL" }),
    };
  }
};