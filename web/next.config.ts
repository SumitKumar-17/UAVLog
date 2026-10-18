import type { NextConfig } from "next";

// The browser only talks to this origin; /api/* is proxied to the FastAPI service (works unchanged on a remote server).
const API_URL = process.env.API_URL ?? "http://api:8000";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
