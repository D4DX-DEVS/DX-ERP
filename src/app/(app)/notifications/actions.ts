"use server";

import { z } from "zod";
import { actionPermission, actionUser, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { Announcement, Notification, PERSON_TYPES, Role, User } from "@/lib/models";
import { notify } from "@/lib/notify";
import { EXITED_STATUSES } from "@/lib/people";
import { isObjectId, zs } from "@/lib/validation";
import { todayKey } from "@/lib/time";

export async function markNotificationRead(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!isObjectId(id)) throw new ActionError("Notification not found.");
    await Notification.updateOne({ _id: id, user: user._id, read: false }, { $set: { read: true, readAt: new Date() } });
    return null;
  });
}

export async function markAllNotificationsRead(): Promise<ActionResult<{ count: number }>> {
  return runAction(
    async () => {
      const user = await actionUser();
      const res = await Notification.updateMany({ user: user._id, read: false }, { $set: { read: true, readAt: new Date() } });
      return { count: res.modifiedCount };
    },
    "All notifications marked as read",
  );
}

export async function deleteNotification(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!isObjectId(id)) throw new ActionError("Notification not found.");
    await Notification.deleteOne({ _id: id, user: user._id });
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
    let people: Record<string, unknown> = {
      $or: [{ isSuperAdmin: true }, { accountActive: true, status: { $nin: EXITED_STATUSES } }],
    };
    if (data.audienceMode === "selected") {
      const types = data.types.filter((t): t is (typeof PERSON_TYPES)[number] => (PERSON_TYPES as string[]).includes(t));
      const known = data.roles.length ? await Role.find({ key: { $in: data.roles } }, { key: 1 }).lean() : [];
      const roles = known.map((r) => r.key);
      if (types.length === 0 && roles.length === 0) throw new ActionError("Choose who should see this announcement.", { audience: "Select at least one role or person type" });
      audience = [...types, ...roles];
      people = {
        accountActive: true,
        status: { $nin: EXITED_STATUSES },
        $or: [...(types.length ? [{ personType: { $in: types } }] : []), ...(roles.length ? [{ role: { $in: roles } }] : [])],
      };
    }

    const doc = await Announcement.create({
      title: data.title,
      body: data.body,
      audience,
      pinned: data.pinned,
      expiresOn: data.expiresOn,
      publishedBy: user._id,
      publishedByName: user.name,
    });

    const recipients = await User.find(people, { _id: 1 }).lean();
    const ids = recipients.map((r) => r._id);
    await notify(ids, { type: "announcement", title: data.title, body: data.body.length > 200 ? `${data.body.slice(0, 197)}…` : data.body, link: "/notifications", priority: data.pinned ? "high" : "normal" }, [user._id]);

    await audit(user, {
      action: "create",
      entity: "announcement",
      entityId: doc._id,
      ref: data.title,
      summary: `Published announcement "${data.title}" to ${audience.includes("all") ? "everyone" : audience.join(", ")}`,
    });
    return { id: doc._id.toString(), notified: ids.filter((id) => id.toString() !== user.id).length };
  }, "Announcement published");
}

export async function deleteAnnouncement(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("announcements.manage");
    if (!isObjectId(id)) throw new ActionError("Announcement not found.");
    const doc = await Announcement.findByIdAndDelete(id).lean();
    if (!doc) throw new ActionError("Announcement not found.");
    await audit(user, { action: "delete", entity: "announcement", entityId: id, ref: doc.title, summary: `Removed announcement "${doc.title}"` });
    return null;
  }, "Announcement removed");
}
