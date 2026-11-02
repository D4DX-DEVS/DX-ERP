"use server";

import { revalidatePath } from "next/cache";
import { and, eq, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { actionPermission, actionUser, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { Announcement, Notification, PERSON_TYPES, Role, User } from "@/lib/models";
import { notify } from "@/lib/notify";
import { EXITED_STATUSES } from "@/lib/people";
import { inList, notInList } from "@/lib/sql";
import { isObjectId, zs } from "@/lib/validation";
import { todayKey } from "@/lib/time";

/**
 * Read-state changes re-render the inbox in the same round trip and drop stale copies of visited pages from the
 * browser's router cache, so going back to the inbox (or the dashboard) never shows an old unread dot.
 */
function refreshInbox() {
  revalidatePath("/notifications");
}

export async function markNotificationRead(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!isObjectId(id)) throw new ActionError("Notification not found.");
    await db()
      .update(Notification)
      .set({ read: true, readAt: new Date() })
      .where(and(eq(Notification._id, id), eq(Notification.user, user._id), eq(Notification.read, false)));
    refreshInbox();
    return null;
  });
}

export async function markNotificationUnread(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!isObjectId(id)) throw new ActionError("Notification not found.");
    await db()
      .update(Notification)
      .set({ read: false, readAt: null })
      .where(and(eq(Notification._id, id), eq(Notification.user, user._id), eq(Notification.read, true)));
    refreshInbox();
    return null;
  });
}

export async function markAllNotificationsRead(): Promise<ActionResult<{ count: number }>> {
  return runAction(
    async () => {
      const user = await actionUser();
      const done = await db()
        .update(Notification)
        .set({ read: true, readAt: new Date() })
        .where(and(eq(Notification.user, user._id), eq(Notification.read, false)))
        .returning({ id: Notification._id });
      refreshInbox();
      return { count: done.length };
    },
    "All notifications marked as read",
  );
}

export async function deleteNotification(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!isObjectId(id)) throw new ActionError("Notification not found.");
    await db().delete(Notification).where(and(eq(Notification._id, id), eq(Notification.user, user._id)));
    refreshInbox();
    return null;
  }, "Notification removed");
}

const announcementSchema = z.object({
  title: zs.text("Title", 200),
  body: zs.text("Message", 5000),
  audienceMode: z.preprocess((v) => (v === "selected" ? "selected" : "all"), z.enum(["all", "selected"])),
  types: zs.list(),
  roles: zs.list(),
  pinned: zs.bool(),
  expiresOn: zs.optDate(),
});

/** Publishes an announcement and notifies everyone in the audience (FRS §4.2, §18). */
export async function createAnnouncement(input: Record<string, unknown>): Promise<ActionResult<{ id: string; notified: number }>> {
  return runAction(async () => {
    const user = await actionPermission("announcements.manage");
    const data = parse(announcementSchema, input);

    if (data.expiresOn && data.expiresOn < todayKey()) throw new ActionError("The expiry date is in the past.", { expiresOn: "Choose today or a later date" });

    let audience = ["all"];
    let people: SQL | undefined = or(eq(User.isSuperAdmin, true), and(eq(User.accountActive, true), notInList(User.status, EXITED_STATUSES)));
    if (data.audienceMode === "selected") {
      const types = data.types.filter((t): t is (typeof PERSON_TYPES)[number] => (PERSON_TYPES as string[]).includes(t));
      const known = data.roles.length ? await db().select({ key: Role.key }).from(Role).where(inList(Role.key, data.roles)) : [];
      const roles = known.map((r) => r.key);
      if (types.length === 0 && roles.length === 0) throw new ActionError("Choose who should see this announcement.", { audience: "Select at least one role or person type" });
      audience = [...types, ...roles];
      people = and(
        eq(User.accountActive, true),
        notInList(User.status, EXITED_STATUSES),
        or(types.length ? inList(User.personType, types) : undefined, roles.length ? inList(User.role, roles) : undefined),
      );
    }

    const [doc] = await db()
      .insert(Announcement)
      .values({
        title: data.title,
        body: data.body,
        audience,
        pinned: data.pinned,
        expiresOn: data.expiresOn,
        publishedBy: user._id,
        publishedByName: user.name,
      })
      .returning();

    const recipients = await db().select({ id: User._id }).from(User).where(people);
    const ids = recipients.map((r) => r.id);
    await notify(ids, { type: "announcement", title: data.title, body: data.body.length > 200 ? `${data.body.slice(0, 197)}…` : data.body, link: "/notifications", priority: data.pinned ? "high" : "normal" }, [user._id]);

    await audit(user, {
      action: "create",
      entity: "announcement",
      entityId: doc._id,
      ref: data.title,
      summary: `Published announcement "${data.title}" to ${audience.includes("all") ? "everyone" : audience.join(", ")}`,
    });
    return { id: doc._id, notified: ids.filter((id) => id !== user.id).length };
  }, "Announcement published");
}

export async function deleteAnnouncement(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("announcements.manage");
    if (!isObjectId(id)) throw new ActionError("Announcement not found.");
    const [doc] = await db().delete(Announcement).where(eq(Announcement._id, id)).returning({ title: Announcement.title });
    if (!doc) throw new ActionError("Announcement not found.");
    await audit(user, { action: "delete", entity: "announcement", entityId: id, ref: doc.title, summary: `Removed announcement "${doc.title}"` });
    return null;
  }, "Announcement removed");
}
