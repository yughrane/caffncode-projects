const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { CognitoIdentityProviderClient, GetUserCommand } = require("@aws-sdk/client-cognito-identity-provider");

const cognito = new CognitoIdentityProviderClient({ region: process.env.REGION });
const dbClient = new DynamoDBClient({ region: process.env.REGION });
const db = DynamoDBDocumentClient.from(dbClient);

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
    const cognitoUser = await cognito.send(new GetUserCommand({ AccessToken: token }));
    const username = cognitoUser.Username;

    // Check if user is admin (optional: could check if super_admin)
    const adminProfile = await db.send(new GetCommand({
      TableName: process.env.ADMINS_TABLE,
      Key: { username },
    }));

    if (!adminProfile.Item) {
      return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: "Access denied" }) };
    }

    // Scan all rooms
    const result = await db.send(new ScanCommand({
      TableName: process.env.DYNAMODB_TABLE,
    }));

    const now = Math.floor(Date.now() / 1000);
    const rooms = (result.Items || []).map(room => ({
      roomCode: room.roomCode,
      roomName: room.roomName || "(Unnamed)",
      expiry: room.expiry || "unknown",
      maxSize: room.maxSize || "50mb",
      fileCount: (room.files || []).length,
      totalSize: (room.files || []).reduce((sum, f) => sum + (f.fileSize || 0), 0),
      createdAt: room.createdAt || null,
      expiresAt: room.expiresAt || null,
      isExpired: room.expiresAt && room.expiresAt < now,
      timeToExpire: room.expiresAt ? Math.max(0, room.expiresAt - now) : null,
    }));

    // Sort by creation time, newest first
    rooms.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ rooms, total: rooms.length }),
    };

  } catch (err) {
    console.error("admin-clipdrop-list-rooms error:", err);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: "Failed to list rooms" }),
    };
  }
};
