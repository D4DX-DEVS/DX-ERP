import "server-only";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Review, StoredFile, User } from "@/lib/models";
import { notify, notifyPermission } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { addDays, fmtDate, monthKey, todayKey } from "@/lib/time";
import type { Job } from "./registry";

const EXITED = ["resigned", "terminated", "inactive"];
const ACTIVE_STAFF: Record<string, unknown> = { personType: { $in: ["employee", "trainee", "intern"] }, status: { $nin: EXITED } };

/** Dotted projections lose Mongoose's static types, so the jobs name the row shape they read. */
interface PersonRow {
  _id: Types.ObjectId;
  name: string;
  employeeId: string;
  reportingManager?: Types.ObjectId;
  exit?: { lastWorkingDay?: string };
  internship?: { mentor?: Types.ObjectId; endDate?: string };
}

/**
 * Document expiry reminders: a document that is about to expire (within `reminderDaysBefore`) or
 * already expired notifies its owner and everyone who can edit staff records. Reminders are deduped per
 * document + expiry date (and once more when it actually expires).
 */
async function documentExpiry(): Promise<string> {
  await connectDB();
  const settings = await getSettings();
  const today = todayKey();
  const horizon = addDays(today, Math.max(1, settings.notifications.reminderDaysBefore));
  const files = await StoredFile.find(
    { entityType: "user", deletedAt: null, replacedBy: null, category: { $nin: [null, ""] }, expiryDate: { $gt: "", $lte: horizon } },
    { entityId: 1, category: 1, expiryDate: 1, name: 1 },
  )
    .sort({ expiryDate: 1 })
    .limit(500)
    .lean();
  if (files.length === 0) return "no documents expiring";

  const owners = await User.find({ _id: { $in: [...new Set(files.flatMap((f) => (f.entityId ? [f.entityId] : [])))] }, ...ACTIVE_STAFF }, { name: 1, employeeId: 1 }).lean();
  const ownerById = new Map(owners.map((o) => [o._id.toString(), o]));
  const labels = new Map(settings.documentCategories.map((c) => [c.key, c.label]));

  let sent = 0;
  for (const f of files) {
    const owner = f.entityId ? ownerById.get(f.entityId) : undefined;
    if (!owner || !f.expiryDate) continue;
    const expired = f.expiryDate < today;
    const label = labels.get(f.category ?? "") ?? f.name;
    const when = fmtDate(f.expiryDate);
    const dedupeKey = `doc-expiry:${f._id}:${f.expiryDate}${expired ? ":expired" : ""}`;
    await notify(
      [owner._id],
      {
        type: "document",
        title: expired ? `Your ${label} has expired` : `Your ${label} expires on ${when}`,
        body: expired ? `It expired on ${when}. Please upload a renewed copy.` : "Please upload a renewed copy before it expires.",
        link: "/profile#documents",
        priority: expired ? "high" : "normal",
        dedupeKey,
      },
    );
    await notifyPermission(
      "staff.edit",
      {
        type: "document",
        title: expired ? `${owner.name}: ${label} expired` : `${owner.name}: ${label} expires on ${when}`,
        body: `${owner.name} (${owner.employeeId}) — follow up for a renewed document.`,
        link: `/staff/${owner._id}?tab=documents`,
        priority: expired ? "high" : "normal",
        dedupeKey,
      },
      [owner._id],
    );
    sent++;
  }
  return `${sent} document reminder${sent === 1 ? "" : "s"} processed`;
}

/** Notice periods ending within 7 days → people who can edit staff records (+ the manager). */
async function noticeEnding(): Promise<string> {
  await connectDB();
  const today = todayKey();
  const people = await User.find(
    { personType: { $in: ["employee", "trainee", "intern"] }, "exit.stage": "notice", "exit.lastWorkingDay": { $gte: today, $lte: addDays(today, 7) } },
    { name: 1, employeeId: 1, reportingManager: 1, "exit.lastWorkingDay": 1 },
  ).lean<PersonRow[]>();
  for (const p of people) {
    const last = p.exit?.lastWorkingDay;
    if (!last) continue;
    const input = {
      type: "system",
      title: `${p.name}'s notice period ends ${last === today ? "today" : `on ${fmtDate(last)}`}`,
      body: `${p.name} (${p.employeeId}) — complete the exit: assets, handover and access.`,
      link: `/staff/${p._id}?tab=history`,
      actionable: true,
      dedupeKey: `notice-end:${p._id}:${last}`,
    };
    await notifyPermission("staff.edit", input);
    await notify([p.reportingManager], input);
  }
  return `${people.length} notice period${people.length === 1 ? "" : "s"} ending soon`;
}

