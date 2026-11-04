"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";
import type { Conversation, PresencePayload } from "@/types/api";
import { PRESENCE_HEARTBEAT_MS, PRESENCE_TICK_MS, isOnline, mergeLastSeen } from "@/lib/presence";
import { postPresence } from "./api";

/**
 * Server-authoritative presence (see src/lib/presence.ts).
 *
 * usePresenceHeartbeat: POST "online" now and every PRESENCE_HEARTBEAT_MS while the page is
 * visible. Hiding the tab only stops heartbeats (the server-side status then expires on its
 * own). On unload, POST "offline" (keepalive) unless another visible tab of the same user is
 * still sending heartbeats (tabs coordinate over a BroadcastChannel), so closing one of
 * several tabs does not flicker the user offline.
 * usePartnerPresence: last_seen_at per partner from the conversation list and "presence"
 * events, re-evaluated against the (skew-corrected) clock every PRESENCE_TICK_MS.
 */

let signedOff = false;

/** Sign-out: stop heartbeats and mark the user offline before the session cookie goes away. */
export async function signOffPresence(timeoutMs = 1500): Promise<void> {
  signedOff = true;
  await Promise.race([
    postPresence("offline", { keepalive: true }),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/** Sign-out failed: allow heartbeats again (the next interval tick marks the user online). */
export function resumePresence(): void {
  signedOff = false;
}

export function usePresenceHeartbeat(userId: string, onSkew: (skewMs: number) => void): void {
  const reportSkew = useEffectEvent((skewMs: number) => onSkew(skewMs));

  useEffect(() => {
    if (!userId) return;
    signedOff = false;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    let lastPeerBeat = 0;
    const tabs = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(`swosh-presence:${userId}`);
    if (tabs) {
      tabs.onmessage = (e: MessageEvent) => {
        if (e.data === "beat") lastPeerBeat = Date.now();
      };
    }

    const beat = () => {
      if (signedOff) return;
      tabs?.postMessage("beat");
      const sentAt = Date.now();
      void postPresence("online").then((res) => {
        if (!alive || !res) return;
        const receivedAt = Date.now();
        // Server clock minus our clock at the midpoint of the round trip.
        reportSkew(Date.parse(res.server_time) - (sentAt + receivedAt) / 2);
      });
    };
    const start = () => {
      if (timer !== null || signedOff) return;
      beat();
      timer = setInterval(beat, PRESENCE_HEARTBEAT_MS);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };
    const onPageHide = () => {
      stop();
      const peerAlive = Date.now() - lastPeerBeat < PRESENCE_HEARTBEAT_MS + 5_000;
      if (!signedOff && !peerAlive) void postPresence("offline", { keepalive: true });
    };

    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && document.visibilityState === "visible") start(); // back/forward cache restore
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    if (document.visibilityState === "visible") start();

    return () => {
      alive = false;
      // No "offline" here: under StrictMode this cleanup runs between two mounts and the
      // late offline could land after the next "online". Sign-out calls signOffPresence().
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      tabs?.close();
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [userId]);
}

export interface PartnerPresence {
  /** Partner ids currently considered online. */
  online: ReadonlySet<string>;
  /** Presence data has been loaded at least once. */
  known: boolean;
  applyList: (list: readonly Conversation[]) => void;
  applyEvent: (presence: PresencePayload) => void;
  setSkew: (skewMs: number) => void;
}

export function usePartnerPresence(): PartnerPresence {
  const [lastSeen, setLastSeen] = useState<Readonly<Record<string, string | null>>>({});
  const [known, setKnown] = useState(false);
  const [skew, setSkewState] = useState(0);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, PRESENCE_TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  const applyList = useCallback((list: readonly Conversation[]) => {
    setLastSeen((prev) => {
      const next: Record<string, string | null> = { ...prev };
      for (const c of list) next[c.other_user.id] = mergeLastSeen(prev[c.other_user.id], c.other_user.last_seen_at);
      return next;
    });
    setKnown(true);
    setNow(Date.now());
  }, []);

  const applyEvent = useCallback((p: PresencePayload) => {
    setLastSeen((prev) => ({ ...prev, [p.user_id]: p.online ? mergeLastSeen(prev[p.user_id], p.last_seen_at) : null }));
    setNow(Date.now());
  }, []);

  const setSkew = useCallback((skewMs: number) => {
    // Ignore jitter; only real clock differences matter against a 70 s window.
    if (Number.isFinite(skewMs)) setSkewState((prev) => (Math.abs(prev - skewMs) > 1000 ? Math.round(skewMs) : prev));
  }, []);

  const online = new Set<string>();
  if (now !== null) {
    const serverNow = now + skew;
    for (const [id, seen] of Object.entries(lastSeen)) if (isOnline(seen, serverNow)) online.add(id);
  }

  return { online, known: known && now !== null, applyList, applyEvent, setSkew };
}
