"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { Education, StoredFile, newId, type EducationCertificate } from "@/lib/models";
import { notify } from "@/lib/notify";
import { inList, jsonPush } from "@/lib/sql";
import { todayKey } from "@/lib/time";
import { isObjectId, zs } from "@/lib/validation";
import { autoCompleteSteps } from "../_lib/person";
import { documentActor } from "../_lib/document-actor";
import { EDUCATION_CERTIFICATE_TYPES, EDUCATION_FILE_CATEGORY, EDUCATION_LEVELS, certificateTypeLabel, educationLevelLabel } from "../_lib/education";

const MAX_RECORDS = 30;
const MAX_CERTIFICATES = 20;

const thisYear = () => Number(todayKey().slice(0, 4));
const year = (label: string) => zs.optNum({ min: 1950, max: 2100 }).refine((v) => v === undefined || Number.isInteger(v), `${label} must be a year`);

const recordSchema = z.object({
  personId: zs.id("Person"),
  id: zs.optId(),
  level: z.enum(EDUCATION_LEVELS.map((l) => l.key) as [string, ...string[]], { error: "Choose the level" }),
  qualification: zs.text("Course / qualification", 150),
  institution: zs.optText(200),
  board: zs.optText(200),
  startYear: year("Start year"),
  endYear: year("Year of passing"),
  score: zs.optText(40),
  status: z.preprocess((v) => (v === "" || v == null ? "completed" : v), z.enum(["completed", "pursuing"])),
});

async function loadRecord(personId: string, id: string) {
  if (!isObjectId(id)) throw new ActionError("Education record not found.");
  const [row] = await db().select().from(Education).where(and(eq(Education._id, id), eq(Education.user, personId))).limit(1);
  if (!row) throw new ActionError("Education record not found.");
  return row;
}

/** Adds or edits one qualification (the person themself or HR). */
export async function saveEducation(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const data = parse(recordSchema, input);
    const { user, target, self } = await documentActor(data.personId);
    if (data.startYear && data.endYear && data.endYear < data.startYear) throw new ActionError("The year of passing can't be before the start year.", { endYear: "Before the start year" });
    if (data.status === "completed" && data.endYear && data.endYear > thisYear()) throw new ActionError("A completed course can't pass in a future year. Mark it as pursuing.", { endYear: "In the future" });
    const values = {
      level: data.level,
      qualification: data.qualification,
      institution: data.institution ?? null,
      board: data.board ?? null,
      startYear: data.startYear ?? null,
      endYear: data.endYear ?? null,
      score: data.score ?? null,
      status: data.status,
    };
    const label = `${educationLevelLabel(data.level, true)} · ${data.qualification}`;

    if (data.id) {
      const existing = await loadRecord(target._id, data.id);
      await db().update(Education).set(values).where(eq(Education._id, existing._id));
      await audit(user, { action: "update", entity: "education", entityId: existing._id, ref: target.employeeId, summary: `Updated ${target.name}'s education: ${label}` });
      return { id: existing._id };
    }

    const count = await db().$count(Education, eq(Education.user, target._id));
    if (count >= MAX_RECORDS) throw new ActionError(`A person can have at most ${MAX_RECORDS} education records.`);
    const [row] = await db()
      .insert(Education)
      .values({ ...values, user: target._id, certificates: [], createdBy: user._id })
      .returning({ _id: Education._id });
    await audit(user, { action: "create", entity: "education", entityId: row._id, ref: target.employeeId, summary: `Added ${target.name}'s education: ${label}` });
    if (!self) await notify([target._id], { type: "document", title: "Education record added", body: label, link: "/profile#education" }, [user._id]);
    return { id: row._id };
  }, "Education saved");
}

/** Deletes a qualification and its certificate files. The person may delete a record only while every certificate on it is their own upload. */
export async function deleteEducation(personId: string, id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { user, target, manage } = await documentActor(personId);
    const row = await loadRecord(target._id, id);
    if (!manage && row.certificates.some((c) => c.uploadedBy !== user.id)) throw new ActionError("This record has certificates uploaded by HR. Ask HR to remove it.");
    const files = row.certificates.map((c) => c.file);
    await db().batch([
      db().delete(Education).where(eq(Education._id, row._id)),
      db()
        .update(StoredFile)
        .set({ deletedAt: new Date(), deletedBy: user._id })
        .where(and(inList(StoredFile._id, files), eq(StoredFile.entityId, target._id), isNull(StoredFile.deletedAt))),
    ]);
    await autoCompleteSteps(target._id);
    await audit(user, {
      action: "delete",
      entity: "education",
      entityId: row._id,
      ref: target.employeeId,
      summary: `Deleted ${target.name}'s education: ${educationLevelLabel(row.level, true)} · ${row.qualification} (${files.length} certificate${files.length === 1 ? "" : "s"})`,
    });
    return null;
  }, "Education record deleted");
}

