# D4DX ERP

Internal ERP for **D4DX Innovations LLP** — people, attendance, office movements, leave, payroll,
projects, timesheets, QA, CRM, proposals, contracts, invoicing, expenses, assets, reports and
administration in one responsive web app (desktop, tablet and phone).

Built with Next.js 16 (App Router), React 19 and Tailwind CSS 4, hosted on **Cloudflare Workers**
(via OpenNext) with **Cloudflare D1** (SQLite, through Drizzle ORM) as the database and **Cloudflare R2**
for files. Database guide: [`docs/D1-DRIZZLE.md`](docs/D1-DRIZZLE.md). Requirements: [`docs/FRS.md`](docs/FRS.md). Engineering
conventions: [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md). Visual design sources: `docs/design/`.

---

## 1. Quick start

```bash
npm install
cp .env.example .env.local   # then fill in the values (see below)
npm run db:migrate:local     # create the tables in the local D1 (.wrangler/state)
npm run dev                  # http://localhost:3000 — uses the local D1 + R2 simulators
npm run preview              # the real Workers runtime (workerd) locally
```

Production runs on Cloudflare — see **7. Deploying to Cloudflare**. Requires Node.js 20.19+ (22 LTS recommended).

## 2. Environment variables

All configuration lives in environment variables — see [`.env.example`](.env.example) (local) and
[`.env.cloudflare.example`](.env.cloudflare.example) (production Worker secrets). The database (`DB`) and the
file buckets (`FILES`, `PUBLIC_FILES`) are Worker **bindings** in `wrangler.jsonc`, not variables.

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public URL (no trailing slash). Used for OAuth redirects and links in emails. |
| `AUTH_SECRET` | ≥ 32 random characters for signing sessions (`openssl rand -base64 48`). |
| `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_NAME` | The single Super Admin account. |
| `SUPER_ADMIN_PASSWORD` | Super Admin password for development (use 12+ characters). Leave empty in production. |
| `SUPER_ADMIN_PASSWORD_HASH` | **Production:** scrypt hash from `npm run hash-password`, used instead of the plain password. |
| `SUPER_ADMIN_TOTP_SECRET` | **Production:** base32 TOTP secret — the admin sign-in then also needs an authenticator code. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in for staff. |
| `GOOGLE_ALLOWED_DOMAIN` | **Production:** restrict sign-in to your Workspace domain. Without it any Google account whose address matches a staff record can sign in as that person. |
| `PUBLIC_FILES_URL` | Public URL of the `dx-erp-public` R2 bucket (r2.dev or custom domain) for photos and the logo; empty = served through the app. |
| `FILES_FOLDER` | Key prefix inside the R2 buckets (default `dx-erp`). |
| `CRON_SECRET` | Protects `/api/cron` (scheduled reminders and backups). |
| `NEXT_PUBLIC_APP_TIMEZONE` | Company time zone (default `Asia/Kolkata`). |
| `SMTP_*` | Optional email delivery of notifications. |

## 3. How sign-in works

* **Super Admin (exactly one).** Credentials come only from `SUPER_ADMIN_EMAIL` and
  `SUPER_ADMIN_PASSWORD`. On the sign-in page choose
  **Administrator sign in**. The account record is created automatically on first sign-in, together
  with the built-in roles, default leave types, departments and designations. Change the password
  by changing the environment variable. Failed attempts are rate-limited (5 per 15 minutes) and
  audited. **In production set `SUPER_ADMIN_PASSWORD_HASH`** (from `npm run hash-password`) instead of
  the plain password, **and `SUPER_ADMIN_TOTP_SECRET`** so an authenticator code is required at sign-in.
* **Staff (employees, trainees, interns) sign in with Google only.** The Super Admin (or anyone
  granted *Add employees* + *Activate login access*) adds the person under **People → Staff → Add
  person** with their work email and enables **login access**. Only that exact Google email can then
  sign in. Disabling access, changing the role or completing an exit signs the person out
  everywhere.

### Google OAuth setup

1. Google Cloud Console → **APIs & Services → Credentials → Create credentials → OAuth client ID**
   (type *Web application*).
2. **Authorised JavaScript origins:** your `APP_URL` (e.g. `https://erp.d4dx.co`, and
   `http://localhost:3000` for development).
3. **Authorised redirect URIs:** `${APP_URL}/api/auth/google/callback`.
4. Configure the OAuth consent screen (Internal for a Google Workspace org).
5. Put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

### File storage (R2)

Two R2 buckets, bound to the Worker: `dx-erp-files` (binding `FILES`, private — documents, receipts,
contracts, backups; streamed by `/api/files/<id>` only after a permission check) and `dx-erp-public`
(binding `PUBLIC_FILES` — profile photos and the company logo). Uploads go through the server, so no CORS rules
or access keys are needed. Backups go to `<FILES_FOLDER>/backups/`.

### First-run checklist (Super Admin)

1. **Configuration → Company profile**: legal name, address, GSTIN, logo, bank details for invoices.
2. **Configuration → Working days & attendance**: office hours, grace, full/half-day minutes and
   **Attendance tracked from** = your go-live date (earlier days are never counted as absent / loss of pay).
