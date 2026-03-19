const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({ region: process.env.REGION });
const db = DynamoDBDocumentClient.from(client);

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode() {
  let code = "";
  for (let i = 0; i < 4; i++) code += CHARS[Math.floor(Math.random() * CHARS.length)];
  code += "-";
  for (let i = 0; i < 4; i++) code += CHARS[Math.floor(Math.random() * CHARS.length)];
  return code;
}

function getExpirySeconds(expiry) {
  const map = {
    "10m":  10 * 60,
    "30m":  30 * 60,
    "1h":   60 * 60,
    "6h":   6 * 60 * 60,
    "24h":  24 * 60 * 60,
    "close": 24 * 60 * 60, // treat "on tab close" as 24h server-side
  };
  return map[expiry] || 30 * 60;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "https://projects.caffncode.com",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  // Handle preflight
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { expiry = "30m", maxSize = "50mb", roomName = "" } = body;

    const roomCode = generateCode();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + getExpirySeconds(expiry);

    await db.send(new PutCommand({
      TableName: process.env.DYNAMODB_TABLE,
      Item: {
        roomCode,
        roomName: roomName || "",
        expiry,
        maxSize,
        files: [],
        createdAt: now,
        expiresAt, // DynamoDB TTL attribute
      },
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        roomCode,
        expiry,
        maxSize,
        expiresAt,
        createdAt: now,
      }),
    };
  } catch (err) {
    console.error("create-room error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to create room" }),
    };
  }
};