"use server";

import { z } from "zod";
import { actionPermission, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit, diff } from "@/lib/audit";
import { can, revokeUserSessions, type CurrentUser } from "@/lib/auth/session";
import { Role, User, type LifecycleEvent } from "@/lib/models";
import { notify } from "@/lib/notify";
import { isObjectId, zs } from "@/lib/validation";
import { EMPLOYMENT_TYPE_KEYS } from "./_lib/constants";
import { analyseImport, importSchema, type ImportPreviewRow } from "./_lib/import";
import {
  autoCompleteSteps,
  buildSalary,
  createPersonRecord,
  createPersonSchema,
  emailRegex,
  lifecycleEvent,
  parseMoneyLines,
  superAdminEmail,
} from "./_lib/person";

/** /staff/new — creates the person, checklist, joined event, audit and notifications. */
export async function createPerson(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionPermission("staff.create");
    const data = parse(createPersonSchema, input);
    const internLike = data.personType !== "employee";
    // Stipend is confidential like salary: ignore the submitted values without `staff.confidential`.
    const stipendAllowed = can(user, "staff.confidential");

    let salary;
    if (can(user, "staff.confidential") && !internLike) {
      const allowances = parseMoneyLines(input.allowanceName, input.allowanceAmount, "Allowance");
      const deductions = parseMoneyLines(input.deductionName, input.deductionAmount, "Deduction");
      if (data.salaryBasic !== undefined || allowances.length > 0 || deductions.length > 0) {
        salary = buildSalary({ basic: data.salaryBasic ?? 0, allowances, deductions, effectiveFrom: data.salaryEffectiveFrom ?? data.joiningDate });
      }
    }

    const created = await createPersonRecord(user, {
      name: data.name,
      email: data.email,
      phone: data.phone,
      personalEmail: data.personalEmail,
      dob: data.dob,
      gender: data.gender,
      bloodGroup: data.bloodGroup,
      personType: data.personType,
      role: data.role,
      department: data.department,
      designation: data.designation,
      employmentType: data.employmentType,
      joiningDate: data.joiningDate,
      reportingManager: data.reportingManager,
      team: data.team,
      internship: internLike
        ? {
            startDate: data.internStartDate ?? data.joiningDate,
            endDate: data.internEndDate,
            college: data.college,
            course: data.course,
            mentor: data.mentor,
            assignedRole: data.assignedRole,
            stipend: stipendAllowed
              ? { eligible: data.stipendEligible, amount: data.stipendEligible ? (data.stipendAmount ?? 0) : 0, period: data.stipendPeriod }
              : { eligible: false, amount: 0, period: "monthly" as const },
          }
        : undefined,
      salary,
      accountActive: can(user, "users.manage") && data.loginAccess,
    });
    return { id: created.id };
  }, "Person added");
}

const updateSchema = z.object({
  userId: zs.id("Person"),
  name: zs.text("Name", 120),
  email: zs.optEmail(),
  phone: zs.optText(30),
  personalEmail: zs.optEmail(),
  dob: zs.optDate(),
  gender: zs.optText(20),
  bloodGroup: zs.optText(5),
  addrLine1: zs.optText(150),
  addrLine2: zs.optText(150),
  city: zs.optText(80),
  state: zs.optText(80),
  postalCode: zs.optText(20),
  country: zs.optText(80),
  emergencyName: zs.optText(100),
  emergencyRelation: zs.optText(50),
  emergencyPhone: zs.optText(30),
  employmentType: zs.optText(30),
  team: zs.optText(80),
  joiningDate: zs.date("Joining date"),
  internStartDate: zs.optDate(),
  internEndDate: zs.optDate(),
  college: zs.optText(150),
  course: zs.optText(150),
  assignedRole: zs.optText(100),
  mentor: zs.optId(),
});

/** /staff/[id]/edit — the full details form. */
export async function updatePerson(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => savePerson(await actionPermission("staff.edit"), input), "Details saved");
}

