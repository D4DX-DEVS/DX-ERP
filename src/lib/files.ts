import "server-only";
import { connectDB } from "@/lib/db";
import {
  Activity,
  Client,
  Contract,
  Expense,
  Issue,
  Lead,
  LearningResource,
  LeaveRequest,
  Project,
  StoredFile,
  Task,
  User,
  type FileRef,
  type IStoredFile,
} from "@/lib/models";
import { can, isInternLike, type CurrentUser } from "@/lib/auth/session";
import { visibleResourceFilter } from "@/app/(app)/learning/_lib/visibility";
import { buildKey, publicUrl, putObject } from "@/lib/storage";
import { taskFilter } from "@/lib/work-access";

export interface UploadInput {
  buffer: Buffer;
  name: string;
  mime: string;
  entityType: string;
  entityId?: string;
  category?: string;
  confidential?: boolean;
  expiryDate?: string;
  notes?: string;
  isPublic?: boolean;
  replaces?: string;
}

/** Stores a file in Spaces and records it in the StoredFile collection. */
export async function storeFile(user: Pick<CurrentUser, "_id" | "name">, input: UploadInput): Promise<IStoredFile> {
  await connectDB();
  const key = buildKey(input.entityType, input.name);
  await putObject(key, input.buffer, input.mime, Boolean(input.isPublic));

  let version = 1;
  if (input.replaces) {
    const previous = await StoredFile.findById(input.replaces).lean();
    if (previous) version = (previous.version ?? 1) + 1;
  }

  const doc = await StoredFile.create({
    key,
    name: input.name,
    size: input.buffer.length,
    mime: input.mime,
    isPublic: Boolean(input.isPublic),
    url: input.isPublic ? publicUrl(key) : undefined,
    entityType: input.entityType,
    entityId: input.entityId,
    category: input.category,
    confidential: Boolean(input.confidential),
    expiryDate: input.expiryDate,
    notes: input.notes,
    version,
    replaces: input.replaces,
    uploadedBy: user._id,
    uploadedByName: user.name,
  });
  if (input.replaces) {
    await StoredFile.updateOne({ _id: input.replaces }, { $set: { replacedBy: doc._id } });
  }
  return doc.toObject();
}

/** Converts a stored file into the embedded reference used by tasks, issues, expenses, … */
export function toFileRef(file: Pick<IStoredFile, "_id" | "name" | "size" | "mime" | "uploadedBy">): FileRef {
  return { file: file._id, name: file.name, size: file.size, mime: file.mime, uploadedAt: new Date(), uploadedBy: file.uploadedBy };
}

/** Validates client-supplied file ids and returns embeddable refs (only files the user uploaded or may access). */
export async function resolveFileRefs(user: CurrentUser, ids: string[] | undefined): Promise<FileRef[]> {
  if (!ids || ids.length === 0) return [];
  await connectDB();
  const files = await StoredFile.find({ _id: { $in: ids }, deletedAt: null }).lean();
  const allowed: FileRef[] = [];
  for (const f of files) {
    // The person attaching the file owns the reference (and the right to remove it), not the original uploader.
    if (f.uploadedBy?.toString() === user.id || (await canAccessFile(user, f))) allowed.push({ ...toFileRef(f), uploadedBy: user._id });
  }
  return allowed;
}

