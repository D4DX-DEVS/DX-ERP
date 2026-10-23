import "server-only";
import { and, asc, eq, gt, gte, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { PERSON_TYPES, Review, StoredFile, User } from "@/lib/models";
import { usersWithPermission } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { inList, jsonPath, notInList } from "@/lib/sql";
import { addDays, fmtDate, monthKey, todayKey } from "@/lib/time";
import { notifyBatch, type BatchedNotification } from "./batch";
import type { Job } from "./registry";

const EXITED = ["resigned", "terminated", "inactive"];
/** Employees, trainees and interns who have not left. */
const activeStaff = () => and(inList(User.personType, PERSON_TYPES), notInList(User.status, EXITED));

/**
 * Document expiry reminders: a document that is about to expire (within `reminderDaysBefore`) or
 * already expired notifies its owner and everyone who can edit staff records. Reminders are deduped per
 * document + expiry date (and once more when it actually expires).
 */
async function documentExpiry(): Promise<string> {
  const settings = await getSettings();
  const today = todayKey();
  const horizon = addDays(today, Math.max(1, settings.notifications.reminderDaysBefore));
  const files = await db()
    .select({ id: StoredFile._id, entityId: StoredFile.entityId, category: StoredFile.category, expiryDate: StoredFile.expiryDate, name: StoredFile.name })
    .from(StoredFile)
    .where(
      and(
        eq(StoredFile.entityType, "user"),
        isNull(StoredFile.deletedAt),
        isNull(StoredFile.replacedBy),
        isNotNull(StoredFile.category),
        ne(StoredFile.category, ""),
        gt(StoredFile.expiryDate, ""),
        lte(StoredFile.expiryDate, horizon),
      ),
    )
    .orderBy(asc(StoredFile.expiryDate))
    .limit(500);
  if (files.length === 0) return "no documents expiring";

  const [owners, editors] = await Promise.all([
    db()
      .select({ id: User._id, name: User.name, employeeId: User.employeeId })
      .from(User)
      .where(and(inList(User._id, [...new Set(files.flatMap((f) => (f.entityId ? [f.entityId] : [])))]), activeStaff())),
    usersWithPermission("staff.edit"),
  ]);
  const ownerById = new Map(owners.map((o) => [o.id, o]));
  const labels = new Map(settings.documentCategories.map((c) => [c.key, c.label]));

  const items: BatchedNotification[] = [];
  let sent = 0;
  for (const f of files) {
    const owner = f.entityId ? ownerById.get(f.entityId) : undefined;
    if (!owner || !f.expiryDate) continue;
    const expired = f.expiryDate < today;
    const label = labels.get(f.category ?? "") ?? f.name;
    const when = fmtDate(f.expiryDate);
    const dedupeKey = `doc-expiry:${f.id}:${f.expiryDate}${expired ? ":expired" : ""}`;
    items.push({
      recipients: [owner.id],
      input: {
        type: "document",
        title: expired ? `Your ${label} has expired` : `Your ${label} expires on ${when}`,
        body: expired ? `It expired on ${when}. Please upload a renewed copy.` : "Please upload a renewed copy before it expires.",
        link: "/profile#documents",
        priority: expired ? "high" : "normal",
        dedupeKey,
      },
    });
    items.push({
      recipients: editors,
      exclude: [owner.id],
      input: {
        type: "document",
        title: expired ? `${owner.name}: ${label} expired` : `${owner.name}: ${label} expires on ${when}`,
        body: `${owner.name} (${owner.employeeId}) — follow up for a renewed document.`,
        link: `/staff/${owner.id}?tab=documents`,
        priority: expired ? "high" : "normal",
        dedupeKey,
      },
    });
    sent++;
  }
  await notifyBatch(items);
  return `${sent} document reminder${sent === 1 ? "" : "s"} processed`;
}

/** Notice periods ending within 7 days → people who can edit staff records (+ the manager). */
async function noticeEnding(): Promise<string> {
  const today = todayKey();
  const lastWorkingDay = jsonPath<string | null>(User.exit, "lastWorkingDay");
  const people = await db()
    .select({ id: User._id, name: User.name, employeeId: User.employeeId, reportingManager: User.reportingManager, exit: User.exit })
    .from(User)
    .where(and(inList(User.personType, PERSON_TYPES), eq(jsonPath(User.exit, "stage"), "notice"), gte(lastWorkingDay, today), lte(lastWorkingDay, addDays(today, 7))));
  if (people.length === 0) return "0 notice periods ending soon";
  const editors = await usersWithPermission("staff.edit");
  const items: BatchedNotification[] = [];
  for (const p of people) {
    const last = p.exit?.lastWorkingDay;
    if (!last) continue;
    const input = {
      type: "system",
      title: `${p.name}'s notice period ends ${last === today ? "today" : `on ${fmtDate(last)}`}`,
      body: `${p.name} (${p.employeeId}) — complete the exit: assets, handover and access.`,
      link: `/staff/${p.id}?tab=history`,
      actionable: true,
      dedupeKey: `notice-end:${p.id}:${last}`,
    };
    items.push({ recipients: editors, input });
    items.push({ recipients: [p.reportingManager], input });
  }
  await notifyBatch(items);
  return `${people.length} notice period${people.length === 1 ? "" : "s"} ending soon`;
}

/** Internships ending within 7 days (or already past their end date) → mentor + interns.manage. */
async function internshipEnding(): Promise<string> {
  const today = todayKey();
  const people = await db()
    .select({ id: User._id, name: User.name, employeeId: User.employeeId, internship: User.internship })
    .from(User)
    .where(
      and(
        inList(User.personType, ["trainee", "intern"]),
        notInList(User.status, EXITED),
        inList(jsonPath(User.internship, "status"), ["active", "extended"]),
        lte(jsonPath<string | null>(User.internship, "endDate"), addDays(today, 7)),
      ),
    );
  if (people.length === 0) return "0 internships ending soon";
  const managers = await usersWithPermission("interns.manage");
  const items: BatchedNotification[] = [];
  for (const p of people) {
    const end = p.internship?.endDate;
    if (!end) continue;
    const over = end < today;
    const input = {
      type: "internship",
      title: over ? `${p.name}'s internship end date has passed` : `${p.name}'s internship ends ${end === today ? "today" : `on ${fmtDate(end)}`}`,
      body: over ? "Complete or extend the internship." : "Schedule the final evaluation and complete or extend the internship.",
      link: `/interns/${p.id}?tab=completion`,
      actionable: true,
      dedupeKey: `${over ? "internship-ended" : "internship-end"}:${p.id}:${end}`,
    };
    const mentor = p.internship?.mentor;
    items.push({ recipients: [mentor], input });
    items.push({ recipients: managers, exclude: [mentor], input });
  }
  await notifyBatch(items);
  return `${people.length} internship${people.length === 1 ? "" : "s"} ending soon`;
}

/** Monthly evaluation reminder: running internships with no shared evaluation in the last 30 days → mentor. */
async function reviewDue(): Promise<string> {
  const today = todayKey();
  const month = monthKey();
  const running = await db()
    .select({ id: User._id, name: User.name, internship: User.internship })
    .from(User)
    .where(
      and(
        inList(User.personType, ["trainee", "intern"]),
        notInList(User.status, EXITED),
        inList(jsonPath(User.internship, "status"), ["active", "extended"]),
        lte(jsonPath<string | null>(User.internship, "startDate"), addDays(today, -30)),
      ),
    );
  if (running.length === 0) return "no running internships";
  const reviewed = await db()
    .selectDistinct({ user: Review.user })
    .from(Review)
    .where(and(inList(Review.user, running.map((p) => p.id)), eq(Review.status, "shared"), gte(Review.date, addDays(today, -30))));
  const recent = new Set(reviewed.map((r) => r.user));
  const due = running.filter((p) => !recent.has(p.id));
  const managers = due.some((p) => !p.internship?.mentor) ? await usersWithPermission("interns.manage") : [];
  const items: BatchedNotification[] = due.map((p) => ({
    recipients: p.internship?.mentor ? [p.internship.mentor] : managers,
    input: {
      type: "internship",
      title: `Evaluation due for ${p.name}`,
      body: "No evaluation has been shared in the last 30 days.",
      link: `/interns/${p.id}?tab=evaluations`,
      actionable: true,
      dedupeKey: `review-due:${p.id}:${month}`,
    },
  }));
  await notifyBatch(items);
  return `${due.length} evaluation reminder${due.length === 1 ? "" : "s"} due`;
}

/** Registered internships whose start date has arrived become active. */
async function activateInternships(): Promise<string> {
  const res = await db()
    .update(User)
    .set({ internship: sql`json_set(${User.internship}, '$.status', 'active')` })
    .where(
      and(
        inList(User.personType, ["trainee", "intern"]),
        notInList(User.status, EXITED),
        eq(jsonPath(User.internship, "status"), "registered"),
        lte(jsonPath<string | null>(User.internship, "startDate"), todayKey()),
      ),
    )
    .run();
  const n = res.meta.changes;
  return `${n} internship${n === 1 ? "" : "s"} activated`;
}

export const peopleJobs: Job[] = [
  { name: "people-document-expiry", intervalMinutes: 360, run: documentExpiry },
  { name: "people-notice-ending", intervalMinutes: 720, run: noticeEnding },
  { name: "people-internship-ending", intervalMinutes: 720, run: internshipEnding },
  { name: "people-internship-review-due", intervalMinutes: 720, run: reviewDue },
  { name: "people-internship-activate", intervalMinutes: 360, run: activateInternships },
];
