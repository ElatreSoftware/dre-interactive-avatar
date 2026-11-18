import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // ngrok hostnames rotate; this lets the current tunnel load /_next dev resources.
  allowedDevOrigins: ["*.ngrok-free.app"],
  // The SDK is vendored at vendor/, not installed. It has no entry in
  // package.json on purpose: `link:` is pnpm-only and broke `npm i`, and
  // `file:` asks a package manager to install something already in the repo.
  // What package.json does declare is what this code imports — livekit-client
  // and the rest.
  turbopack: {
    resolveAlias: {
      "@elatre/liveavatar-web-sdk": "./vendor/liveavatar-web-sdk/lib/index.esm.js",
    },
  },
  webpack: (config) => {
    config.resolve.alias["@elatre/liveavatar-web-sdk"] = path.resolve(
      "vendor/liveavatar-web-sdk/lib/index.esm.js",
    );
    return config;
  },
};

export default nextConfig;