/** Fields each profile section's edit dialog may change; everything else keeps its current value. */
const SECTION_FIELDS = {
  employment: ["email", "phone", "employmentType", "team", "joiningDate"],
  personal: ["name", "dob", "gender", "bloodGroup", "personalEmail", "addrLine1", "addrLine2", "city", "state", "postalCode", "country", "emergencyName", "emergencyRelation", "emergencyPhone"],
  internship: ["internStartDate", "internEndDate", "college", "course", "assignedRole", "mentor"],
} as const;

export type ProfileSection = keyof typeof SECTION_FIELDS;

/** Profile overview "edit section" dialogs: saves one section through the same validation, history and audit as the full form. */
export async function updatePersonSection(userId: string, section: ProfileSection, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionPermission("staff.edit");
    if (!isObjectId(userId)) throw new ActionError("Person not found.");
    if (typeof section !== "string" || !Object.hasOwn(SECTION_FIELDS, section)) throw new ActionError("Unknown section.");
    const target = await User.findById(userId).lean();
    if (!target || target.personType === "admin") throw new ActionError("Person not found.");
    if (section === "internship" && target.personType !== "intern" && target.personType !== "trainee") throw new ActionError("Only interns and trainees have internship details.");

    const i = target.internship;
    const merged: Record<string, unknown> = {
      userId,
      name: target.name,
      email: target.email,
      phone: target.phone,
      personalEmail: target.personalEmail,
      dob: target.dob,
      gender: target.gender,
      bloodGroup: target.bloodGroup,
      addrLine1: target.address?.line1,
      addrLine2: target.address?.line2,
      city: target.address?.city,
      state: target.address?.state,
      postalCode: target.address?.postalCode,
      country: target.address?.country,
      emergencyName: target.emergencyContact?.name,
      emergencyRelation: target.emergencyContact?.relation,
      emergencyPhone: target.emergencyContact?.phone,
      employmentType: target.employmentType,
      team: target.team,
      joiningDate: target.joiningDate,
      internStartDate: i?.startDate,
      internEndDate: i?.endDate,
      college: i?.college,
      course: i?.course,
      assignedRole: i?.assignedRole,
      mentor: i?.mentor?.toString(),
    };
    // The dialog posts every field of its section; a missing one means it was cleared.
    for (const field of SECTION_FIELDS[section]) merged[field] = input[field] ?? "";
    return savePerson(user, merged);
  }, "Details saved");
}

