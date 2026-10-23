# D4DX ERP — engineering conventions

Next.js 16 (App Router, Turbopack, React 19.3), MongoDB via Mongoose 9, Tailwind CSS v4, zod 4.
Requirements: `docs/FRS.md`. Visual design: `docs/design/*.dc.html` (inline-styled HTML from the
design canvas; `Sidebar.dc.html`, `Topbar.dc.html`, `Components.dc.html`, `Tokens.dc.html` define the system).

> **Next.js 16 differs from older versions.** `params` / `searchParams` are Promises, `middleware.ts` is
> now `src/proxy.ts`, Cache Components is **disabled** (`cacheComponents: false`) — every page is dynamic.
> Bundled docs: `node_modules/next/dist/docs/`.

## Layout

```
src/
  app/
    (app)/                 authenticated shell (sidebar, top bar, mobile tab bar)
      <module>/page.tsx    server component pages
      <module>/actions.ts  "use server" mutations for the module
      <module>/*.tsx       client components for the module ("use client")
    api/…                  route handlers (files, auth, PDFs, exports, cron)
    login/                 Google sign-in (staff) + env-credential sign-in (super admin)
  components/ui/           design-system components (do not fork; extend only if essential)
  components/shell/        app chrome
  lib/
    models/                Mongoose models (one file per domain; index.ts re-exports all)
    auth/session.ts        getCurrentUser / requireUser / requirePagePermission / can / canAny
    actions.ts             runAction / actionUser / actionPermission / ActionError / parse
    validation.ts          zs.* zod helpers for form input
    rbac/permissions.ts    permission catalog + default role matrix
    settings.ts            getSettings() (AppSettings from config-defaults.ts)
    domain/                shared business rules (calendar, attendance-calc, leave-balance)
    audit.ts  notify.ts  files.ts  storage.ts  counters.ts  people.ts  query.ts
    time.ts  format.ts  status.ts  serialize.ts  export.ts  pdf/base.ts
    jobs/                  scheduled reminders (runner.ts + registry.ts + <module>.ts)
```

## Pages (Server Components)

```tsx
import { requirePagePermission, requireUser, can } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Movement } from "@/lib/models";
import { param, pageParam, PAGE_SIZE, searchRegex, type SearchParams } from "@/lib/query";
import { PageBody, PageHeader } from "@/components/ui/page";

export const metadata = { title: "Movement register" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();                        // or requirePagePermission("movement.view_all")
  const sp = await searchParams;
  await connectDB();
  const page = pageParam(sp);
  const filter: Record<string, unknown> = {};
  if (!can(user, "movement.view_all")) filter.user = user._id; // scope on the SERVER, always
  const [rows, total] = await Promise.all([
    Movement.find(filter).sort({ outTime: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Movement.countDocuments(filter),
  ]);
  return (
    <PageBody>
      <PageHeader overline="Time" title="Movement register" actions={…} />
      …
    </PageBody>
  );
}
```

* Dynamic routes: `{ params }: { params: Promise<{ id: string }> }`, then `const { id } = await params`.
  Validate ids with `isObjectId()` and call `notFound()` for bad / missing records.
* Authorisation is enforced in **every** page and action. Use `requirePagePermission(...)` (renders 403)
  or explicit checks + `forbidden()` from `next/navigation`. Never rely on hiding a button.
* Use `.lean()` for reads. Server Components may render Dates / ObjectIds directly (call `.toString()`).
  **Before passing data to a Client Component, convert it** with `plain()` from `lib/serialize.ts`
  or map to a small view-model of strings/numbers.
* Never send confidential fields (`salary`, `salaryHistory`, `bank`, restricted client data, personal
  movement details) to users who lack the permission — project them out in the query.
* The super admin account has `personType: "admin"`; exclude it from staff lists, attendance,
  payroll etc. with `personType: { $in: ["employee", "trainee", "intern"] }`. `isStaff(user)` is false
  for the super admin (no own attendance / movement / leave).

## Mutations (Server Actions)

One `actions.ts` per route folder, starting with `"use server"`. Every export returns
`Promise<ActionResult<T>>` and wraps its body in `runAction` (connects DB, maps zod/mongoose/duplicate
errors to field errors, rethrows redirects):

