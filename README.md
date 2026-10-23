# D4DX ERP

Internal ERP for **D4DX Innovations LLP** — people, attendance, office movements, leave, payroll,
projects, timesheets, QA, CRM, proposals, contracts, invoicing, expenses, assets, reports and
administration in one responsive web app (desktop, tablet and phone).

Built with Next.js 16 (App Router), React 19, MongoDB (Mongoose 9), Tailwind CSS 4 and
DigitalOcean Spaces for files. Requirements: [`docs/FRS.md`](docs/FRS.md). Engineering
conventions: [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md). Visual design sources: `docs/design/`.

---

## 1. Quick start

```bash
npm install
cp .env.example .env.local   # then fill in the values (see below)
npm run dev                  # http://localhost:3000
```

Production:

```bash
npm run build
npm start
```

Requires Node.js 20.19+ (22 LTS or 24 recommended).

## 2. Environment variables

All configuration lives in environment variables — see [`.env.example`](.env.example) for the
full, commented list.

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public URL (no trailing slash). Used for OAuth redirects and links in emails. |
| `AUTH_SECRET` | ≥ 32 random characters for signing sessions (`openssl rand -base64 48`). |
| `MONGODB_URI` | MongoDB connection string (include the database name in the path). |
| `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_NAME` | The single Super Admin account. |
| `SUPER_ADMIN_PASSWORD` | Super Admin password for development (use 12+ characters). Leave empty in production. |
| `SUPER_ADMIN_PASSWORD_HASH` | **Production:** scrypt hash from `npm run hash-password`, used instead of the plain password. |
| `SUPER_ADMIN_TOTP_SECRET` | **Production:** base32 TOTP secret — the admin sign-in then also needs an authenticator code. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in for staff. |
| `GOOGLE_ALLOWED_DOMAIN` | **Production:** restrict sign-in to your Workspace domain. Without it any Google account whose address matches a staff record can sign in as that person. |
| `DO_SPACES_KEY`, `DO_SPACES_SECRET`, `DO_SPACES_ENDPOINT`, `DO_SPACES_REGION`, `DO_SPACES_BUCKET`, `DO_SPACES_CDN_URL`, `DO_SPACES_FOLDER` | File storage (documents, receipts, contracts, photos, backups). |
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

### DigitalOcean Spaces

Create a Space (private by default) and an access key with read/write access to it. Files are
uploaded through the server, so no bucket CORS rules are needed. Documents are stored privately and
served through short-lived signed URLs after a permission check; profile photos and the company
logo are public (served from `DO_SPACES_CDN_URL` when set). Backups go to
`<DO_SPACES_FOLDER>/backups/`.

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
invoices, document and warranty expiry, retention purges, daily backups) run:

* opportunistically after page loads (at most once a minute per server instance), and
* from `GET /api/cron` with header `Authorization: Bearer <CRON_SECRET>`.

On Vercel, `vercel.json` registers a daily cron (Vercel sends the bearer header automatically when
`CRON_SECRET` is set). On other hosts, call the endpoint every 5–15 minutes, e.g.

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://erp.example.com/api/cron
```

## 6. Backups and restore

**Admin → Configuration → Backup & restore** (permission *Run backups and restore data*): run a
backup on demand (all business collections, gzip-compressed Extended JSON in Spaces), verify a
backup without writing anything (test restore), download it, or restore it (a safety backup is
taken first). Automatic daily backups and retention are configured in **Data & security**.
Database-level backups from your MongoDB provider are still recommended.

## 7. Deployment notes

* Any Node.js host works (Vercel, DigitalOcean App Platform, a VM with `npm run build && npm start`).
* Set every environment variable in the host; set `APP_URL` to the public URL.
* MongoDB must be reachable from the host (allow-list the host's IPs on Atlas / DO Managed DB).
* Statutory payroll deductions (PF, PT, TDS …) are configurable under **Configuration → Payroll &
  stipends** and must be reviewed before production use (FRS §10.4).

## 8. Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint` | ESLint |
| `npm run typecheck` | Route type generation + TypeScript check |
| `npm run hash-password` | Generate `SUPER_ADMIN_PASSWORD_HASH` |
