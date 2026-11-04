import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

function origin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Supabase REST/Realtime origins (https + wss) for the browser client. */
function supabaseOrigins(): string[] {
  const o = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!o) return [];
  return [o, o.replace(/^http/, "ws")];
}

/** Object storage endpoint used by presigned direct uploads (path-style URLs). */
function storageOrigin(): string | null {
  if (process.env.R2_ENDPOINT) return origin(process.env.R2_ENDPOINT);
  return process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null;
}

function contentSecurityPolicy(): string {
  const connect = ["'self'", ...supabaseOrigins(), storageOrigin()].filter(Boolean);
  if (isDev) connect.push("ws:", "wss:"); // dev server HMR
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:"],
    "media-src": ["'self'", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": connect as string[],
    "worker-src": ["'self'", "blob:"],
    "frame-src": ["'self'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!isDev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  // next/image is not used (files are served by authenticated API routes); disabling
  // the optimizer also removes the image-optimizer attack surface.
  images: { unoptimized: true },
  async rewrites() {
    return [
      { source: "/drive", destination: "/" },
      { source: "/mail", destination: "/" },
      { source: "/chat", destination: "/" },
    ];
  },
  async headers() {
    return [
      // Pages and static assets: full policy.
      { source: "/((?!api/).*)", headers: securityHeaders },
      // API routes return JSON or file streams that set their own CSP/framing headers
      // (see src/lib/files.ts fileResponseHeaders), so only the generic headers here.
      {
        source: "/api/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
