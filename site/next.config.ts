import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The site is its own app inside the studio's repo; without this Turbopack would pick the repo root.
  turbopack: { root: path.resolve(__dirname) },
  devIndicators: false,
};

export default nextConfig;
