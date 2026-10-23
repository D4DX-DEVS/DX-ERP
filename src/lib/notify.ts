import "server-only";
import { after } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { Notification, Role, User, type Id } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { sendMail } from "@/lib/mailer";
import { env } from "@/lib/env";
import { inList, insertChunked, jsonHas, notInList } from "@/lib/sql";
import type { Permission } from "@/lib/rbac/permissions";

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
  const skip = new Set(exclude.filter(Boolean));
  return [...new Set(ids.filter((x): x is Id => Boolean(x)))].filter((x) => !skip.has(x));
}

/** Sends an in-app notification (and optionally email) to each recipient. Never throws. */
export async function notify(recipients: (Id | null | undefined)[], input: NotifyInput, exclude: (Id | null | undefined)[] = []): Promise<void> {
  try {
    let ids = uniqueIds(recipients, exclude);
    if (ids.length === 0) return;
    if (input.dedupeKey) {
      const already = await db()
        .select({ user: Notification.user })
        .from(Notification)
        .where(and(inList(Notification.user, ids), eq(Notification.dedupeKey, input.dedupeKey)));
      const seen = new Set(already.map((n) => n.user));
      ids = ids.filter((id) => !seen.has(id));
      if (ids.length === 0) return;
    }
    const settings = await getSettings();
    if (settings.notifications.events[input.type] === false) return;

    if (settings.notifications.inApp) {
      const rows = ids.map((user) => ({
        user,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link,
        priority: input.priority ?? "normal",
        dedupeKey: input.dedupeKey,
        actionable: input.actionable ?? false,
      }));
      // A concurrent delivery of the same dedupeKey is skipped by the (user, dedupeKey) unique index.
      await insertChunked(db(), Notification, rows, { ignoreConflicts: true });
    }

    if (settings.notifications.email && env.smtp.configured) {
      const send = async () => {
        const users = await db()
          .select({ email: User.email, name: User.name })
          .from(User)
          .where(and(inList(User._id, ids), eq(User.accountActive, true)));
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
  const roles = await db().select({ key: Role.key }).from(Role).where(jsonHas(Role.permissions, permission));
  const users = await db()
    .select({ id: User._id })
    .from(User)
    .where(
      or(
        eq(User.isSuperAdmin, true),
        and(
          inList(
            User.role,
            roles.map((r) => r.key),
          ),
          eq(User.accountActive, true),
          notInList(User.status, ["resigned", "terminated", "inactive"]),
        ),
      ),
    );
  return users.map((u) => u.id);
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
  const [user] = await db().select({ reportingManager: User.reportingManager }).from(User).where(eq(User._id, userId)).limit(1);
  return user?.reportingManager ?? undefined;
}
