import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { createRealtimeToken } from "@/lib/realtime";

describe("realtime token", () => {
  it("is a valid HS256 JWT with the expected claims", () => {
    const { token, expiresAt } = createRealtimeToken("user-1", "jwt-secret", 1000);
    const [h, p, s] = token.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toEqual({
      sub: "user-1",
      role: "authenticated",
      aud: "authenticated",
      iat: 1000,
      exp: 4600,
    });
    expect(s).toBe(createHmac("sha256", "jwt-secret").update(`${h}.${p}`).digest("base64url"));
    expect(expiresAt).toBe(4600 * 1000);
  });
});
