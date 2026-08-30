import tseslint from "typescript-eslint";

// Flat ESLint config for Architecture Studio.
// Lints the React frontend (src/) and the Express backend (server/).
// The converter/ directory is owned by another worker and is ignored.
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "server/dist/**",
      "converter/**",
      "*.lucid",
      "eslint.config.*",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "server/**/*.ts", "vite.config.ts"],
    rules: {
      // Unused vars are surfaced as warnings, not build-breaking errors.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Stubs/mocks legitimately use `any`; warn instead of erroring.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-function": "off",
    },
  },
);
