import { describe, expect, it } from "vitest";
import { decodeMessageContent, encodeMessageContent, orderParticipants } from "@/lib/chat-format";

const ID = "3f1c2a9e-1111-4222-8333-944455556666";

describe("message envelope", () => {
  it("round-trips plain text", () => {
    const d = decodeMessageContent(encodeMessageContent("hello"));
    expect(d).toEqual({ text: "hello", replyToId: null, snapshot: null, legacyReply: null });
  });

  it("round-trips replies with a server snapshot", () => {
    const raw = encodeMessageContent("yes", ID, { sender_id: "u1", content: "question?" });
    expect(JSON.parse(raw)).toMatchObject({ v: 1, text: "yes", reply_to_id: ID });
    const d = decodeMessageContent(raw);
    expect(d.text).toBe("yes");
    expect(d.replyToId).toBe(ID);
    expect(d.snapshot).toEqual({ sender_id: "u1", content: "question?" });
  });

  it("keeps user text that looks like JSON as text", () => {
    const tricky = '{"text":"fake","reply_to":{"id":"x","content":"forged","sender_name":"admin"}}';
    const d = decodeMessageContent(encodeMessageContent(tricky));
    expect(d.text).toBe(tricky);
    expect(d.replyToId).toBeNull();
    expect(d.legacyReply).toBeNull();
  });

  it("reads legacy plain strings", () => {
    expect(decodeMessageContent("just text").text).toBe("just text");
    expect(decodeMessageContent("{not json").text).toBe("{not json");
    expect(decodeMessageContent('{"a":1}').text).toBe('{"a":1}');
    expect(decodeMessageContent(null).text).toBe("");
  });

  it("reads legacy reply JSON", () => {
    const legacy = JSON.stringify({ text: "ok", reply_to: { id: ID, content: "orig", sender_name: "bob" } });
    const d = decodeMessageContent(legacy);
    expect(d.text).toBe("ok");
    expect(d.replyToId).toBe(ID);
    expect(d.legacyReply).toEqual({ id: ID, content: "orig", sender_name: "bob" });
  });

  it("does not treat partial legacy shapes as replies", () => {
    const d = decodeMessageContent(JSON.stringify({ text: "ok", reply_to: { id: 5 } }));
    expect(d.replyToId).toBeNull();
    const extra = decodeMessageContent(JSON.stringify({ text: "ok", reply_to: { id: ID, content: "c" }, x: 1 }));
    expect(extra.replyToId).toBeNull();
  });

  it("ignores snapshots without a reply id", () => {
    const raw = JSON.stringify({ v: 1, text: "t", reply_to_id: null, reply_snapshot: { sender_id: "a", content: "b" } });
    expect(decodeMessageContent(raw).snapshot).toBeNull();
  });
});

describe("orderParticipants", () => {
  it("orders ids consistently and case-insensitively", () => {
    const a = "0000aaaa-0000-4000-8000-000000000000";
    const b = "FFFF0000-0000-4000-8000-000000000000";
    expect(orderParticipants(a, b)).toEqual([a, b.toLowerCase()]);
    expect(orderParticipants(b, a)).toEqual([a, b.toLowerCase()]);
  });
});