/** Download authorisation for a stored file (FRS §5.3 restricted confidential files). */
export async function canAccessFile(user: CurrentUser, file: IStoredFile): Promise<boolean> {
  if (file.deletedAt) return false;
  if (user.isSuperAdmin || file.isPublic) return true;
  if (file.uploadedBy?.toString() === user.id) return true;
  const id = file.entityId;
  await connectDB();

  switch (file.entityType) {
    case "company":
    case "announcement":
      return true;
    case "learning": {
      // Same audience rules as the Learning page: assigned to the person, or aimed at their person type / department.
      if (can(user, "interns.manage")) return true;
      return Boolean(await LearningResource.exists({ "attachments.file": file._id, ...visibleResourceFilter({ id: user._id, personType: user.personType, department: user.departmentId }) }));
    }
    case "user": {
      if (id === user.id) return true;
      if (file.confidential) return can(user, "staff.confidential");
      if (can(user, "staff.view")) return true;
      const target = id ? await User.findById(id, { personType: 1, reportingManager: 1, "internship.mentor": 1 }).lean() : null;
      if (!target) return false;
      // `interns.manage` covers interns and trainees only, not every employee's documents.
      if (can(user, "interns.manage") && isInternLike(target)) return true;
      return target.reportingManager?.toString() === user.id || target.internship?.mentor?.toString() === user.id;
    }
    case "task":
    case "submission": {
      if (can(user, "tasks.view_all")) return true;
      const task = id ? await Task.findById(id, { assignees: 1, sharedWith: 1, reporter: 1, reviewer: 1, project: 1 }).lean() : null;
      if (!task) return false;
      const people = [...task.assignees, ...task.sharedWith, task.reporter, task.reviewer].filter(Boolean).map(String);
      if (people.includes(user.id)) return true;
      if (task.project) {
        const project = await Project.findById(task.project, { manager: 1, "team.user": 1 }).lean();
        if (project?.manager?.toString() === user.id) return true;
        // Team members (not interns / trainees, who only see assigned or shared tasks) can open task files.
        const internLike = user.personType === "intern" || user.personType === "trainee";
        if (!internLike && project?.team.some((m) => m.user.toString() === user.id)) return true;
      }
      // Reviewers, reporting managers and mentors reach tasks through the shared task visibility rules.
      return Boolean(await Task.exists({ $and: [{ _id: id }, await taskFilter(user)] }));
    }
    case "project": {
      if (can(user, "projects.view_all")) return true;
      const project = id ? await Project.findById(id, { manager: 1, "team.user": 1 }).lean() : null;
      return Boolean(project && (project.manager?.toString() === user.id || project.team.some((m) => m.user.toString() === user.id)));
    }
    case "issue": {
      if (can(user, "qa.view_all")) return true;
      const issue = id ? await Issue.findById(id, { assignee: 1, reporter: 1, project: 1 }).lean() : null;
      if (!issue) return false;
      if ([issue.assignee, issue.reporter].filter(Boolean).map(String).includes(user.id)) return true;
      const project = await Project.findById(issue.project, { manager: 1, "team.user": 1 }).lean();
      // Interns / trainees only see issues assigned to or reported by them.
      const internLike = user.personType === "intern" || user.personType === "trainee";
      return Boolean(project && (project.manager?.toString() === user.id || (!internLike && project.team.some((m) => m.user.toString() === user.id))));
    }
    case "expense": {
      if (can(user, "expenses.view_all") || can(user, "expenses.approve")) return true;
      const expense = id ? await Expense.findById(id, { user: 1 }).lean() : null;
      return expense?.user.toString() === user.id;
    }
    case "leave": {
      if (can(user, "leave.view_all") || can(user, "leave.approve")) return true;
      const leave = id ? await LeaveRequest.findById(id, { user: 1, manager: 1 }).lean() : null;
      return Boolean(leave && (leave.user.toString() === user.id || leave.manager?.toString() === user.id));
    }
    case "contract": {
      if (!can(user, "contracts.view")) return false;
      if (!file.confidential) return true;
      if (can(user, "contracts.manage") || can(user, "crm.confidential")) return true;
      const contract = id ? await Contract.findById(id, { createdBy: 1 }).lean() : null;
      return contract?.createdBy?.toString() === user.id;
    }
    case "proposal":
      return can(user, "proposals.view");
    case "client":
    case "lead":
    case "activity": {
      if (!can(user, "crm.view")) return false;
      // Resolve the client the file belongs to; confidential clients are limited to
      // `crm.confidential` holders, the client owner and (for leads) the assignee.
      let clientId: string | undefined;
      let assignee: string | undefined;
      if (file.entityType === "client") clientId = id;
      else if (file.entityType === "lead" && id) {
        const lead = await Lead.findById(id, { client: 1, assignedTo: 1 }).lean();
        clientId = lead?.client?.toString();
        assignee = lead?.assignedTo?.toString();
      } else if (id) {
        const activity = await Activity.findById(id, { client: 1, lead: 1 }).lean();
        clientId = activity?.client?.toString();
      }
      const client = clientId ? await Client.findById(clientId, { confidential: 1, owner: 1 }).lean() : null;
      const restricted = file.confidential || Boolean(client?.confidential);
      if (!restricted) return true;
      return can(user, "crm.confidential") || client?.owner?.toString() === user.id || assignee === user.id;
    }
    case "asset":
      return can(user, "assets.view");
    case "invoice":
      return can(user, "invoices.view");
    case "backup":
      return can(user, "backup.manage");
    default:
      return false;
  }
}