/** Shared by the full edit form and the per-section dialogs. Designation, department, manager and status go through lifecycle actions. */
async function savePerson(user: CurrentUser, input: Record<string, unknown>): Promise<{ id: string }> {
  const data = parse(updateSchema, input);
  const target = await User.findById(data.userId).lean();
  if (!target || target.personType === "admin") throw new ActionError("Person not found.");
  if (target._id.toString() === user.id && (data.joiningDate !== target.joiningDate || (data.employmentType && data.employmentType !== target.employmentType))) {
    throw new ActionError("You can't change your own joining date or employment type. Ask another HR administrator.", { joiningDate: "Not allowed" });
  }

  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};
  const put = (key: string, value: unknown) => {
    if (value === undefined || value === "") unset[key] = "";
    else set[key] = value;
  };

  put("name", data.name);
  put("phone", data.phone);
  put("personalEmail", data.personalEmail);
  put("dob", data.dob);
  put("gender", data.gender);
  put("bloodGroup", data.bloodGroup);
  put("team", data.team);
  put("joiningDate", data.joiningDate);
  put("address.line1", data.addrLine1);
  put("address.line2", data.addrLine2);
  put("address.city", data.city);
  put("address.state", data.state);
  put("address.postalCode", data.postalCode);
  put("address.country", data.country);
  put("emergencyContact.name", data.emergencyName);
  put("emergencyContact.relation", data.emergencyRelation);
  put("emergencyContact.phone", data.emergencyPhone);

  if (data.employmentType) {
    if (!EMPLOYMENT_TYPE_KEYS.includes(data.employmentType)) throw new ActionError("Choose a valid employment type.", { employmentType: "Invalid" });
    set.employmentType = data.employmentType;
  }

  const events: LifecycleEvent[] = [];
  let emailChanged = false;
  if (data.email && data.email !== target.email) {
    if (!can(user, "users.manage")) throw new ActionError("Only users who manage access can change the work email.", { email: "Not allowed" });
    if (target._id.toString() === user.id) throw new ActionError("You can't change your own work email. Ask another administrator.", { email: "Not allowed" });
    if (!user.isSuperAdmin) {
      // The next Google sign-in with the new email binds that Google account to this record and its role,
      // so a delegated admin may only re-point accounts whose role is within their own ceiling.
      const role = await Role.findOne({ key: target.role }, { permissions: 1 }).lean();
      const own = new Set<string>(user.permissions);
      if (!role || role.permissions.some((p) => !own.has(p))) {
        throw new ActionError(`${target.name}'s role has permissions you don't hold, so you can't change their work email. Ask the super admin.`, { email: "Not allowed" });
      }
    }
    const adminEmail = superAdminEmail();
    if (adminEmail && data.email === adminEmail) throw new ActionError("This email belongs to the super admin account.", { email: "Reserved for the super admin" });
    const clash = await User.exists({ _id: { $ne: target._id }, email: emailRegex(data.email) });
    if (clash) throw new ActionError("A person with this email already exists.", { email: "Already in use" });
    set.email = data.email;
    unset.googleSub = "";
    emailChanged = true;
    events.push(lifecycleEvent(user, { type: "access_change", summary: "Work email changed — Google sign-in re-links on next login", from: target.email, to: data.email }));
  }

  let mentorChanged = false;
  const internLike = target.personType === "intern" || target.personType === "trainee";
  if (internLike) {
    const current = target.internship;
    const start = data.internStartDate ?? current?.startDate;
    const end = data.internEndDate ?? current?.endDate;
    if (start && end && end < start) throw new ActionError("End date must be after the start date.", { internEndDate: "Must be after start" });
    if (!current) {
      if (data.mentor) {
        if (data.mentor === data.userId) throw new ActionError("A person can't mentor themself.", { mentor: "Invalid" });
        const mentor = await User.findById(data.mentor, { personType: 1, status: 1 }).lean();
        if (!mentor || mentor.personType === "admin" || ["resigned", "terminated", "inactive"].includes(mentor.status)) {
          throw new ActionError("Choose an active staff member as mentor.", { mentor: "Not available" });
        }
        mentorChanged = true;
      }
      set.internship = {
        startDate: data.internStartDate,
        endDate: data.internEndDate,
        college: data.college,
        course: data.course,
        assignedRole: data.assignedRole,
        mentor: data.mentor,
        objectives: [],
        status: "registered",
        stipend: { eligible: false, amount: 0, period: "monthly" },
        stipendHistory: [],
        certificateStatus: "none",
      };
    } else {
      put("internship.startDate", data.internStartDate);
      put("internship.endDate", data.internEndDate);
      put("internship.college", data.college);
      put("internship.course", data.course);
      put("internship.assignedRole", data.assignedRole);
      if ((data.mentor ?? "") !== (current.mentor?.toString() ?? "")) {
        if (data.mentor) {
          if (data.mentor === data.userId) throw new ActionError("A person can't mentor themself.", { mentor: "Invalid" });
          const mentor = await User.findById(data.mentor, { name: 1, personType: 1, status: 1 }).lean();
          if (!mentor || mentor.personType === "admin" || ["resigned", "terminated", "inactive"].includes(mentor.status)) {
            throw new ActionError("Choose an active staff member as mentor.", { mentor: "Not available" });
          }
          const previous = current.mentor ? await User.findById(current.mentor, { name: 1 }).lean() : null;
          events.push(lifecycleEvent(user, { type: "manager_change", summary: `Mentor changed to ${mentor.name}`, from: previous?.name, to: mentor.name }));
        } else {
          events.push(lifecycleEvent(user, { type: "manager_change", summary: "Mentor removed" }));
        }
        put("internship.mentor", data.mentor);
        mentorChanged = true;
      }
    }
  }

  const update: Record<string, unknown> = { $set: set };
  if (Object.keys(unset).length > 0) update.$unset = unset;
  if (events.length > 0) update.$push = { history: { $each: events } };
  await User.updateOne({ _id: target._id }, update, { runValidators: true });

  if (emailChanged) await revokeUserSessions(target._id, "email changed");
  if (mentorChanged) {
    await autoCompleteSteps(target._id);
    if (data.mentor) {
      await notify(
        [data.mentor],
        { type: "internship", title: `You are now the mentor for ${data.name}`, link: `/interns/${data.userId}`, actionable: false },
        [user._id],
      );
    }
  }

  await audit(user, {
    action: "update",
    entity: "user",
    entityId: target._id,
    ref: target.employeeId,
    summary: `Updated details of ${data.name} (${target.employeeId})`,
    changes: diff(
      { name: target.name, email: target.email, phone: target.phone, personalEmail: target.personalEmail, dob: target.dob, gender: target.gender, bloodGroup: target.bloodGroup, team: target.team, employmentType: target.employmentType, joiningDate: target.joiningDate },
      { name: data.name, email: data.email ?? target.email, phone: data.phone, personalEmail: data.personalEmail, dob: data.dob, gender: data.gender, bloodGroup: data.bloodGroup, team: data.team, employmentType: data.employmentType ?? target.employmentType, joiningDate: data.joiningDate },
      ["name", "email", "phone", "personalEmail", "dob", "gender", "bloodGroup", "team", "employmentType", "joiningDate"],
      ["phone", "personalEmail", "dob"],
    ),
  });
  return { id: data.userId };
}

