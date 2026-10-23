import "server-only";
import { connectDB } from "@/lib/db";
import { Movement, User } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { notify, usersWithPermission } from "@/lib/notify";
import { fmtDate, fmtTime, todayKey } from "@/lib/time";
import type { Job } from "./registry";

/** Movement reminders (FRS §8.10): expected return exceeded, missing In-Time, pending approvals. */
export const movementJobs: Job[] = [
  {
    name: "movement-overdue",
    intervalMinutes: 5,
    run: async () => {
      await connectDB();
      const settings = await getSettings();
      const cutoff = new Date(Date.now() - settings.movement.overdueGraceMinutes * 60_000);
      const overdue = await Movement.find({ status: "out", expectedReturn: { $lt: cutoff }, overdueNotifiedAt: null }).limit(200).lean();
      if (overdue.length === 0) return "none";
      const hr = await usersWithPermission("movement.manage");
      const users = await User.find({ _id: { $in: overdue.map((m) => m.user) } }, { name: 1, reportingManager: 1 }).lean();
      const byId = new Map(users.map((u) => [u._id.toString(), u]));
      for (const m of overdue) {
        const u = byId.get(m.user.toString());
        await notify([m.user], {
          type: "movement",
          title: "You're past your expected return time",
          body: `${m.movementNo} · expected back at ${fmtTime(m.expectedReturn)}. Record your In-Time or update the return time.`,
          link: `/movement/${m._id}`,
          priority: "high",
          dedupeKey: `mv-overdue-self:${m._id}:${m.expectedReturn?.toISOString()}`,
        });
        await notify([u?.reportingManager, ...hr], {
          type: "movement",
          title: `Overdue movement: ${u?.name ?? "Staff member"}`,
          body: `${m.movementNo} · ${m.categoryLabel} · expected back at ${fmtTime(m.expectedReturn)}`,
          link: `/movement/${m._id}`,
          priority: "high",
          dedupeKey: `mv-overdue:${m._id}:${m.expectedReturn?.toISOString()}`,
        }, [m.user]);
        await Movement.updateOne({ _id: m._id }, { $set: { overdueNotifiedAt: new Date() } });
      }
      return `${overdue.length} overdue`;
    },
  },
  {
    name: "movement-missing-in",
    intervalMinutes: 60,
    run: async () => {
      await connectDB();
      const today = todayKey();
      const open = await Movement.find({ status: "out", date: { $lt: today } }).limit(200).lean();
      if (open.length === 0) return "none";
      const hr = await usersWithPermission("movement.manage");
      const users = await User.find({ _id: { $in: open.map((m) => m.user) } }, { name: 1, reportingManager: 1 }).lean();
      const byId = new Map(users.map((u) => [u._id.toString(), u]));
      for (const m of open) {
        const u = byId.get(m.user.toString());
        await notify([m.user], {
          type: "movement",
          title: "Missing In-Time",
          body: `${m.movementNo} from ${fmtDate(m.date)} has no In-Time. Request a correction with the time you returned.`,
          link: `/movement/${m._id}`,
          priority: "high",
          dedupeKey: `mv-missing-self:${m._id}:${today}`,
        });
        await notify([u?.reportingManager, ...hr], {
          type: "movement",
          title: `Missing In-Time: ${u?.name ?? "Staff member"}`,
          body: `${m.movementNo} (${m.categoryLabel}) opened ${fmtDate(m.date)} ${fmtTime(m.outTime)} is still open.`,
          link: `/movement/${m._id}`,
          actionable: true,
          dedupeKey: `mv-missing:${m._id}:${today}`,
        }, [m.user]);
      }
      return `${open.length} open from earlier days`;
    },
  },
  {
    name: "movement-pending-approvals",
    intervalMinutes: 240,
    run: async () => {
      await connectDB();
      const today = todayKey();
      const stale = await Movement.find({ approvalStatus: { $in: ["pending", "correction_requested"] }, updatedAt: { $lt: new Date(Date.now() - 24 * 3_600_000) } }).limit(200).lean();
      if (stale.length === 0) return "none";
      const approvers = await usersWithPermission("movement.approve");
      const users = await User.find({ _id: { $in: stale.map((m) => m.user) } }, { name: 1, reportingManager: 1 }).lean();
      const byId = new Map(users.map((u) => [u._id.toString(), u]));
      for (const m of stale) {
        const u = byId.get(m.user.toString());
        const recipients = u?.reportingManager ? [u.reportingManager] : approvers;
        await notify(recipients, {
          type: "movement",
          title: `Reminder: movement waiting for approval`,
          body: `${u?.name ?? "Staff member"} · ${m.movementNo} · ${m.approvalStatus === "correction_requested" ? "correction request" : m.categoryLabel}`,
          link: `/movement/${m._id}`,
          actionable: true,
          dedupeKey: `mv-pending:${m._id}:${today}`,
        }, [m.user]);
      }
      return `${stale.length} reminders`;
    },
  },
];
