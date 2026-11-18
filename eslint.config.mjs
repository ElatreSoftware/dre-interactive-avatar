import js from "@eslint/js";
import tseslint from "typescript-eslint";
import next from "eslint-config-next";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      "packages/live-web-sdk/**",
      "packages/elatre-liveavatar-web-sdk/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...next,
  prettier,
  {
    // Type-aware rules only where a tsconfig actually covers the file.
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // Command-line tools: printing to stdout is what they are for, and a
    // warning on every line trains people to ignore warnings.
    files: ["scripts/**/*.mjs", "e2e/**/*.mjs"],
    rules: { "no-console": "off" },
  },
);