```ts
"use server";
import { z } from "zod";
import { runAction, actionUser, actionPermission, ActionError, parse, type ActionResult } from "@/lib/actions";
import { zs } from "@/lib/validation";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";

const schema = z.object({ purpose: zs.text("Purpose", 500), expectedReturn: zs.optDateTime(), project: zs.optId() });

export async function createThing(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionUser();                         // or actionPermission("x.manage")
    const data = parse(schema, input);
    if (somethingWrong) throw new ActionError("Readable message", { field: "Field message" });
    const doc = await Thing.create({ … });
    await audit(user, { action: "create", entity: "thing", entityId: doc._id, ref: doc.thingNo, summary: `Created ${doc.thingNo}` });
    await notify([approverId], { type: "movement", title: "…", body: "…", link: `/movement/${doc._id}`, actionable: true }, [user._id]);
    return { id: doc._id.toString() };
  }, "Saved");                                                // optional success toast text
}

// Actions with a record id: take it as a parameter so pages can `.bind` it.
export async function approveThing(id: string, note?: string): Promise<ActionResult<null>> { … }
```

* Actions receive **plain objects** (built from `FormData` by `<ActionForm>`): numbers/booleans arrive as
  strings — use `zs.*` helpers (`zs.num`, `zs.bool`, `zs.optId`, `zs.ids`, `zs.date`, `zs.dateTime`…).
  Multi-value inputs use `name="x[]"` and arrive as arrays.
* Re-check permissions and record state (e.g. "already approved") inside the action. Approved / locked
  records may only change through their correction workflow (FRS §20.2).
* Audit every significant change (`lib/audit.ts`), including approvals, corrections, financial changes,
  config and permission changes. `diff(before, after, fields)` builds a change list.
* Notify affected users (`lib/notify.ts`). `type` must be one of the keys in `NOTIFICATION_EVENTS`
  (`config-defaults.ts`): task, leave, attendance, movement, timesheet, project, crm, contract, invoice,
  payroll, document, internship, expense, asset, qa, announcement, system. Use `actionable: true` when the
  recipient must approve something; `dedupeKey` for reminders.
* `router.refresh()` runs automatically after a successful `<ActionForm>` / `useServerAction` call, so
  `revalidatePath` is not needed.
* Human-readable numbers: `nextNumber(name, ID_PREFIX.x, pad)` from `lib/counters.ts`.

## ⚠️ Server → Client boundary (runtime error, not caught by tsc)

A Server Component (any `page.tsx` / async component without `"use client"`) can only pass
**serializable props** to Client Components. Never write inline functions there:

```tsx
// ❌ in a server page — crashes at runtime: "Functions cannot be passed directly to Client Components"
<ActionButton action={() => approve(id)} />
<ActionForm action={(input) => update(id, input)} onSuccess={…} />
<GroupedBarChart valueFormatter={(v) => …} />

// ✅ bind the server action (server-action references ARE serializable)
<ActionButton action={approve.bind(null, id)} />
<ActionForm action={update.bind(null, id)} />
// ✅ or move the interactive piece into a small "use client" component that receives plain data
//    (ids, strings) and builds the callbacks itself — required for onSuccess / router.push etc.
// ✅ charts take a serializable `format` key: format="inr" | "inrCompact" | "hours" | "percent" | "minutes" | "number"
```

`action.bind(null, id)` works with `ActionButton` (`() => Promise`) and `ActionForm`
(`(input) => Promise`) as long as the bound action's remaining parameters match.

## Client components

```tsx
"use client";
import { ActionForm, Field, FormGrid, SubmitButton, FormActions } from "@/components/ui/form";
import { Input, Select, Textarea, Switch } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { createThing } from "./actions";

<ActionForm action={createThing} successMessage="Movement recorded" onSuccess={(d) => router.push(`/movement/${d.id}`)}>
  <FormGrid>
    <Field label="Purpose" name="purpose" required><Input id="purpose" name="purpose" /></Field>
    …
  </FormGrid>
  <FormActions><SubmitButton>Save</SubmitButton></FormActions>
</ActionForm>
```

