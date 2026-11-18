import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // ngrok hostnames rotate; this lets the current tunnel load /_next dev resources.
  allowedDevOrigins: ["*.ngrok-free.app"],
  // The SDK is installed at node_modules/@elatre rather than under its package name.
  turbopack: {
    resolveAlias: { "@elatre/liveavatar-web-sdk": "./node_modules/@elatre/lib/index.esm.js" },
  },
  webpack: (config) => {
    config.resolve.alias["@elatre/liveavatar-web-sdk"] = path.resolve(
      "node_modules/@elatre/lib/index.esm.js",
    );
    return config;
  },
};

export default nextConfig;
