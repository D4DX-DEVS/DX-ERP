# D4DX ERP — notes for AI assistants

@AGENTS.md

- Read `docs/CONVENTIONS.md` before changing code: page / server-action / form patterns, UI kit,
  access rules, time-zone and money handling. Requirements live in `docs/FRS.md`; visual design
  sources in `docs/design/*.dc.html`.
- Next.js 16: `params`/`searchParams` are Promises, `src/proxy.ts` replaces middleware, Cache
  Components are disabled (every page is dynamic). Bundled docs: `node_modules/next/dist/docs/`.
- Data: Cloudflare D1 (SQLite) via Drizzle — read `docs/D1-DRIZZLE.md` (D1 limits: 100 bound params, 50 queries
  per request on the free plan; use `inList`, no queries in loops). Files: R2 bindings. Hosting: Workers via OpenNext.
- Authorisation is enforced server-side in every page and action (`requirePagePermission`,
  `actionPermission`, scoped queries). The single Super Admin is configured only via env vars.
- ESLint runs React-compiler rules: no synchronous setState in effects (use `useNow` from
  `components/ui/use-now`), no `Date.now()` in component bodies (move it to a lib helper).
- Verify with `npm run typecheck` and `npm run lint`; `npm run build` before shipping; `npm run preview` runs the
  Workers runtime locally. Deploy only with `npm run deploy` (keeps local .env secrets out of the bundle).
