#!/usr/bin/env node
// Generates the SQL to create a Swosh user. Hash format matches src/lib/crypto.ts
// (scrypt, 16-byte random salt, 64-byte key: "<saltHex>:<hashHex>").
//
// Usage: node scripts/hash-password.mjs <username> <password>
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scryptAsync(password, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.log("Usage: node scripts/hash-password.mjs <username> <password>");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const hashed = await hashPassword(password);
const safeUsername = username.replace(/'/g, "''");

console.log("\nRun this in the Supabase SQL Editor to create the user:\n");
console.log(`INSERT INTO users (username, password_hash) VALUES ('${safeUsername}', '${hashed}');\n`);
