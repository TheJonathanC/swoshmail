import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  async rewrites() {
    return [
      {
        source: "/drive",
        destination: "/",
      },
      {
        source: "/mail",
        destination: "/",
      },
      {
        source: "/chat",
        destination: "/",
      },
    ];
  },
};

export default nextConfig;
