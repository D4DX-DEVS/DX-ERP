# D4DX ERP — Security audit (22 Oct 2026)

Scope: full read of the authentication, session, RBAC, file, vault, backup, export and cron layers, every
route handler (24), every server-action file (28 files, ~250 exported actions) and every page (77), plus
dependency audit and runtime configuration. Method: manual code review by one lead reviewer with four
module reviewers (People, Time, Work, Sales/Finance/Settings); every reported finding was re-verified
against the source before being listed here. No code was changed.

Overall verdict: the codebase is built with security as a first-class concern. Authentication, session
revocation, permission checks on every page and action, server-side scoping, id validation, confidential
field projection, file access checks and the secrets vault are all consistently implemented, and we found
**no unauthenticated access, no SQL/NoSQL injection reaching data (one low-impact exception), no XSS, no
secret values reaching the browser, and no third-party calls beyond Google sign-in, DigitalOcean Spaces
and SMTP**. The real gaps are a small number of authorization edge cases — mostly around *delegated
administrators* and *project membership* — plus confidential values leaking into the audit trail and a few
defaults that should be tightened before production.

Severity scale: **High** = privilege escalation or confidential data exposure reachable by an ordinary
role; **Medium** = exposure or integrity loss that needs a specific (possibly custom) role or a specific
setup; **Low** = hardening, narrow edge cases, or information with little sensitivity.

---

## 1. High

### H1. `projects.manage` holders can add themselves to any project and gain vault (secrets) access
- `src/app/(app)/projects/actions.ts:441-460` (`saveTeamMember`) and `:165-226` (`updateProject`,
  `project.set("manager", data.manager)`), `src/lib/work-access.ts:98-100`, `src/lib/vault/service.ts:9-25`.
- `loadProject(actor, id, "manage")` passes for anyone with `projects.manage` (default `pm` and
  `management` roles). Nothing stops the actor adding **themselves** to the team or setting **themselves**
  as manager. `vaultRole` is decided only by `project.manager`/`project.team`, so this grants member or
  owner access to every "team" secret (and, as owner, to "selected" secrets, the access log and re-sharing).
- The code and UI explicitly promise the opposite (`service.ts:9-11`, `vault-panel.tsx:226`:
  "projects.manage holders who are not on the team get nothing").
- It is silent: the audit summary says "Added a team member" without naming who (`:456`), the actor is
  excluded from the notification (`:457`), and a replaced manager is never notified.
- Fix: refuse self-add / self-as-manager unless the actor is the current manager or super admin; name the
  affected person in the audit summary; notify the current manager on any team/manager change.

### H2. Delegated `users.manage` admins can create a login-enabled account with *any* role (escalation)
- `src/app/(app)/staff/_lib/person.ts:42` (`roleOptionsFor`: `if (can(user,"users.manage")) return all;`),
  `:246-247` (`allowed.has(p.role)` is the only check), `src/app/(app)/staff/actions.ts:50,71` and the CSV
  import `staff/_lib/import.ts:86`, `staff/actions.ts:312-321`.
- `changeRole` (`staff/[id]/actions.ts:567-575`) and `changeUserRole` (`roles/actions.ts:199-206`)
  enforce a ceiling ("delegated admins can't hand out more power than they hold"); account creation and
  import do not. A holder of `users.manage` + `staff.create` creates a person with `role: management` (or a
  custom role with `settings.manage` / `roles.manage` / `backup.manage`), `email: <their own Gmail>`,
  `loginAccess: on`, then signs in with Google as that account.
- Only reachable once `users.manage` is delegated (no built-in role has it today), but the code is
  clearly designed for that delegation.
- Fix: in `roleOptionsFor`/`createPersonRecord`, when the actor is not super admin allow only roles whose
  permissions ⊆ actor permissions (same test as `changeRole`); re-check per row in `importPeople`.

