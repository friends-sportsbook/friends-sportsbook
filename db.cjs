const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("Missing MONGODB_URI environment variable");
}
const dbName = process.env.DB_NAME || "myapp";

let client;
let db;

async function getDb() {
  if (db) return db;

  client = new MongoClient(uri, { maxPoolSize: 10 });
  await client.connect();
  db = client.db(dbName);

  // Ensure a unique index on email (safe to call repeatedly)
  await db.collection("users").createIndex({ email: 1 }, { unique: true });

  return db;
}

module.exports = { getDb };