* Approve / reject / one-click actions: `<ActionButton action={() => approve(id)} …>` or
  `<ReasonAction action={(reason) => reject(id, reason)} title="Reject" trigger={<Button variant="danger-outline">Reject</Button>} />`
  (`components/ui/actions.tsx`). Server-bound alternatives: pass `approve.bind(null, id)` from a page.
* Dialog forms: `<Dialog trigger={<Button>New</Button>} title="…">…</Dialog>` (controlled via
  `open`/`onOpenChange` when you need to close it on success).
* Confirmations are always modals — never `window.confirm` / `alert` / `prompt`. Deletes, removals, cancels,
  sign-out and other irreversible steps: `<ActionButton confirm="…" confirmTone="danger" confirmTitle="…">`, or in
  handlers / menu items `const confirm = useConfirm(); if (await confirm({ title, description, tone: "danger" })) run(…)`
  (`components/ui/confirm.tsx`; `<ConfirmProvider>` is mounted in the root layout).
* People pickers: `peopleOptions()` (server, `lib/people.ts`) → `<PeoplePicker name="assignee" options={…} />`
  (`multiple` posts `name[]`).
* Attachments: `<FileUpload name="attachments" context={{ entityType: "task", entityId }} />` posts
  `attachments: string[]` (StoredFile ids). In the action call `resolveFileRefs(user, data.attachments)`
  to get embeddable `FileRef[]`. Display with `<AttachmentList files={refs} />` (links to `/api/files/<id>`,
  which enforces `canAccessFile`). Add new entity types to `canAccessFile` in `lib/files.ts` only if needed.
* URL filters: `<SearchInput />`, `<SelectFilter param=… options=… />`, `<ChipFilters />`, `<DateFilter />`,
  `<Pagination page pageSize total />` (`components/ui/filters.tsx`). Read them on the server with
  `param(sp, "x")`, `idParam`, `dateParam`, `monthParam`, `pageParam`.

## UI building blocks (`components/ui`)

`PageBody`, `PageHeader`, `StatCard`, `MiniStat`, `Progress`, `EmptyState`, `Alert`, `SectionTitle` (page.tsx) ·
`Card`, `CardHeader`, `CardBody`, `CardFooter`, `DetailList` (card.tsx) · `TableWrap`, `THead`, `Th`, `Tr`, `Td`,
`EmptyRow` (table.tsx) · `Chip`, `StatusChip domain=… value=…`, `OptionChip options=… value=…`, `Tag` (chip.tsx) ·
`Avatar`, `AvatarStack`, `PersonCell` · `Button`, `ButtonLink`, `buttonClass` · `Input`, `Select`, `Textarea`,
`Checkbox`, `Radio`, `Switch` · `Dialog` · `Menu` (⋯ menu) · `LinkTabs`, `Segmented` · `Timeline` ·
`GroupedBarChart`, `DonutChart`, `HBarList` (charts.tsx) · `FileUpload`, `AttachmentList` · `PeoplePicker`.

Design rules: cards are white with `border-line` and 14px radius; page background `bg-ground`; headings use
`font-display` (Montserrat); body Inter. Primary action `Button` (blue 600). Status vocabularies live in
`lib/status.ts` (domains: attendance, movement, movementApproval, leave, correction, timesheet, priority, issue,
severity, invoice, payment, proposal, contract, expense, payrollRun, payslip, asset, assetCondition,
internship, certificate, client, leadStatus, milestone, submission, review, objective, personType).
Configurable lists (project/task statuses, pipeline stages, employment statuses) come from `getSettings()`
— render them with `OptionChip`. Every page must work from 360px wide up, and **no page may scroll
sideways at any width** (phones through 1920px laptops/desktops). Grids collapse to one column, boards,
steppers, tabs and chip rows wrap, primary actions stay reachable. Bottom padding for the mobile tab bar is
built into `PageBody`. Labels are never clipped: when a row of tabs or buttons would not fit on a phone, give
`LinkTabs` items an `icon` (phones then show one row of icons) or hide a button's text below `sm`
(`<span className="max-sm:sr-only">`) so only its icon shows.

