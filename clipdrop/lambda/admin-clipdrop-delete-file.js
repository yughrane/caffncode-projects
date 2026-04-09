const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { CognitoIdentityProviderClient, GetUserCommand } = require("@aws-sdk/client-cognito-identity-provider");
const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");

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
    const fileName = event.pathParameters?.filename;

    if (!roomCode || !fileName) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "Room code and filename are required" }) };
    }

    // Get room to find file
    const roomResult = await db.send(new GetCommand({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { roomCode },
    }));

    if (!roomResult.Item) {
      return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: "Room not found" }) };
    }

    // Find the file in the files array
    const files = roomResult.Item.files || [];
    const fileIndex = files.findIndex(f => f.fileName === fileName);

    if (fileIndex === -1) {
      return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: "File not found in room" }) };
    }

    const fileToDelete = files[fileIndex];

    // Delete from S3
    try {
      await s3.send(new DeleteObjectCommand({
        Bucket: process.env.BUCKET_NAME,
        Key: fileToDelete.s3Key,
      }));
      console.log(`Deleted S3 object: ${fileToDelete.s3Key}`);
    } catch (s3Err) {
      console.error(`Warning: Failed to delete S3 object ${fileToDelete.s3Key}:`, s3Err);
      // Continue with DB update even if S3 deletion fails
    }

    // Remove from DynamoDB files array
    files.splice(fileIndex, 1);
    await db.send(new UpdateCommand({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { roomCode },
      UpdateExpression: "SET files = :files",
      ExpressionAttributeValues: { ":files": files },
    }));

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        success: true,
        message: `File ${fileName} deleted from room ${roomCode}`,
      }),
    };

  } catch (err) {
    console.error("admin-clipdrop-delete-file error:", err);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: "Failed to delete file" }),
    };
  }
};
