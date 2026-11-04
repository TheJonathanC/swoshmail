import { describe, expect, it } from "vitest";
import { isValidEmail, parseRecipients } from "@/lib/mail";

describe("recipient validation", () => {
  it("accepts plain addresses", () => {
    expect(isValidEmail("a@example.com")).toBe(true);
    expect(isValidEmail("first.last+tag@sub.example.co.uk")).toBe(true);
  });

  it("rejects smuggling and odd syntax", () => {
    for (const bad of [
      "a@b",
      "a@@example.com",
      "a@example.com\r\nBcc: x@y.com",
      '"quoted"@example.com',
      "Name <a@example.com>",
      "a@[127.0.0.1]",
      "a(comment)@example.com",
      ".a@example.com",
      "a..b@example.com",
      "=?utf-8?q?x?=@example.com",
      "group: a@example.com;",
    ]) {
      expect(isValidEmail(bad)).toBe(false);
    }
  });

  it("falls back to the default recipient when empty", () => {
    expect(parseRecipients("", "me@example.com")).toEqual({ ok: true, recipients: ["me@example.com"] });
    expect(parseRecipients("  ", "me@example.com")).toEqual({ ok: true, recipients: ["me@example.com"] });
    expect(parseRecipients(null, null).ok).toBe(false);
  });

  it("splits, trims and dedupes", () => {
    expect(parseRecipients(" a@example.com, b@example.com;A@example.com ", null)).toEqual({
      ok: true,
      recipients: ["a@example.com", "b@example.com"],
    });
  });

  it("caps at five recipients", () => {
    const five = Array.from({ length: 5 }, (_, i) => `u${i}@example.com`).join(",");
    const six = Array.from({ length: 6 }, (_, i) => `u${i}@example.com`).join(",");
    expect(parseRecipients(five, null).ok).toBe(true);
    expect(parseRecipients(six, null).ok).toBe(false);
  });

  it("rejects the whole list if any entry is invalid or contains header characters", () => {
    expect(parseRecipients("a@example.com, nope", null).ok).toBe(false);
    expect(parseRecipients("a@example.com\nBcc: b@example.com", null).ok).toBe(false);
    expect(parseRecipients("Bob <b@example.com>", null).ok).toBe(false);
  });
});
