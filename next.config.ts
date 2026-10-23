import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: path.resolve(__dirname) },
  // Every corner of the studio holds chrome (rail, design panel, splash), so the route indicator is
  // off. Compile and runtime errors still surface in the error overlay.
  devIndicators: false,
};

export default nextConfig;
