import { describe, expect, it } from "vitest";
import { signUploadToken, verifyUploadToken, type UploadTokenPayload } from "@/lib/upload-token";

const SECRET = "test-secret-that-is-long-enough";
const now = 1_800_000_000;
const payload: UploadTokenPayload = {
  u: "user-1",
  k: "drives/user-1/abc",
  n: "file.txt",
  f: null,
  r: null,
  t: "text/plain",
  s: 12,
  e: now + 60,
};

describe("upload token", () => {
  it("round-trips", () => {
    const token = signUploadToken(payload, SECRET);
    expect(verifyUploadToken(token, SECRET, now)).toEqual(payload);
  });

  it("rejects tampering", () => {
    const token = signUploadToken(payload, SECRET);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, u: "attacker" })).toString("base64url");
    expect(verifyUploadToken(`${forged}.${sig}`, SECRET, now)).toBeNull();
    expect(verifyUploadToken(`${body}.${sig.slice(0, -2)}xx`, SECRET, now)).toBeNull();
    expect(verifyUploadToken(`${body}`, SECRET, now)).toBeNull();
    expect(verifyUploadToken(123, SECRET, now)).toBeNull();
  });

  it("rejects a different secret", () => {
    const token = signUploadToken(payload, SECRET);
    expect(verifyUploadToken(token, "another-secret-long-enough", now)).toBeNull();
  });

  it("rejects expired tokens", () => {
    const token = signUploadToken(payload, SECRET);
    expect(verifyUploadToken(token, SECRET, now + 61)).toBeNull();
  });

  it("requires a configured secret (no fallback)", () => {
    const prev = process.env.NEXTAUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    try {
      expect(() => signUploadToken(payload)).toThrow(/NEXTAUTH_SECRET/);
      expect(() => signUploadToken(payload, "short")).toThrow(/NEXTAUTH_SECRET/);
    } finally {
      if (prev !== undefined) process.env.NEXTAUTH_SECRET = prev;
    }
  });
});
