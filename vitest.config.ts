import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@elatre/liveavatar-web-sdk": fileURLToPath(
        new URL("./vendor/liveavatar-web-sdk/lib/index.esm.js", import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/app/**/{layout,page}.tsx", "src/**/*.d.ts"],
      thresholds: {
        lines: 70,
        "src/avatar/**": { lines: 85, branches: 85, functions: 85, statements: 85 },
      },
    },
  },
});
