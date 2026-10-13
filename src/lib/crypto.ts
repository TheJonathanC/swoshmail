import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "crypto";

/**
 * Hashes a plaintext password using PBKDF2/scrypt algorithm
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Verifies a password against a stored hash
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const [salt, hash] = storedHash.split(":");
    if (!salt || !hash) return false;
    const checkHash = scryptSync(password, salt, 64).toString("hex");
    return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(checkHash, "hex"));
  } catch (err) {
    console.error("Password verification error:", err);
    return false;
  }
}

const SHARE_SECRET = process.env.NEXTAUTH_SECRET || "swosh_drive_share_key_default";

/**
 * Generates a signed tamper-proof share token for a file
 */
export function generateShareToken(fileId: string, ownerId: string): string {
  const payload = Buffer.from(JSON.stringify({ f: fileId, o: ownerId, t: Date.now() })).toString("base64url");
  const signature = createHmac("sha256", SHARE_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/**
 * Verifies a share token signature and decodes payload
 */
export function verifyShareToken(token: string): { fileId: string; ownerId: string } | null {
  try {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expectedSignature = createHmac("sha256", SHARE_SECRET).update(payload).digest("base64url");
    if (signature.length !== expectedSignature.length) return null;
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return null;
    }
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    if (!data.f || !data.o) return null;
    return { fileId: data.f, ownerId: data.o };
  } catch {
    return null;
  }
}

