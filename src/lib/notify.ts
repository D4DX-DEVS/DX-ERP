import "server-only";
import { after } from "next/server";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Notification, Role, User } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { sendMail } from "@/lib/mailer";
import { env } from "@/lib/env";
import type { Permission } from "@/lib/rbac/permissions";

type Id = string | Types.ObjectId;

export interface NotifyInput {
  /** Category key — must match a key in NOTIFICATION_EVENTS so it can be toggled in settings. */
  type: string;
  title: string;
  body?: string;
  link?: string;
  priority?: "normal" | "high";
  /** Same key for the same user is only ever delivered once (used by reminders). */
  dedupeKey?: string;
  actionable?: boolean;
}

function uniqueIds(ids: (Id | null | undefined)[], exclude: (Id | null | undefined)[] = []): string[] {
  const skip = new Set(exclude.filter(Boolean).map((x) => x!.toString()));
  return [...new Set(ids.filter(Boolean).map((x) => x!.toString()))].filter((x) => !skip.has(x));
}

/** Sends an in-app notification (and optionally email) to each recipient. Never throws. */
export async function notify(recipients: (Id | null | undefined)[], input: NotifyInput, exclude: (Id | null | undefined)[] = []): Promise<void> {
  try {
    let ids = uniqueIds(recipients, exclude);
    if (ids.length === 0) return;
    await connectDB();
    if (input.dedupeKey) {
      // Reminders with a dedupe key are delivered (in-app and email) once per user.
      const already = await Notification.find({ user: { $in: ids }, dedupeKey: input.dedupeKey }, { user: 1 }).lean();
      const seen = new Set(already.map((n) => n.user.toString()));
      ids = ids.filter((id) => !seen.has(id));
      if (ids.length === 0) return;
    }
    const settings = await getSettings();
    if (settings.notifications.events[input.type] === false) return;

    if (settings.notifications.inApp) {
      const docs = ids.map((user) => ({
        user,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link,
        priority: input.priority ?? "normal",
        dedupeKey: input.dedupeKey,
        actionable: input.actionable ?? false,
      }));
      await Notification.insertMany(docs, { ordered: false }).catch((error: unknown) => {
        // Duplicate dedupe keys are expected for repeated reminders.
        if ((error as { code?: number })?.code !== 11000 && !String(error).includes("E11000")) throw error;
      });
    }

    if (settings.notifications.email && env.smtp.configured) {
      const send = async () => {
        const users = await User.find({ _id: { $in: ids }, accountActive: true }, { email: 1, name: 1 }).lean();
        for (const u of users) {
          await sendMail({
            to: u.email,
            subject: input.title,
            text: `${input.body ?? input.title}${input.link ? `\n\nOpen: ${env.appUrl}${input.link}` : ""}`,
          });
        }
      };
      try {
        after(send);
      } catch {
        void send().catch((e) => console.error("[notify] email failed", e));
      }
    }
  } catch (error) {
    console.error("[notify] failed", error);
  }
}

/** Active users holding a permission (plus the super admin). */
export async function usersWithPermission(permission: Permission): Promise<string[]> {
  await connectDB();
  const roles = await Role.find({ permissions: permission }, { key: 1 }).lean();
  const users = await User.find(
    {
      $or: [{ isSuperAdmin: true }, { role: { $in: roles.map((r) => r.key) }, accountActive: true, status: { $nin: ["resigned", "terminated", "inactive"] } }],
    },
    { _id: 1 },
  ).lean();
  return users.map((u) => u._id.toString());
}

export async function notifyPermission(permission: Permission, input: NotifyInput, exclude: (Id | null | undefined)[] = []): Promise<void> {
  try {
    const ids = await usersWithPermission(permission);
    await notify(ids, input, exclude);
  } catch (error) {
    console.error("[notify] permission broadcast failed", error);
  }
}

/** Reporting manager of a user, if any. */
export async function managerOf(userId: Id): Promise<string | undefined> {
  await connectDB();
  const user = await User.findById(userId, { reportingManager: 1 }).lean();
  return user?.reportingManager?.toString();
}