3. **Holidays**, **Leave categories & policies**, **Movement categories**, **Payroll & stipend components**
   (review statutory deductions with your accountant), numbering and document templates.
4. **Roles & access**: review the default permission matrix per role.
5. **People → Staff → Add person** (or **Import CSV**) with each person's Google work email and
   **login access** enabled; set reporting managers so approvals route correctly.

## 4. Roles and permissions

Built-in roles follow the FRS: Super Admin, Management, HR / Admin, Finance / Accounts, Business
Development, Project Manager, Team Lead, Employee, Trainee and Intern. Every role's permissions
are editable in **Admin → Roles & access** (custom roles can be added). Everyone always has
self-service access to their own attendance, movements, leave, tasks, timesheets, expenses and
payslips; reporting managers can review and approve their direct reports. Salary, bank details,
confidential documents, personal movement details and restricted clients are only shown to roles
with the corresponding permission. Every significant change is written to the **audit trail**.

## 5. Scheduled jobs

Reminders and housekeeping (overdue movements and missing In-Time, missing check-outs, leave and
approval reminders, task and milestone deadlines, follow-ups, contract/proposal expiry, overdue
invoices, document and warranty expiry, retention purges, daily backups) run
from a Cloudflare **Cron Trigger** every 15 minutes (`triggers.crons` in `wrangler.jsonc`). The entry point
`cloudflare/worker.ts` calls `/api/cron` with `Authorization: Bearer <CRON_SECRET>` through the Worker's own service
binding, three due jobs per call, repeating while jobs are pending — so each call stays inside the free plan's
50-queries-per-request limit. Each job is throttled to its own interval. The endpoint can also be called manually
(`?force=1` runs every job, `?only=<name>` one job, `?max=<n>` jobs per call):

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://dx-erp.<subdomain>.workers.dev/api/cron
```

## 6. Backups and restore

**Admin → Configuration → Backup & restore** (permission *Run backups and restore data*): run a
backup on demand (all business tables, gzip-compressed JSON in the private R2 bucket), verify a
backup without writing anything (test restore), download it, or restore it (a safety backup is
taken first; the restore is applied as one D1 transaction). Automatic daily backups and retention are
configured in **Data & security**. D1 also keeps point-in-time recovery (Time Travel):
`npx wrangler d1 time-travel restore dx-erp --timestamp=<ISO time>`.

## 7. Deploying to Cloudflare

One-time setup (needs a Cloudflare account; the free plan works for a trial):

```bash
npx wrangler login                                    # approve in the browser
npx wrangler d1 create dx-erp                         # copy the printed database_id into wrangler.jsonc
npx wrangler r2 bucket create dx-erp-files
npx wrangler r2 bucket create dx-erp-public
npx wrangler r2 bucket dev-url enable dx-erp-public   # optional public URL → PUBLIC_FILES_URL
npm run db:migrate:remote                             # create the tables in the remote D1
cp .env.cloudflare.example .env.cloudflare            # fill in production values (git-ignored)
npx wrangler secret bulk .env.cloudflare              # upload them as Worker secrets
```

Deploy (and every later release):

```bash
npm run deploy
```

`npm run deploy` (`scripts/cf/deploy.sh`) builds with the local `.env*` files moved aside, because OpenNext
bundles every env file it finds into the Worker; production values live only in Worker secrets. The app is
served at `https://dx-erp.<subdomain>.workers.dev` (attach a custom domain in the dashboard). Add
`<APP_URL>/api/auth/google/callback` to the Google OAuth client's redirect URIs.

Data from the former MongoDB database can be copied once with
`node --env-file=.env.local --import tsx scripts/cf/export-atlas.ts` (read-only; writes `.data/atlas.sql`),
then `npx wrangler d1 execute dx-erp --remote --file .data/atlas.sql`.

* Workers Free: 100k requests/day and **10 ms CPU per request**; Workers Paid ($5/month) lifts CPU to 30 s.
  D1 Free: 5 GB, 5M rows read / 100k rows written per day; R2 Free: 10 GB.
* Statutory payroll deductions (PF, PT, TDS …) are configurable under **Configuration → Payroll &
  stipends** and must be reviewed before production use (FRS §10.4).

## 8. Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server (local D1 / R2 simulators) |
| `npm run preview` | Build for Workers and run it locally in workerd |
| `npm run deploy` | Build for Workers and deploy to Cloudflare (without local env files) |
| `npm run db:generate` | Generate a SQL migration in `drizzle/` after changing `src/lib/models` |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply migrations to the local / remote D1 |
| `npm run cf-typegen` | Regenerate `cloudflare-env.d.ts` (binding types) after editing `wrangler.jsonc` |
| `npm run build` | Next.js production build (used by the Workers build) |
| `npm run lint` | ESLint |
| `npm run typecheck` | Route type generation + TypeScript check |
| `npm run hash-password` | Generate `SUPER_ADMIN_PASSWORD_HASH` |
