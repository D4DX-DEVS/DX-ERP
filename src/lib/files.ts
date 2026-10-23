import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
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
import { inList, jsonHasField } from "@/lib/sql";
import { can, isInternLike, type CurrentUser } from "@/lib/auth/session";
import { visibleResourceFilter } from "@/app/(app)/learning/_lib/visibility";
import { buildKey, publicUrl, putObject } from "@/lib/storage";
import { taskFilter } from "@/lib/work-access";

export interface UploadInput {
  buffer: Uint8Array;
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

/** Stores a file in R2 and records it in the StoredFile table. */
export async function storeFile(user: Pick<CurrentUser, "_id" | "name">, input: UploadInput): Promise<IStoredFile> {
  const key = buildKey(input.entityType, input.name);
  await putObject(key, input.buffer, input.mime, Boolean(input.isPublic));

  let version = 1;
  if (input.replaces) {
    const [previous] = await db().select({ version: StoredFile.version }).from(StoredFile).where(eq(StoredFile._id, input.replaces)).limit(1);
    if (previous) version = (previous.version ?? 1) + 1;
  }

  const [doc] = await db()
    .insert(StoredFile)
    .values({
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
  })
    .returning();
  if (input.replaces) {
    await db().update(StoredFile).set({ replacedBy: doc._id }).where(eq(StoredFile._id, input.replaces));
  }
  return doc;
}

/** Converts a stored file into the embedded reference used by tasks, issues, expenses, … */
export function toFileRef(file: Pick<IStoredFile, "_id" | "name" | "size" | "mime" | "uploadedBy">): FileRef {
  return { file: file._id, name: file.name, size: file.size, mime: file.mime, uploadedAt: new Date(), uploadedBy: file.uploadedBy ?? undefined };
}

/** Validates client-supplied file ids and returns embeddable refs (only files the user uploaded or may access). */
export async function resolveFileRefs(user: CurrentUser, ids: string[] | undefined): Promise<FileRef[]> {
  if (!ids || ids.length === 0) return [];
  const files = await db()
    .select()
    .from(StoredFile)
    .where(and(inList(StoredFile._id, ids), isNull(StoredFile.deletedAt)));
  const allowed: FileRef[] = [];
  for (const f of files) {
    // The person attaching the file owns the reference (and the right to remove it), not the original uploader.
    if (f.uploadedBy === user.id || (await canAccessFile(user, f))) allowed.push({ ...toFileRef(f), uploadedBy: user._id });
  }
  return allowed;
}

/** Download authorisation for a stored file (FRS §5.3 restricted confidential files). */
export async function canAccessFile(user: CurrentUser, file: IStoredFile): Promise<boolean> {
  if (file.deletedAt) return false;
  if (user.isSuperAdmin || file.isPublic) return true;
  if (file.uploadedBy === user.id) return true;
  const id = file.entityId;
  const one = async <T,>(rows: Promise<T[]>): Promise<T | undefined> => (await rows)[0];

  switch (file.entityType) {
    case "company":
    case "announcement":
      return true;
    case "learning": {
      // Same audience rules as the Learning page: assigned to the person, or aimed at their person type / department.
      if (can(user, "interns.manage")) return true;
      return Boolean(
        await one(
          db()
            .select({ id: LearningResource._id })
            .from(LearningResource)
            .where(
              and(
                jsonHasField(LearningResource.attachments, "file", file._id),
                visibleResourceFilter({ id: user._id, personType: user.personType, department: user.departmentId }),
              ),
            )
            .limit(1),
        ),
      );
    }
    case "user": {
      if (id === user.id) return true;
      if (file.confidential) return can(user, "staff.confidential");
      if (can(user, "staff.view")) return true;
      const target = id
        ? await one(
            db()
              .select({ personType: User.personType, reportingManager: User.reportingManager, internship: User.internship })
              .from(User)
              .where(eq(User._id, id))
              .limit(1),
          )
        : undefined;
      if (!target) return false;
      // `interns.manage` covers interns and trainees only, not every employee's documents.
      if (can(user, "interns.manage") && isInternLike(target)) return true;
      return target.reportingManager === user.id || target.internship?.mentor === user.id;
    }
    case "task":
    case "submission": {
      if (can(user, "tasks.view_all")) return true;
      const task = id
        ? await one(
            db()
              .select({ assignees: Task.assignees, sharedWith: Task.sharedWith, reporter: Task.reporter, reviewer: Task.reviewer, project: Task.project })
              .from(Task)
              .where(eq(Task._id, id))
              .limit(1),
          )
        : undefined;
      if (!task || !id) return false;
      const people = [...task.assignees, ...task.sharedWith, task.reporter, task.reviewer].filter(Boolean);
      if (people.includes(user.id)) return true;
      if (task.project) {
        const project = await projectAccess(task.project);
        if (project?.manager === user.id) return true;
        // Team members (not interns / trainees, who only see assigned or shared tasks) can open task files.
        const internLike = user.personType === "intern" || user.personType === "trainee";
        if (!internLike && project?.team.some((m) => m.user === user.id)) return true;
      }
      // Reviewers, reporting managers and mentors reach tasks through the shared task visibility rules.
      return Boolean(
        await one(
          db()
            .select({ id: Task._id })
            .from(Task)
            .where(and(eq(Task._id, id), await taskFilter(user)))
            .limit(1),
        ),
      );
    }
    case "project": {
      if (can(user, "projects.view_all")) return true;
      const project = id ? await projectAccess(id) : undefined;
      return Boolean(project && (project.manager === user.id || project.team.some((m) => m.user === user.id)));
    }
    case "issue": {
      if (can(user, "qa.view_all")) return true;
      const issue = id
        ? await one(db().select({ assignee: Issue.assignee, reporter: Issue.reporter, project: Issue.project }).from(Issue).where(eq(Issue._id, id)).limit(1))
        : undefined;
      if (!issue) return false;
      if ([issue.assignee, issue.reporter].filter(Boolean).includes(user.id)) return true;
      const project = await projectAccess(issue.project);
      // Interns / trainees only see issues assigned to or reported by them.
      const internLike = user.personType === "intern" || user.personType === "trainee";
      return Boolean(project && (project.manager === user.id || (!internLike && project.team.some((m) => m.user === user.id))));
    }
    case "expense": {
      if (can(user, "expenses.view_all") || can(user, "expenses.approve")) return true;
      const expense = id ? await one(db().select({ user: Expense.user }).from(Expense).where(eq(Expense._id, id)).limit(1)) : undefined;
      return expense?.user === user.id;
    }
    case "leave": {
      if (can(user, "leave.view_all") || can(user, "leave.approve")) return true;
      const leave = id
        ? await one(db().select({ user: LeaveRequest.user, manager: LeaveRequest.manager }).from(LeaveRequest).where(eq(LeaveRequest._id, id)).limit(1))
        : undefined;
      return Boolean(leave && (leave.user === user.id || leave.manager === user.id));
    }
    case "contract": {
      if (!can(user, "contracts.view")) return false;
      if (!file.confidential) return true;
      if (can(user, "contracts.manage") || can(user, "crm.confidential")) return true;
      const contract = id ? await one(db().select({ createdBy: Contract.createdBy }).from(Contract).where(eq(Contract._id, id)).limit(1)) : undefined;
      return contract?.createdBy === user.id;
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
      if (file.entityType === "client") clientId = id ?? undefined;
      else if (file.entityType === "lead" && id) {
        const lead = await one(db().select({ client: Lead.client, assignedTo: Lead.assignedTo }).from(Lead).where(eq(Lead._id, id)).limit(1));
        clientId = lead?.client ?? undefined;
        assignee = lead?.assignedTo ?? undefined;
      } else if (id) {
        const activity = await one(db().select({ client: Activity.client }).from(Activity).where(eq(Activity._id, id)).limit(1));
        clientId = activity?.client ?? undefined;
      }
      const client = clientId
        ? await one(db().select({ confidential: Client.confidential, owner: Client.owner }).from(Client).where(eq(Client._id, clientId)).limit(1))
        : undefined;
      const restricted = file.confidential || Boolean(client?.confidential);
      if (!restricted) return true;
      return can(user, "crm.confidential") || client?.owner === user.id || assignee === user.id;
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

async function projectAccess(projectId: string): Promise<{ manager: string | null; team: { user: string }[] } | undefined> {
  const [project] = await db().select({ manager: Project.manager, team: Project.team }).from(Project).where(eq(Project._id, projectId)).limit(1);
  return project;
}
