import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every ERP page is per-user and dynamic, so no incremental (ISR) cache is configured.
export default defineCloudflareConfig({});