/* ------------------------------------------------------------------ */
/* CSV import                                                          */
/* ------------------------------------------------------------------ */

export async function previewImport(input: Record<string, unknown>): Promise<ActionResult<{ rows: ImportPreviewRow[] }>> {
  return runAction(async () => {
    const user = await actionPermission("staff.create");
    const data = parse(importSchema, input);
    const { preview } = await analyseImport(user, data.rows);
    return { rows: preview };
  });
}

export async function importPeople(
  input: Record<string, unknown>,
): Promise<ActionResult<{ created: number; skipped: number; failed: { line: number; error: string }[] }>> {
  return runAction(async () => {
    const user = await actionPermission("staff.create");
    const data = parse(importSchema, input);
    const { preview, people } = await analyseImport(user, data.rows);
    const enableLogin = Boolean(data.enableLogin) && can(user, "users.manage");

    const failed: { line: number; error: string }[] = [];
    const perManager = new Map<string, number>();
    let created = 0;
    for (let i = 0; i < people.length; i++) {
      const person = people[i];
      if (!person) continue;
      try {
        await createPersonRecord(user, { ...person, accountActive: enableLogin }, { notifyPeople: false, allowedRoles: new Set([person.role]) });
        created++;
        if (person.reportingManager) perManager.set(person.reportingManager, (perManager.get(person.reportingManager) ?? 0) + 1);
      } catch (error) {
        failed.push({ line: preview[i].line, error: error instanceof ActionError ? error.message : "Could not be saved" });
      }
    }

    for (const [managerId, count] of perManager) {
      await notify([managerId], { type: "system", title: `${count} ${count === 1 ? "person was" : "people were"} added to your team`, link: "/staff" }, [user._id]);
    }

    const skipped = preview.filter((r) => !r.valid).length;
    await audit(user, { action: "import", entity: "user", summary: `Imported ${created} ${created === 1 ? "person" : "people"} from CSV (${skipped} skipped, ${failed.length} failed)` });
    return { created, skipped, failed };
  }, "Import finished");
}
