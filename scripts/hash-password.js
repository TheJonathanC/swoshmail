const crypto = require("crypto");

// Native scrypt hashing matching src/lib/crypto.ts
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log("Usage: node scripts/hash-password.js <username> <password>");
  process.exit(1);
}

const username = args[0];
const password = args[1];
const hashed = hashPassword(password);

console.log("\n==================================================");
console.log("             SWOSHMAIL USER SQL GENERATOR          ");
console.log("==================================================\n");
console.log(`Copy and paste this SQL query into your Supabase SQL Editor to create the user:\n`);
console.log(`INSERT INTO users (username, password_hash) `);
console.log(`VALUES ('${username}', '${hashed}');\n`);
console.log("==================================================");
