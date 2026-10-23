import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Cloudflare build output, local D1/R2 state and generated binding types.
    ".open-next/**",
    ".wrangler/**",
    "cloudflare-env.d.ts",
    // Git worktrees of parallel Claude Code sessions (their own copies and build output).
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
