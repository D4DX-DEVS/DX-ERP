import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  // `src/lib/models/index.ts` imports "server-only", so drizzle-kit reads the plain barrel.
  schema: "./src/lib/models/_tables.ts",
  out: "./drizzle",
});
