import { describe, expect, it } from "vitest";
import {
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_MIN_REFRESH_MS,
  PRESENCE_ONLINE_WINDOW_MS,
  isOnline,
  isPresenceState,
  mergeLastSeen,
  presenceRefreshCutoff,
} from "@/lib/presence";
import { isConversationListItem, isPresencePayload, normalizeConversationListItem } from "@/hooks/chat/guards";
import { collectNewIncoming, seedSeenIds } from "@/hooks/chat/unread";

const T = Date.parse("2026-11-04T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("isOnline", () => {
  it("is false for null, undefined and garbage", () => {
    expect(isOnline(null, T)).toBe(false);
    expect(isOnline(undefined, T)).toBe(false);
    expect(isOnline("not a date", T)).toBe(false);
  });

  it("is true inside the window and false at/after its end", () => {
    expect(isOnline(iso(T), T)).toBe(true);
    expect(isOnline(iso(T - 69_999), T)).toBe(true);
    expect(isOnline(iso(T - PRESENCE_ONLINE_WINDOW_MS), T)).toBe(false);
    expect(isOnline(iso(T - 5 * 60_000), T)).toBe(false);
  });

  it("tolerates moderate future skew but not absurd timestamps", () => {
    expect(isOnline(iso(T + 5_000), T)).toBe(true);
    expect(isOnline(iso(T + 24 * 3600_000), T)).toBe(false);
  });

  it("window covers the worst refresh gap so active users never flicker", () => {
    expect(PRESENCE_MIN_REFRESH_MS + PRESENCE_HEARTBEAT_MS).toBeLessThan(PRESENCE_ONLINE_WINDOW_MS);
  });
});

describe("presence helpers", () => {
  it("isPresenceState", () => {
    expect(isPresenceState("online")).toBe(true);
    expect(isPresenceState("offline")).toBe(true);
    expect(isPresenceState("away")).toBe(false);
    expect(isPresenceState(undefined)).toBe(false);
  });

  it("presenceRefreshCutoff is now minus the refresh interval", () => {
    expect(presenceRefreshCutoff(T)).toBe(iso(T - PRESENCE_MIN_REFRESH_MS));
  });

  it("mergeLastSeen keeps the newer timestamp and lets offline win", () => {
    expect(mergeLastSeen(undefined, iso(T))).toBe(iso(T));
    expect(mergeLastSeen(iso(T), iso(T - 1000))).toBe(iso(T));
    expect(mergeLastSeen(iso(T - 1000), iso(T))).toBe(iso(T));
    expect(mergeLastSeen(iso(T), null)).toBeNull();
    expect(mergeLastSeen("bad", iso(T))).toBe(iso(T));
  });
});

describe("presence / list guards", () => {
  it("accepts consistent presence payloads only", () => {
    expect(isPresencePayload({ user_id: "u", online: true, last_seen_at: iso(T) })).toBe(true);
    expect(isPresencePayload({ user_id: "u", online: false, last_seen_at: null })).toBe(true);
    expect(isPresencePayload({ user_id: "u", online: true, last_seen_at: null })).toBe(false);
    expect(isPresencePayload({ user_id: "u", online: false, last_seen_at: iso(T) })).toBe(false);
    expect(isPresencePayload({ user_id: "", online: false, last_seen_at: null })).toBe(false);
    expect(isPresencePayload({ user_id: "u", online: "yes", last_seen_at: null })).toBe(false);
  });

  it("validates and normalizes conversation list items", () => {
    const base = { id: "c", save_messages: false, other_user: { id: "o", username: "bob" } };
    expect(isConversationListItem(base)).toBe(true);
    expect(normalizeConversationListItem(base as never)).toEqual({
      ...base,
      other_user: { ...base.other_user, last_seen_at: null },
      recent_incoming_ids: [],
    });
    expect(isConversationListItem({ ...base, recent_incoming_ids: ["a", "b"] })).toBe(true);
    expect(isConversationListItem({ ...base, recent_incoming_ids: [1] })).toBe(false);
    expect(isConversationListItem({ ...base, other_user: { ...base.other_user, last_seen_at: "nope" } })).toBe(false);
  });
});

describe("polling unread helpers", () => {
  it("seeds existing ids, then counts only new ones outside the viewed conversation", () => {
    const seen = new Set<string>();
    seedSeenIds([{ id: "c1", recent_incoming_ids: ["m1", "m2"] }], seen);
    expect(collectNewIncoming([{ id: "c1", recent_incoming_ids: ["m1", "m2"] }], seen, null)).toEqual({});
    const list = [
      { id: "c1", recent_incoming_ids: ["m4", "m3", "m1"] },
      { id: "c2", recent_incoming_ids: ["n1"] },
    ];
    expect(collectNewIncoming(list, seen, "c2")).toEqual({ c1: 2 });
    // Same ids again (or already counted via realtime) are never counted twice.
    seen.add("m5");
    expect(collectNewIncoming([{ id: "c1", recent_incoming_ids: ["m5", "m4"] }], seen, null)).toEqual({});
    expect(seen.has("n1")).toBe(true);
  });
});
