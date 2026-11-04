import { scrypt as scryptCb, randomBytes, timingSafeEqual, type BinaryLike, type ScryptOptions } from "crypto";

const KEY_LENGTH = 64;

function scrypt(password: BinaryLike, salt: BinaryLike, keylen: number, options: ScryptOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Hashes a password with scrypt and a random salt: "<saltHex>:<hashHex>". Async (does not block the event loop). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `${salt}:${hash.toString("hex")}`;
}

/** Constant-time verification against a "<salt>:<hash>" string. */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const [salt, hash] = storedHash.split(":");
    if (!salt || !hash || !/^[0-9a-f]+$/i.test(hash)) return false;
    const expected = Buffer.from(hash, "hex");
    if (expected.length !== KEY_LENGTH) return false;
    const actual = await scrypt(password, salt, KEY_LENGTH);
    return timingSafeEqual(expected, actual);
  } catch (err) {
    console.error("Password verification error:", err);
    return false;
  }
}

/**
 * A valid-format hash of a random password, used to spend the same scrypt time for
 * unknown usernames so response timing does not reveal which usernames exist.
 */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  if (!dummyHash) dummyHash = hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}