Tables live in `TableWrap`, which clips instead of scrolling and shows only the key columns per screen:
`phone` (<640), `tablet` (640–1023), `laptop` (1024–1279), `desktop` (≥1280). Each takes the 1-based column
numbers to keep (`"last"` = the last column, usually actions), `"auto"` (first six + last) or `"all"`.
Defaults: `phone={[1, "last"]} tablet={[1, 2, 3, "last"]} laptop="auto" desktop="all"`. Pick the columns that
identify the row plus its status/amount; everything hidden must still be visible on the detail page.
`truncate` text inside a table wraps instead (a no-wrap cell would push the last columns out of view); outside
tables, prefer `break-words` over `truncate` for titles so the full label shows.

Phones are compact by design: the shared components (`PageBody`, `PageHeader`, cards, tables, tabs, buttons,
inputs, dialogs, forms) shrink spacing and type below `sm` — use them rather than hard-coding large paddings or
font sizes. Put filter controls inside `<FilterBar>` (collapsed behind a "Filters" button below `md`). Inputs stay
16px on phones (smaller text makes iOS zoom into the field). Any element that clips or scrolls its overflow
must be `relative`, or absolutely positioned children (e.g. `sr-only` labels) widen the whole page. Two-column
detail layouts (main + side panel) switch on at `xl`, not `lg`.

## Dates, time, money

* Company time zone = `TZ` (`lib/time.ts`, Asia/Kolkata). Calendar days are `"yyyy-MM-dd"` strings
  (`todayKey()`, `dateKey(date)`); instants are `Date`s. Convert form values with `parseLocalDateTime()`
  (datetime-local) or `zonedDateTime(day, "HH:mm")`. Format with `fmtDate`, `fmtTime`, `fmtDateTime`,
  `formatDuration(minutes)`, `timeAgo`. Never use `new Date().toISOString().slice(0,10)` for "today".
* Money: `inr(n)` → ₹18,42,500, `inrCompact(n)` → ₹42.6 L. PDFs use `pdfMoney` (Helvetica has no ₹ glyph).

## Project secrets vault

`projects/[id]` → Secrets tab (`vault-tab.tsx`, `vault-panel.tsx`, `vault-actions.ts`; logic in `lib/vault/`).
Access follows project **membership**, not permissions: the project manager and super admin are owners, team
members see items shared with the team or with them; `projects.view_all` alone grants nothing. Values are sealed
with AES-256-GCM under a per-project key wrapped by `VAULT_MASTER_KEY` (rotate via `VAULT_MASTER_KEY_PREVIOUS`).
Never send values in page props — only `revealVaultItem` returns them, and it logs every call (`VaultEvent` +
audit trail). Removing someone from a team flags the items they revealed for rotation (`adviseRotationForRemoved`).

## Files, PDFs, exports

* Uploads: `POST /api/files/upload` (multipart; used by `<FileUpload>`). Downloads: `GET /api/files/<id>`.
* PDFs: `lib/pdf/base.ts` (`createDoc`, `heading`, `paragraph`, `keyValues`, `table`, `finalize`,
  `pdfResponse`) inside a route handler, e.g. `src/app/api/pdf/invoice/[id]/route.ts`.
* Tabular exports: `exportResponse({ title, filename, columns, rows, format })` from `lib/export.ts`
  (CSV / XLSX / PDF) inside a route handler. Check `reports.export` (or the module permission).

## Scheduled reminders

Do **not** edit `lib/jobs/registry.ts`. Create `src/lib/jobs/<module>.ts` exporting
`export const <module>Jobs: Job[] = [{ name: "movement-overdue", intervalMinutes: 10, run: async () => "…" }]`
(import `type Job` from `./registry`). Jobs must be idempotent: use `notify(..., { dedupeKey })` and/or
"notified at" fields so reminders are sent once.

## Quality bar

* `npx tsc --noEmit` and `npx eslint <your files>` must pass. No `any`, no unused code, no `@ts-ignore`.
* Handle empty states, not-found ids, and permission-denied paths explicitly.
* Keep within your module's folders. Shared files (`lib/models/*`, `lib/auth/*`, `components/ui/*`,
  `components/shell/*`, `lib/rbac/*`) should only receive minimal **additive** changes when truly
  required — and those must be listed in your final report.
