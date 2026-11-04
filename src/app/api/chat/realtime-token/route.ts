import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { HttpError, route } from "@/lib/http";
import { createRealtimeToken } from "@/lib/realtime";
import type { RealtimeTokenResponse } from "@/types/api";

// GET /api/chat/realtime-token -> short-lived Supabase JWT for private channels
export const GET = route("GET /api/chat/realtime-token", async () => {
  const user = await requireUser();
  await enforceRateLimit(`chat_rt_token_${user.id}`, 30, MINUTE);
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new HttpError(503, "Live updates are not available right now.", "realtime_unconfigured");
  }
  const res: RealtimeTokenResponse = createRealtimeToken(user.id, secret);
  return NextResponse.json(res, { headers: { "Cache-Control": "private, no-store" } });
});
