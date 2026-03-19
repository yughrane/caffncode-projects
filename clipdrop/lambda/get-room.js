const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({ region: process.env.REGION });
const db = DynamoDBDocumentClient.from(client);

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
    if (!roomCode) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Room code is required" }),
      };
    }

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
    if (result.Item.expiresAt && result.Item.expiresAt < now) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Room has expired" }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result.Item),
    };
  } catch (err) {
    console.error("get-room error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to get room" }),
    };
  }
};