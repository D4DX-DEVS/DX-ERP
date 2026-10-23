import "server-only";
import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { Movement, User } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { usersWithPermission } from "@/lib/notify";
import { inList } from "@/lib/sql";
import { fmtDate, fmtTime, todayKey } from "@/lib/time";
import { notifyBatch, type BatchedNotification } from "./batch";
import type { Job } from "./registry";

/** Name and reporting manager of the people behind a set of movements (one query). */
async function peopleOf(userIds: string[]): Promise<Map<string, { name: string; reportingManager: string | null }>> {
  const users = await db()
    .select({ id: User._id, name: User.name, reportingManager: User.reportingManager })
    .from(User)
    .where(inList(User._id, [...new Set(userIds)]));
  return new Map(users.map((u) => [u.id, u]));
}

/** Movement reminders (FRS §8.10): expected return exceeded, missing In-Time, pending approvals. */
export const movementJobs: Job[] = [
  {
    name: "movement-overdue",
    intervalMinutes: 5,
    run: async () => {
      const settings = await getSettings();
      const cutoff = new Date(Date.now() - settings.movement.overdueGraceMinutes * 60_000);
      const overdue = await db()
        .select({ id: Movement._id, user: Movement.user, movementNo: Movement.movementNo, expectedReturn: Movement.expectedReturn, categoryLabel: Movement.categoryLabel })
        .from(Movement)
        .where(and(eq(Movement.status, "out"), lt(Movement.expectedReturn, cutoff), isNull(Movement.overdueNotifiedAt)))
        .limit(200);
      if (overdue.length === 0) return "none";
      const [hr, byId] = await Promise.all([usersWithPermission("movement.manage"), peopleOf(overdue.map((m) => m.user))]);
      const items: BatchedNotification[] = [];
      for (const m of overdue) {
        const u = byId.get(m.user);
        items.push({
          recipients: [m.user],
          input: {
            type: "movement",
            title: "You're past your expected return time",
            body: `${m.movementNo} · expected back at ${fmtTime(m.expectedReturn)}. Record your In-Time or update the return time.`,
            link: `/movement/${m.id}`,
            priority: "high",
            dedupeKey: `mv-overdue-self:${m.id}:${m.expectedReturn?.toISOString()}`,
          },
        });
        items.push({
          recipients: [u?.reportingManager, ...hr],
          exclude: [m.user],
          input: {
            type: "movement",
            title: `Overdue movement: ${u?.name ?? "Staff member"}`,
            body: `${m.movementNo} · ${m.categoryLabel} · expected back at ${fmtTime(m.expectedReturn)}`,
            link: `/movement/${m.id}`,
            priority: "high",
            dedupeKey: `mv-overdue:${m.id}:${m.expectedReturn?.toISOString()}`,
          },
        });
      }
      await notifyBatch(items);
      await db().update(Movement).set({ overdueNotifiedAt: new Date() }).where(inList(Movement._id, overdue.map((m) => m.id)));
      return `${overdue.length} overdue`;
    },
  },
  {
    name: "movement-missing-in",
    intervalMinutes: 60,
    run: async () => {
      const today = todayKey();
      const open = await db()
        .select({ id: Movement._id, user: Movement.user, movementNo: Movement.movementNo, date: Movement.date, outTime: Movement.outTime, categoryLabel: Movement.categoryLabel })
        .from(Movement)
        .where(and(eq(Movement.status, "out"), lt(Movement.date, today)))
        .limit(200);
      if (open.length === 0) return "none";
      const [hr, byId] = await Promise.all([usersWithPermission("movement.manage"), peopleOf(open.map((m) => m.user))]);
      const items: BatchedNotification[] = [];
      for (const m of open) {
        const u = byId.get(m.user);
        items.push({
          recipients: [m.user],
          input: {
            type: "movement",
            title: "Missing In-Time",
            body: `${m.movementNo} from ${fmtDate(m.date)} has no In-Time. Request a correction with the time you returned.`,
            link: `/movement/${m.id}`,
            priority: "high",
            dedupeKey: `mv-missing-self:${m.id}:${today}`,
          },
        });
        items.push({
          recipients: [u?.reportingManager, ...hr],
          exclude: [m.user],
          input: {
            type: "movement",
            title: `Missing In-Time: ${u?.name ?? "Staff member"}`,
            body: `${m.movementNo} (${m.categoryLabel}) opened ${fmtDate(m.date)} ${fmtTime(m.outTime)} is still open.`,
            link: `/movement/${m.id}`,
            actionable: true,
            dedupeKey: `mv-missing:${m.id}:${today}`,
          },
        });
      }
      await notifyBatch(items);
      return `${open.length} open from earlier days`;
    },
  },
  {
    name: "movement-pending-approvals",
    intervalMinutes: 240,
    run: async () => {
      const today = todayKey();
      const stale = await db()
        .select({ id: Movement._id, user: Movement.user, movementNo: Movement.movementNo, categoryLabel: Movement.categoryLabel, approvalStatus: Movement.approvalStatus })
        .from(Movement)
        .where(and(inList(Movement.approvalStatus, ["pending", "correction_requested"]), lt(Movement.updatedAt, new Date(Date.now() - 24 * 3_600_000))))
        .limit(200);
      if (stale.length === 0) return "none";
      const [approvers, byId] = await Promise.all([usersWithPermission("movement.approve"), peopleOf(stale.map((m) => m.user))]);
      await notifyBatch(
        stale.map((m) => {
          const u = byId.get(m.user);
          return {
            recipients: u?.reportingManager ? [u.reportingManager] : approvers,
            exclude: [m.user],
            input: {
              type: "movement",
              title: `Reminder: movement waiting for approval`,
              body: `${u?.name ?? "Staff member"} · ${m.movementNo} · ${m.approvalStatus === "correction_requested" ? "correction request" : m.categoryLabel}`,
              link: `/movement/${m.id}`,
              actionable: true,
              dedupeKey: `mv-pending:${m.id}:${today}`,
            },
          };
        }),
      );
      return `${stale.length} reminders`;
    },
  },
];
