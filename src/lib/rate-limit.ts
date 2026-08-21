// Simple in-memory rate limiter
// Note: In serverless environments (Vercel) this is per-instance, but still provides effective burst protection.

type RateLimitInfo = {
  count: number;
  resetTime: number;
};

const rateLimits = new Map<string, RateLimitInfo>();

export function checkRateLimit(
  identifier: string,
  limit: number,
  windowMs: number
): { success: boolean; limit: number; remaining: number; reset: number } {
  const now = Date.now();
  const info = rateLimits.get(identifier);

  if (!info) {
    rateLimits.set(identifier, { count: 1, resetTime: now + windowMs });
    return { success: true, limit, remaining: limit - 1, reset: now + windowMs };
  }

  if (now > info.resetTime) {
    info.count = 1;
    info.resetTime = now + windowMs;
    return { success: true, limit, remaining: limit - 1, reset: info.resetTime };
  }

  if (info.count >= limit) {
    return { success: false, limit, remaining: 0, reset: info.resetTime };
  }

  info.count += 1;
  return { success: true, limit, remaining: limit - info.count, reset: info.resetTime };
}
