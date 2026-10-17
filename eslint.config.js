import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

// Web-style globals that plain Node has but Live's Extension Host doesn't.
// Keep in sync with MISSING_IN_LIVE in test/unit/server.test.ts.
const MISSING_IN_LIVE = ["URL", "URLSearchParams", "TextEncoder", "TextDecoder", "fetch", "Blob"];

export default tseslint.config(
  { ignores: ["dist/", "vendor/", "test-results/", "playwright-report/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  { files: ["ui/**"], languageOptions: { globals: globals.browser } },
  { files: ["*.ts", "*.js", "scripts/**", "test/**"], languageOptions: { globals: globals.node } },
  {
    files: ["src/**"],
    languageOptions: { globals: globals.node },
    rules: {
      "no-restricted-globals": [
        "error",
        ...MISSING_IN_LIVE.map((name) => ({
          name,
          message: `Live's Extension Host has no global ${name}; import it from a node:* module (or take it as a parameter in code shared with ui/).`,
        })),
      ],
    },
  },
  prettier,
);