### H3. Delegated admins can take over any account by changing its work email
- `src/app/(app)/staff/actions.ts:203-213, 265`: a `users.manage` + `staff.edit` holder may set any
  person's `email`; `googleSub` is cleared and sessions are revoked, so the **next Google sign-in with
  the new email binds the attacker's Google account** to the victim's record and role
  (`api/auth/google/callback/route.ts:47-74`).
- `GOOGLE_ALLOWED_DOMAIN` is **empty in the local `.env.local`**; when it is unset in production any Gmail
  works. Same delegation precondition as H2.
- Fix: apply the role ceiling (refuse when the target's role has permissions the actor lacks), consider
  super-admin-only for email changes on login-enabled accounts, and set `GOOGLE_ALLOWED_DOMAIN` in
  production.

### H4. Interns and trainees see open tasks from the whole organisation on their dashboard
- `src/app/(app)/dashboard/_lib/queries.ts:405-413`: with `shared = true` the scope is
  `{ $or: [assignees, sharedWith] }`; the "undated tasks" query spreads `base` and then adds its own
  `$or` for due-date, **overwriting the scope `$or`**. Result: every open task in the org with no due date.
- Only caller is `InternTasksCard` (`dashboard/_components/intern.tsx:227`), which renders task titles,
  numbers and project titles, with no scope check on the project lookup.
- Any intern/trainee with fewer than six dated open tasks sees other teams' work automatically.
- Fix: `{ $and: [scope, { status: … }, { $or: [dueDate clauses] }] }`.

---

## 2. Medium

### M1. Payroll separation of duties can be bypassed through payslip line edits
- `src/app/(app)/payroll/actions.ts:169-193` (`savePayslipLines`) is not recorded on the run;
  `approveRun` (`:240-243`) only excludes `preparedBy`/`verifiedBy`; the edit audit entry carries no
  amounts (`:190`). Default `management` holds `payroll.prepare` + `approve` + `pay`.
- A manager edits an accomplice's lines (+₹5 L "Bonus"), lets HR verify, then approves and pays; the audit
  trail shows no figure.
- Fix: keep an `editors` list on the run and block approval by anyone in it; log line changes somewhere
  readable only with `payroll.view`.

### M2. The invoices module ignores restricted (confidential) clients
- `src/app/(app)/invoices/page.tsx:61,74` (`Client.find({})`), `invoices/[id]/page.tsx:43-48` (name,
  address, GSTIN, email), `invoices/receivables/page.tsx`, `invoices/export/route.ts`,
  `api/pdf/invoice/[id]/route.ts`, `lib/jobs/finance.ts`. None use `hiddenClientIds`/`canSeeClient`,
  while the finance *reports* deliberately do.
- Default `finance` role (`invoices.view`, no `crm.confidential`) reads restricted clients' billing details.
- Fix: apply `hiddenClientIds(user)` to lists/options/receivables/export and `canSeeClient` on detail+PDF
  (or document invoices as exempt and align the reports).

### M3. Audit trail exposes amounts and restricted-client details to `audit.view` holders
- `/audit` and `/audit/export` check only `audit.view` (default HR has it, without `invoices.view`,
  `contracts.view`, `crm.*`, `projects.financials`, `proposals.view`). Values written by:
  `invoices/actions.ts:154,170,242,346,370,388` (totals, payment/refund amounts),
  `contracts/actions.ts:153` (`value`), `crm/clients/actions.ts:161` (contact person, email, phone, GSTIN,
  address of confidential clients), `crm/actions.ts:169` (budget, expected value),
  `projects/actions.ts:213` (`budget`), `proposals/actions.ts:145` (total), `staff/actions.ts:283-287`
  (`dob`, `personalEmail`, `phone`).
- The staff module already applies the right rule (`staff/[id]/actions.ts:478`: "Amounts are intentionally
  left out of the audit trail"); it was not applied elsewhere.
- Fix: record field names without values for money and restricted-client fields, or filter/redact audit
  rows by entity against the viewer's module permissions.

### M4. Offer, relieving and college letters are not confidential by default
- `src/lib/config-defaults.ts:260-264` (`offer_letter`, `experience`, `college_letter`, `education`,
  `other`: `confidential: false`); `src/lib/files.ts:104-105` lets any `staff.view` holder (default
  `team_lead`, `pm`, `bd`…), reporting manager or mentor download non-confidential user documents.
- Offer/appointment letters normally state CTC.
- Fix: default `offer_letter` and `experience` to confidential and migrate existing files.

### M5. An employee can cancel a personal movement after returning, so the time outside is never deducted
- `src/app/(app)/movement/actions.ts:224-241`: owner may cancel any same-day movement still `out`;
  `lib/domain/attendance-calc.ts:81` only counts `returned` movements; cancel also clears the check-out
  block. Affects attendance status, half-day and LOP.
- Fix: allow self-cancel only within a few minutes of Out-Time; later cancellations go through correction
  or approval; notify the manager.

### M6. Vault rotation advice misses people who certainly know the values
- `src/lib/vault/service.ts:132-146`: only `reveal/copy/download/edit_open` events count; items the person
  *created or updated* are not flagged; a manager demoted to member is not "removed"; the staff-exit flow
  never calls `adviseRotationForRemoved` (only two call sites, both in `projects/actions.ts`).
- Fix: include create/update (or `createdBy`/`updatedBy`), treat owner→member demotion as loss of access,
  and call it from `completeExit` / `setLoginAccess(false)`.

### M7. Production configuration hardening (verify on the host, not only locally)
- `GOOGLE_ALLOWED_DOMAIN` empty → any Google account can be bound to a record whose email matches (see H3).
- `SUPER_ADMIN_PASSWORD` stored in plain text in env; `SUPER_ADMIN_PASSWORD_HASH` (scrypt, via
  `npm run hash-password`) and `SUPER_ADMIN_TOTP_SECRET` exist but are optional. Use both in production.
- Super admin lockout is keyed on the email (`login/actions.ts:62-66`): anyone who knows the admin email can
  lock the single admin account out for 15 minutes at will (availability).
- `.env.local` in the project folder holds live Atlas, Spaces, Google and SMTP secrets; the folder is not
  yet a git repository — keep `.env*` ignored when it becomes one.

### M8. Vulnerable dependency: nodemailer 7.0.13 (13 advisories, 1 high) and exceljs→uuid (moderate)
- Actual exposure is low (only `to`, `subject`, `text` are passed, `to` comes from validated staff emails),
  but upgrade to nodemailer 10.x (`npm audit`). Next 16.4.2, jose 6.2.13, mongoose 9.11.2 are current.

### M9. No Content-Security-Policy
- `next.config.ts` sets X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy and HSTS, but no CSP.
  No XSS sink was found (no `dangerouslySetInnerHTML`, React escaping throughout, no third-party scripts),
  so this is defence in depth; add a nonce-based CSP via `proxy.ts`.

---

## 3. Low

- **L1. One unvalidated id reaches a query.** `src/app/(app)/crm/actions.ts:364`
  `completeFollowUp`: `Activity.findById(id)` before any `isObjectId` check. Server actions accept arbitrary
  JSON, and Mongoose casts `{"$ne":null}` straight through (verified), so a `crm.view` user can mark an
  arbitrary follow-up done. Every other id across all 28 action files is validated (`isObjectId`, `zs.id`,
  `zs.optId`, `zs.ids`, slug regex). Fix: add the guard; optionally add a lint rule or a shared `loadById`.
- **L2. Vault metadata in page props without logging.** `projects/[id]/vault-tab.tsx:69-77` decrypts
  every visible item on page load and ships credential `url`, `username` and env variable **names** to the
  client with no VaultEvent, no rate limit. A `postgres://user:pass@host` URL or a webhook token in the URL
  field leaks silently. Fix: treat url/username as reveal-only or reject URLs with userinfo/query.
- **L3. Vault policy gaps.** Item creators can widen audience to "team" against the owner's restriction and
  dismiss rotation advice without a VaultEvent (`vault-actions.ts:207-255`); reveal limit is count-then-log
  (race) and a field-less reveal returns the whole payload; opening the Secrets tab is never logged (also for
  super admin); interns on a team see "team"-audience secrets by default; `deleteProject` shreds the vault and
  its access log with only a generic audit entry; backup restore can roll ciphertexts and access logs back.
- **L4. Delegated-admin ceiling missing on destructive user actions.** `setLoginAccess`, `revokeSession`,
  `revokeAllSessions`, `deletePerson` (`staff/[id]/actions.ts:529-662`, `roles/actions.ts:231-261`) let a
  delegated admin disable, sign out or delete more-powerful users.
- **L5. Own-record guard missing** in `transferDepartment`, `reviseStipend` (also doesn't check the target is
  an intern/trainee) and `savePerson` (self `joiningDate`/`employmentType`; a `users.manage` holder can change
  their own email).
- **L6. Mentor not validated when the internship sub-document is first created** (`staff/actions.ts:223-236`)
  → self-mentor can evaluate, extend, complete and certify themselves.
- **L7. File access broader than the pages.** `lib/files.ts`: `interns.manage` can download any
  non-confidential document of any employee; `learning` files are open to every signed-in user regardless of
  audience; `project` files have no intern exclusion; a self-upload can replace an HR-uploaded
  non-confidential document (`staff/[id]/actions.ts:406`); `toFileRef` keeps the original `uploadedBy`, so a
  re-attached file is shown under the wrong person and that person gets the remove right.
- **L8. Personal movement details leak** to `movement.view_all/approve/manage` holders without
  `movement.view_personal`: `categoryLabel` on `movement/page.tsx:220` and the export Category column,
  correction reasons / approval / resolution notes on the list and detail pages; the movement reports'
  `category` filter accepts personal categories (`lib/reports/movement.ts:101`).
- **L9. Stale approver rights.** Movement `approver` (`lib/movement/access.ts:49`) and leave `manager`
  (`leave/actions.ts:233`) are the manager at creation time; a former manager can still approve.
- **L10. Visibility edge cases.** `finance`/`bd` see task titles on project overview without `tasks.view_all`
  (`projects/[id]/overview.tsx:52`); proposal owners bypass restricted-client rules
  (`proposals/_lib/access.ts:18-22`); contract renewal/expiry reminders go to all `contracts.manage`
  holders for confidential clients (`lib/jobs/sales.ts:103-139`); interns can be made lead/client owners
  (CRM `canSeeClient` lacks `isInternLike`); `project-profitability` report is org-wide for
  `reports.financial`+`projects.financials`.
- **L11. Unbounded free text** in `changeTaskStatus`/`setProjectStatus` notes, movement reason/note,
  `approveExpense` note (body limit is 12 MB, so a task document can be bloated toward the 16 MB cap).
- **L12. Attendance period integrity.** `Attendance.locked` is never set (the three lock checks are dead
  code); manual attendance, corrections, leave and movement corrections can target any past date including
  months already paid.
- **L13. Payroll bank file** prefers *current* `User.bank` over the approved snapshot
  (`payroll/[id]/export/route.ts:47-61`), and the export is audited before the permission check (`:39-43`).
- **L14. Login details.** Email-match short-circuit before scrypt gives a timing hint for the admin email;
  TOTP accepts the same code more than once within its window.
- **L15. Uploads.** MIME is client-declared with no magic-byte check; the SVG block is an exact string
  match so `image/svg+xml; charset=utf-8` passes (stored public on the CDN origin only); the whole body is
  buffered before the 10 MB check; no per-user quota.
- **L16. "Exited" is matched by status key** (`resigned/terminated/inactive`) rather than by category, so a
  custom exited status can be re-enabled from `/roles`.
- **L17. Exports without `reports.export`**: attendance team/summary and timesheets exports only need the
  module scope (rows are correctly scoped and audited).
- **L18. Cookie/URL hardening.** Session cookie could use the `__Host-` prefix; signed download URLs live
  300 s (backups 120 s).

---

## 4. Verified as correctly protected (what you can rely on)

- **Auth & sessions**: HS256 JWT bound to a DB-backed session (`sid`) that is checked on every request for
  revocation, expiry, account status and exited status; sessions revoked on role change, access disable,
  email change, exit, inactive status; per-user session list with self-revoke; cookie `httpOnly`,
  `secure` in prod, `SameSite=Lax`; logout is POST-only; `proxy.ts` redirects unauthenticated page loads.
- **Google sign-in**: authorisation code + PKCE + `state` + `nonce` in a signed, path-scoped cookie; ID token
  verified against Google JWKS with audience/issuer; email must be verified and pre-registered; super admin
  cannot sign in via Google; a changed Google subject is refused (`account_mismatch`).
- **Super admin**: env-configured only, cannot be assigned, edited, emailed or deleted from the app; scrypt
  hash + optional TOTP; rate-limited and audited sign-in; `logging.serverFunctions` disabled so arguments
  (passwords, secrets, salaries) never hit the console.
- **Authorisation**: all 77 pages call `requireUser`/`requirePagePermission`; all ~250 actions call
  `actionUser`/`actionPermission` before any DB access; self-approval blocked for leave, movements,
  attendance corrections, timesheets, expenses and payroll; delegated role assignment enforces the
  permission ceiling; roles can't edit their own role or grant permissions they lack.
- **Confidential data**: `salary`, `salaryHistory`, `bank`, `googleSub` projected out on staff/profile pages
  and only loaded in the salary tab for `staff.confidential`; stipend gated; confidential lifecycle events
  filtered server-side; payslip PDFs mask PAN/account; no full documents are passed to Client Components.
- **Injection & validation**: every search box uses an escaped, 100-char-capped regex; all `searchParams`
  go through typed helpers; zod whitelists every create/update (no mass assignment); `strictQuery` on.
- **Files**: uploads require sign-in, type allow-list, size cap, per-entity permission; downloads always go
  through `/api/files/[id]` → `canAccessFile` → short-lived signed URL; user documents are confidential until
  registered; only the uploader can register a file.
- **Vault**: AES-256-GCM envelope encryption with per-project keys wrapped by `VAULT_MASTER_KEY`, AAD
  binding to project/item/kind, key rotation; values only ever leave the server via `revealVaultItem`
  (role check, rate limit, VaultEvent + audit, optional notification); removal from a team pulls membership
  and flags revealed items.
- **Backups**: `backup.manage` only; private objects; 120 s signed download; verify-before-restore, safety
  backup, restore lock, audit log never overwritten; cron protected by a constant-time bearer check.
- **Exports/PDF**: all route handlers (including the 11 outside `/api`) authenticate, check permissions,
  scope rows and audit; CSV formula injection neutralised; XLSX cells are typed strings.
- **Headers**: X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS preload,
  `poweredByHeader` off; `robots: noindex`.
- **Outbound traffic**: only Google OAuth/JWKS, DigitalOcean Spaces, SMTP. No analytics, no telemetry, no
  third-party scripts; fonts are self-hosted by `next/font`.

---

## 5. Recommended order of work

1. H1–H4 (four small server-side guards: self-add to team, role ceiling on create/import, email-change
   ceiling, dashboard `$and`).
2. M1–M3 (payroll editors list, invoices restricted-client scoping, audit-trail value redaction).
3. M4, M7, M8 (document defaults, production env: allowed domain + password hash + TOTP, nodemailer upgrade).
4. M5, M6, M9 and the Low list.