const certificateSchema = z.object({
  personId: zs.id("Person"),
  educationId: zs.id("Education record"),
  type: z.enum(EDUCATION_CERTIFICATE_TYPES.map((t) => t.key) as [string, ...string[]], { error: "Choose the certificate type" }),
  fileId: zs.ids(),
  note: zs.optText(200),
});

/** Attaches an uploaded file to a qualification as a certificate of the chosen type. */
export async function addEducationCertificate(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const data = parse(certificateSchema, input);
    const { user, target, self } = await documentActor(data.personId);
    const row = await loadRecord(target._id, data.educationId);
    const fileId = data.fileId[0];
    if (!fileId) throw new ActionError("Attach a file first.", { fileId: "Attach a file" });
    if (row.certificates.length >= MAX_CERTIFICATES) throw new ActionError(`A qualification can have at most ${MAX_CERTIFICATES} certificates.`);

    const [file] = await db().select().from(StoredFile).where(eq(StoredFile._id, fileId)).limit(1);
    if (!file || file.deletedAt || file.entityType !== "user" || file.entityId !== target._id) throw new ActionError("Uploaded file not found. Please upload it again.", { fileId: "Upload again" });
    if (file.uploadedBy !== user.id) throw new ActionError("You can only attach files you uploaded.");
    if (file.category) throw new ActionError("This file is already registered.");

    const label = `${educationLevelLabel(row.level, true)} · ${certificateTypeLabel(data.type)}`;
    const certificate: EducationCertificate = {
      _id: newId(),
      type: data.type,
      file: file._id,
      name: file.name,
      size: file.size,
      mime: file.mime,
      note: data.note,
      uploadedAt: new Date(),
      uploadedBy: user._id,
      uploadedByName: user.name,
    };
    // Educational certificates are not restricted: anyone who may open the profile can view them (like the old category).
    await db().batch([
      db().update(StoredFile).set({ category: EDUCATION_FILE_CATEGORY, confidential: false, notes: `${label} — ${row.qualification}`.slice(0, 500) }).where(eq(StoredFile._id, file._id)),
      db()
        .update(Education)
        .set({ certificates: jsonPush(Education.certificates, certificate) })
        .where(eq(Education._id, row._id)),
    ]);
    await autoCompleteSteps(target._id);
    await audit(user, { action: "create", entity: "education", entityId: row._id, ref: target.employeeId, summary: `Uploaded ${label} for ${target.name} (${row.qualification})` });
    if (!self) await notify([target._id], { type: "document", title: "A certificate was added to your record", body: `${label} — ${row.qualification}`, link: "/profile#education" }, [user._id]);
    return null;
  }, "Certificate saved");
}

/** Removes one certificate (HR, or the person for a file they uploaded). */
export async function removeEducationCertificate(personId: string, educationId: string, certificateId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { user, target, manage } = await documentActor(personId);
    const row = await loadRecord(target._id, educationId);
    const cert = row.certificates.find((c) => c._id === certificateId);
    if (!cert) throw new ActionError("Certificate not found.");
    if (!manage && cert.uploadedBy !== user.id) throw new ActionError("Only HR can remove a certificate they uploaded.");
    const remaining = row.certificates.filter((c) => c._id !== certificateId);
    // Guarded on the record being unchanged since it was read, so a concurrent upload is never lost.
    const updated = await db()
      .update(Education)
      .set({ certificates: remaining })
      .where(and(eq(Education._id, row._id), eq(Education.updatedAt, row.updatedAt)))
      .returning({ id: Education._id });
    if (updated.length === 0) throw new ActionError("This record was just changed. Reload and try again.");
    await db().update(StoredFile).set({ deletedAt: new Date(), deletedBy: user._id }).where(and(eq(StoredFile._id, cert.file), eq(StoredFile.entityId, target._id)));
    await autoCompleteSteps(target._id);
    await audit(user, {
      action: "delete",
      entity: "education",
      entityId: row._id,
      ref: target.employeeId,
      summary: `Removed ${certificateTypeLabel(cert.type)} (“${cert.name}”) from ${target.name}'s ${educationLevelLabel(row.level, true)}`,
    });
    return null;
  }, "Certificate removed");
}