/** Internships ending within 7 days (or already past their end date) → mentor + interns.manage. */
async function internshipEnding(): Promise<string> {
  await connectDB();
  const today = todayKey();
  const people = await User.find(
    { personType: { $in: ["trainee", "intern"] }, status: { $nin: EXITED }, "internship.status": { $in: ["active", "extended"] }, "internship.endDate": { $lte: addDays(today, 7) } },
    { name: 1, employeeId: 1, "internship.mentor": 1, "internship.endDate": 1 },
  ).lean<PersonRow[]>();
  for (const p of people) {
    const end = p.internship?.endDate;
    if (!end) continue;
    const over = end < today;
    const input = {
      type: "internship",
      title: over ? `${p.name}'s internship end date has passed` : `${p.name}'s internship ends ${end === today ? "today" : `on ${fmtDate(end)}`}`,
      body: over ? "Complete or extend the internship." : "Schedule the final evaluation and complete or extend the internship.",
      link: `/interns/${p._id}?tab=completion`,
      actionable: true,
      dedupeKey: `${over ? "internship-ended" : "internship-end"}:${p._id}:${end}`,
    };
    await notify([p.internship?.mentor], input);
    await notifyPermission("interns.manage", input, [p.internship?.mentor]);
  }
  return `${people.length} internship${people.length === 1 ? "" : "s"} ending soon`;
}

/** Monthly evaluation reminder: running internships with no shared evaluation in the last 30 days → mentor. */
async function reviewDue(): Promise<string> {
  await connectDB();
  const today = todayKey();
  const month = monthKey();
  const running = await User.find(
    { personType: { $in: ["trainee", "intern"] }, status: { $nin: EXITED }, "internship.status": { $in: ["active", "extended"] }, "internship.startDate": { $lte: addDays(today, -30) } },
    { name: 1, employeeId: 1, "internship.mentor": 1 },
  ).lean<PersonRow[]>();
  if (running.length === 0) return "no running internships";
  const recent = new Set((await Review.distinct("user", { user: { $in: running.map((p) => p._id) }, status: "shared", date: { $gte: addDays(today, -30) } })).map(String));
  let due = 0;
  for (const p of running) {
    if (recent.has(p._id.toString())) continue;
    due++;
    const input = {
      type: "internship",
      title: `Evaluation due for ${p.name}`,
      body: "No evaluation has been shared in the last 30 days.",
      link: `/interns/${p._id}?tab=evaluations`,
      actionable: true,
      dedupeKey: `review-due:${p._id}:${month}`,
    };
    if (p.internship?.mentor) await notify([p.internship.mentor], input);
    else await notifyPermission("interns.manage", input);
  }
  return `${due} evaluation reminder${due === 1 ? "" : "s"} due`;
}

/** Registered internships whose start date has arrived become active. */
async function activateInternships(): Promise<string> {
  await connectDB();
  const res = await User.updateMany(
    { personType: { $in: ["trainee", "intern"] }, status: { $nin: EXITED }, "internship.status": "registered", "internship.startDate": { $lte: todayKey() } },
    { $set: { "internship.status": "active" } },
  );
  return `${res.modifiedCount} internship${res.modifiedCount === 1 ? "" : "s"} activated`;
}

export const peopleJobs: Job[] = [
  { name: "people-document-expiry", intervalMinutes: 360, run: documentExpiry },
  { name: "people-notice-ending", intervalMinutes: 720, run: noticeEnding },
  { name: "people-internship-ending", intervalMinutes: 720, run: internshipEnding },
  { name: "people-internship-review-due", intervalMinutes: 720, run: reviewDue },
  { name: "people-internship-activate", intervalMinutes: 360, run: activateInternships },
];
