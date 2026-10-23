"use server";

import { and, eq, not } from "drizzle-orm";
import { z } from "zod";
import { actionPermission, actionUser, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { resolveFileRefs } from "@/lib/files";
import { db } from "@/lib/db";
import { Department, LearningResource, User } from "@/lib/models";
import { notify } from "@/lib/notify";
import { inList, jsonHasField, jsonPath, jsonPush } from "@/lib/sql";
import { isObjectId, zs } from "@/lib/validation";
import { resourceAppliesTo } from "./_lib/visibility";

const AUDIENCES = ["all", "employee", "trainee", "intern"];

const resourceSchema = z.object({
  id: zs.optId(),
  title: zs.text("Title", 200),
  description: zs.optText(5000),
  kind: z.enum(["document", "video", "link", "course", "activity"], { error: "Choose a type" }),
  url: zs.optText(1000),
  attachments: zs.ids(),
  audience: zs.list(),
  department: zs.optId(),
  assignedTo: zs.ids(),
  dueDate: zs.optDate(),
  estimatedHours: zs.optNum({ min: 0, max: 1000 }),
});

/** Creates or edits a learning resource (interns.manage). */
export async function saveResource(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionPermission("interns.manage");
    const data = parse(resourceSchema, input);

    const audience = [...new Set(data.audience.filter((a) => AUDIENCES.includes(a)))];
    if (audience.length === 0 && data.assignedTo.length === 0) {
      throw new ActionError("Choose who this is for, or assign it to specific people.", { audience: "Choose an audience" });
    }
    if (data.url) {
      let ok = false;
      try {
        const u = new URL(data.url);
        ok = u.protocol === "https:" || u.protocol === "http:";
      } catch {
        ok = false;
      }
      if (!ok) throw new ActionError("Enter a valid web address starting with http:// or https://.", { url: "Invalid link" });
    }
    if (data.kind !== "activity" && !data.url && data.attachments.length === 0) {
      throw new ActionError("Add a link or attach a file.", { url: "Add a link or attach a file" });
    }
    if (data.department) {
      const [dept] = await db().select({ id: Department._id }).from(Department).where(eq(Department._id, data.department)).limit(1);
      if (!dept) throw new ActionError("Department not found.", { department: "Not found" });
    }
    if (data.assignedTo.length > 0) {
      const found = await db().$count(User, and(inList(User._id, data.assignedTo), inList(User.personType, ["employee", "trainee", "intern"])));
      if (found !== data.assignedTo.length) throw new ActionError("Some selected people are not available.", { assignedTo: "Invalid selection" });
    }
    const attachments = await resolveFileRefs(user, data.attachments);

    const fields = {
      title: data.title,
      description: data.description,
      kind: data.kind,
      url: data.url,
      attachments,
      audience,
      department: data.department,
      assignedTo: data.assignedTo,
      dueDate: data.dueDate,
      estimatedHours: data.estimatedHours,
    };

    let id: string;
    let previouslyAssigned = new Set<string>();
    if (data.id) {
      const [existing] = await db().select({ _id: LearningResource._id, assignedTo: LearningResource.assignedTo }).from(LearningResource).where(eq(LearningResource._id, data.id)).limit(1);
      if (!existing) throw new ActionError("Resource not found.");
      previouslyAssigned = new Set(existing.assignedTo);
      // Optional fields that were left empty are cleared (null), the rest are set.
      await db()
        .update(LearningResource)
        .set({
          title: fields.title,
          kind: fields.kind,
          attachments,
          audience,
          assignedTo: data.assignedTo,
          description: fields.description ?? null,
          url: fields.url ?? null,
          department: fields.department ?? null,
          dueDate: fields.dueDate ?? null,
          estimatedHours: fields.estimatedHours ?? null,
        })
        .where(eq(LearningResource._id, existing._id));
      id = existing._id;
    } else {
      const [created] = await db()
        .insert(LearningResource)
        .values({ ...fields, createdBy: user._id, createdByName: user.name })
        .returning({ id: LearningResource._id });
      id = created.id;
    }

    const added = data.assignedTo.filter((a) => !previouslyAssigned.has(a));
    if (added.length > 0) {
      await notify(added, { type: "internship", title: `New learning assigned: ${data.title}`, body: data.dueDate ? `Due ${data.dueDate}` : undefined, link: "/learning" }, [user._id]);
    }
    await audit(user, { action: data.id ? "update" : "create", entity: "learning", entityId: id, ref: data.title, summary: `${data.id ? "Updated" : "Created"} learning resource “${data.title}”` });
    return { id };
  }, "Resource saved");
}

export async function setResourceActive(id: string, active: boolean): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("interns.manage");
    if (!isObjectId(id)) throw new ActionError("Resource not found.");
    const [res] = await db().update(LearningResource).set({ active }).where(eq(LearningResource._id, id)).returning({ title: LearningResource.title });
    if (!res) throw new ActionError("Resource not found.");
    await audit(user, { action: "update", entity: "learning", entityId: id, ref: res.title, summary: `${active ? "Reactivated" : "Deactivated"} learning resource “${res.title}”`, changes: [{ field: "active", from: !active, to: active }] });
    return null;
  }, "Resource updated");
}

/** The signed-in person marks a resource they can see as completed (once), with an optional note. */
export async function completeResource(id: string, note?: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!isObjectId(id)) throw new ActionError("Resource not found.");
    const [resource] = await db()
      .select({
        _id: LearningResource._id,
        title: LearningResource.title,
        active: LearningResource.active,
        audience: LearningResource.audience,
        department: LearningResource.department,
        assignedTo: LearningResource.assignedTo,
      })
      .from(LearningResource)
      .where(eq(LearningResource._id, id))
      .limit(1);
    if (!resource) throw new ActionError("Resource not found.");
    if (!resourceAppliesTo(resource, { id: user.id, personType: user.personType, department: user.departmentId })) {
      throw new ActionError("This resource isn't available to you.");
    }
    const text = (note ?? "").trim().slice(0, 1000);
    // The guard in `where` keeps a double click from recording the completion twice.
    const done = await db()
      .update(LearningResource)
      .set({ completions: jsonPush(LearningResource.completions, { user: user._id, at: new Date(), ...(text ? { note: text } : {}) }) })
      .where(and(eq(LearningResource._id, resource._id), not(jsonHasField(LearningResource.completions, "user", user._id))))
      .returning({ id: LearningResource._id });
    if (done.length === 0) throw new ActionError("You have already completed this.");

    const [me] = await db().select({ mentor: jsonPath<string | null>(User.internship, "mentor") }).from(User).where(eq(User._id, user._id)).limit(1);
    await notify([me?.mentor], { type: "internship", title: `${user.name} completed “${resource.title}”`, body: text || undefined, link: `/interns/${user.id}` }, [user._id]);
    return null;
  }, "Marked as complete");
}
