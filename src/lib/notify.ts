import "server-only";
import { after } from "next/server";
import { and, eq, getTableColumns, or } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { db } from "@/lib/db";
import { runBatch } from "@/lib/domain/batch";
import { Notification, Role, User, type Id } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { sendMail } from "@/lib/mailer";
import { env } from "@/lib/env";
import { inList, jsonHas, notInList } from "@/lib/sql";
import { reservedPermissions, SUPER_ADMIN_ONLY, type Permission } from "@/lib/rbac/permissions";

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

export interface NotifyItem {
  recipients: (Id | null | undefined)[];
  input: NotifyInput;
  /** People never notified by this item (usually the actor). */
  exclude?: (Id | null | undefined)[];
}

/** Sends an in-app notification (and optionally email) to each recipient. Never throws. */
export async function notify(recipients: (Id | null | undefined)[], input: NotifyInput, exclude: (Id | null | undefined)[] = []): Promise<void> {
  await notifyMany([{ recipients, input, exclude }]);
}

/**
 * Same as calling `notify(recipients, input, exclude)` for each item, in a fixed number of queries however many
 * items and people there are (D1 caps the queries per request): one lookup of already-delivered dedupe keys, the
 * settings, one batched insert and, after the response, one user lookup for the emails. Never throws. Returns the
 * number of (person, notification) deliveries.
 */
export async function notifyMany(items: NotifyItem[]): Promise<number> {
  try {
    const planned = items.map(({ recipients, input, exclude }) => ({ ids: uniqueIds(recipients, exclude), input })).filter((p) => p.ids.length > 0);
    if (planned.length === 0) return 0;

    // Which (person, dedupeKey) pairs were already delivered — one lookup for the whole set.
    const keys = [...new Set(planned.flatMap((p) => (p.input.dedupeKey ? [p.input.dedupeKey] : [])))];
    const seen = new Set<string>();
    if (keys.length) {
      const already = await db()
        .select({ user: Notification.user, dedupeKey: Notification.dedupeKey })
        .from(Notification)
        .where(and(inList(Notification.dedupeKey, keys), inList(Notification.user, [...new Set(planned.flatMap((p) => p.ids))])));
      for (const n of already) seen.add(`${n.user}|${n.dedupeKey}`);
    }

    const settings = await getSettings();
    const deliveries: { ids: string[]; input: NotifyInput }[] = [];
    for (const { ids, input } of planned) {
      if (settings.notifications.events[input.type] === false) continue;
      const fresh = input.dedupeKey ? ids.filter((id) => !seen.has(`${id}|${input.dedupeKey}`)) : ids;
      if (fresh.length === 0) continue;
      if (input.dedupeKey) for (const id of fresh) seen.add(`${id}|${input.dedupeKey}`);
      deliveries.push({ ids: fresh, input });
    }
    if (deliveries.length === 0) return 0;

    if (settings.notifications.inApp) {
      const rows = deliveries.flatMap(({ ids, input }) =>
        ids.map((user) => ({
          user,
          type: input.type,
          title: input.title,
          body: input.body,
          link: input.link,
          priority: input.priority ?? "normal",
          dedupeKey: input.dedupeKey,
          actionable: input.actionable ?? false,
        })),
      );
      // Chunks sized for D1's 100-bound-parameter limit, sent as batches (one round trip per 50 chunks).
      // A concurrent delivery of the same dedupeKey is skipped by the (user, dedupeKey) unique index.
      const size = Math.max(1, Math.floor(100 / Object.keys(getTableColumns(Notification)).length));
      const inserts: BatchItem<"sqlite">[] = [];
      for (let i = 0; i < rows.length; i += size) inserts.push(db().insert(Notification).values(rows.slice(i, i + size)).onConflictDoNothing());
      await runBatch(inserts);
    }

    if (settings.notifications.email && env.smtp.configured) {
      const send = async () => {
        const users = await db()
          .select({ id: User._id, email: User.email })
          .from(User)
          .where(and(inList(User._id, [...new Set(deliveries.flatMap((d) => d.ids))]), eq(User.accountActive, true)));
        const emailOf = new Map(users.map((u) => [u.id, u.email]));
        for (const { ids, input } of deliveries) {
          for (const id of ids) {
            const to = emailOf.get(id);
            if (!to) continue;
            await sendMail({
              to,
              subject: input.title,
              text: `${input.body ?? input.title}${input.link ? `\n\nOpen: ${env.appUrl}${input.link}` : ""}`,
            });
          }
        }
      };
      try {
        after(send);
      } catch {
        void send().catch((e) => console.error("[notify] email failed", e));
      }
    }
    return deliveries.reduce((n, d) => n + d.ids.length, 0);
  } catch (error) {
    console.error("[notify] failed", error);
    return 0;
  }
}

/** Active users holding a permission (plus the super admin). */
export async function usersWithPermission(permission: Permission): Promise<string[]> {
  // Super-admin-only (and QA-Engineer-only) permissions may still be listed on old role rows; they don't count there.
  const roles = SUPER_ADMIN_ONLY.includes(permission)
    ? []
    : (await db().select({ key: Role.key }).from(Role).where(jsonHas(Role.permissions, permission))).filter((r) => !reservedPermissions(r.key).includes(permission));
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
