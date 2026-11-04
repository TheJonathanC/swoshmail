import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

import { HttpError } from "@/lib/http";
import {
  checkMemoryRateLimit,
  checkRateLimit,
  enforceRateLimit,
  rateLimitKeyCount,
  resetRateLimits,
  sweepRateLimits,
} from "@/lib/rate-limit";

describe("memory sliding-window layer", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit then blocks", () => {
    const t = 1_000_000;
    expect(checkMemoryRateLimit("k", 3, 1000, t).success).toBe(true);
    expect(checkMemoryRateLimit("k", 3, 1000, t + 1).success).toBe(true);
    const third = checkMemoryRateLimit("k", 3, 1000, t + 2);
    expect(third.success).toBe(true);
    expect(third.remaining).toBe(0);
    const blocked = checkMemoryRateLimit("k", 3, 1000, t + 3);
    expect(blocked.success).toBe(false);
    expect(blocked.reset).toBe(t + 1000);
  });

  it("slides: frees one slot as each hit ages out (no fixed-window burst)", () => {
    const t = 2_000_000;
    checkMemoryRateLimit("s", 2, 1000, t);
    checkMemoryRateLimit("s", 2, 1000, t + 500);
    expect(checkMemoryRateLimit("s", 2, 1000, t + 999).success).toBe(false);
    // First hit expires at t+1000; second still counts.
    expect(checkMemoryRateLimit("s", 2, 1000, t + 1001).success).toBe(true);
    expect(checkMemoryRateLimit("s", 2, 1000, t + 1002).success).toBe(false);
    expect(checkMemoryRateLimit("s", 2, 1000, t + 1501).success).toBe(true);
  });

  it("blocked requests do not extend the window", () => {
    const t = 3_000_000;
    checkMemoryRateLimit("b", 1, 1000, t);
    for (let i = 1; i < 10; i++) expect(checkMemoryRateLimit("b", 1, 1000, t + i * 50).success).toBe(false);
    expect(checkMemoryRateLimit("b", 1, 1000, t + 1001).success).toBe(true);
  });

  it("keys are independent", () => {
    const t = 4_000_000;
    checkMemoryRateLimit("a", 1, 1000, t);
    expect(checkMemoryRateLimit("a", 1, 1000, t).success).toBe(false);
    expect(checkMemoryRateLimit("b", 1, 1000, t).success).toBe(true);
  });

  it("evicts stale keys", () => {
    const t = 5_000_000;
    checkMemoryRateLimit("x", 5, 1000, t);
    checkMemoryRateLimit("y", 5, 10_000, t);
    expect(rateLimitKeyCount()).toBe(2);
    expect(sweepRateLimits(t + 2000)).toBe(1);
    expect(rateLimitKeyCount()).toBe(1);
    expect(sweepRateLimits(t + 20_000)).toBe(1);
    expect(rateLimitKeyCount()).toBe(0);
  });
});

describe("shared (database) layer", () => {
  beforeEach(() => {
    resetRateLimits();
    rpc.mockReset();
  });

  it("asks the database when memory allows, and the database decides (allow)", async () => {
    rpc.mockResolvedValue({ data: [{ allowed: true, remaining: 4, reset_ms: 60000 }], error: null });
    const before = Date.now();
    const r = await checkRateLimit("db_allow", 5, 60_000);
    expect(rpc).toHaveBeenCalledWith("swosh_rate_limit", { p_key: "db_allow", p_limit: 5, p_window_ms: 60_000 });
    expect(r.success).toBe(true);
    expect(r.remaining).toBe(4);
    expect(r.reset).toBeGreaterThanOrEqual(before + 60_000);
  });

  it("denies when the database denies even though this process is under the limit", async () => {
    rpc.mockResolvedValue({ data: [{ allowed: false, remaining: 0, reset_ms: "1500" }], error: null });
    const r = await checkRateLimit("db_deny", 5, 60_000);
    expect(r.success).toBe(false);
    expect(r.remaining).toBe(0);
    await expect(enforceRateLimit("db_deny", 5, 60_000, "slow")).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
      headers: { "Retry-After": "2" },
    });
  });

  it("a database denial does not consume a memory slot", async () => {
    rpc.mockResolvedValueOnce({ data: [{ allowed: false, remaining: 0, reset_ms: 100 }], error: null });
    rpc.mockResolvedValueOnce({ data: [{ allowed: true, remaining: 0, reset_ms: 100 }], error: null });
    expect((await checkRateLimit("db_undo", 1, 60_000)).success).toBe(false);
    expect((await checkRateLimit("db_undo", 1, 60_000)).success).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("rejects from memory without calling the database", async () => {
    rpc.mockResolvedValue({ data: [{ allowed: true, remaining: 0, reset_ms: 100 }], error: null });
    expect((await checkRateLimit("mem_first", 1, 60_000)).success).toBe(true);
    expect((await checkRateLimit("mem_first", 1, 60_000)).success).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("falls back to the memory result when the RPC errors, logging once", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "function not found" } });
    expect((await checkRateLimit("fb", 2, 60_000)).success).toBe(true);
    expect((await checkRateLimit("fb", 2, 60_000)).success).toBe(true);
    expect((await checkRateLimit("fb", 2, 60_000)).success).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    // After a failure the database is skipped for a while (no failing call per request).
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("falls back when the RPC throws or returns garbage", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockRejectedValueOnce(new Error("network down"));
    expect((await checkRateLimit("fb_throw", 1, 60_000)).success).toBe(true);
    resetRateLimits();
    rpc.mockResolvedValueOnce({ data: [{ nope: true }], error: null });
    expect((await checkRateLimit("fb_shape", 1, 60_000)).success).toBe(true);
  });

  it("enforceRateLimit resolves when allowed and throws HttpError otherwise", async () => {
    rpc.mockResolvedValue({ data: [{ allowed: true, remaining: 0, reset_ms: 1000 }], error: null });
    await expect(enforceRateLimit("enf", 1, 60_000)).resolves.toBeUndefined();
    await expect(enforceRateLimit("enf", 1, 60_000)).rejects.toBeInstanceOf(HttpError);
  });
});
