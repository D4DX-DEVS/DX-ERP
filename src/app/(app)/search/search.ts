import "server-only";
import { and, asc, desc, eq, ne, or, type SQL } from "drizzle-orm";
import { can, isInternLike, type CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Asset, Client, Contract, Invoice, Issue, Lead, Movement, PERSON_TYPES, Project, Proposal, Task, User } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { inList, jsonHas, jsonHasField, searchAny } from "@/lib/sql";
import { optionLabel, statusLabel } from "@/lib/status";
import { fmtDate, fmtTime, formatDuration } from "@/lib/time";
import { inr, titleCase } from "@/lib/format";
import { projectFilter } from "@/lib/work-access";
import { clientNames, peopleMap } from "@/lib/reports/shared";
import { clientScope, hiddenClientIds, notHiddenClient } from "@/app/(app)/crm/_lib/access";

/** Results fetched per group: one more than shown, so the page knows whether to offer "more". */
export const GROUP_SHOWN = 8;
const FETCH = GROUP_SHOWN + 1;

export type SearchGroupKey = "people" | "clients" | "leads" | "projects" | "tasks" | "issues" | "invoices" | "proposals" | "contracts" | "movements" | "assets";

export interface SearchItem {
  id: string;
  href: string;
  title: string;
  meta: string;
  /** Right-hand label (reference number, status…). */
  tag?: string;
}

export interface SearchGroup {
  key: SearchGroupKey;
  label: string;
  items: SearchItem[];
  more: boolean;
  /** Module list pre-filtered by the query. */
  moreHref: string;
}

const join = (parts: (string | undefined | false | null)[]) => parts.filter(Boolean).join(" · ");

function group(key: SearchGroupKey, label: string, items: SearchItem[], moreHref: string): SearchGroup {
  return { key, label, items: items.slice(0, GROUP_SHOWN), more: items.length > GROUP_SHOWN, moreHref };
}

const ids = (list: { _id: string }[]) => list.map((x) => x._id);

/**
 * Global search (FRS §22). Every group is scoped on the server to what the user may open:
 * permission-gated modules, own-or-membership visibility for work items, restricted clients
 * and confidential contracts hidden, and personal movement details masked.
 */
export async function runSearch(user: CurrentUser, query: string): Promise<SearchGroup[]> {
  if (!query.trim()) return [];
  const q = query.trim().slice(0, 100);
  const enc = encodeURIComponent(q);
  const settings = await getSettings();
  const hidden = await hiddenClientIds(user);
  const intern = isInternLike(user);
  const me = user._id;

  const seesClients = can(user, "crm.view");
  const clientVisible = clientScope(user);
  const hiddenLeadClient = notHiddenClient(hidden, Lead.client);

  // Projects the user belongs to (used to scope tasks and QA issues for people without view-all).
  const memberProjects =
    !can(user, "projects.view_all") || !can(user, "tasks.view_all") || !can(user, "qa.view_all")
      ? (await db().select({ id: Project._id }).from(Project).where(or(eq(Project.manager, me), jsonHasField(Project.team, "user", me)))).map((r) => r.id)
      : [];

  const tasks = (async (): Promise<SearchGroup | null> => {
    const scope: SQL | undefined = can(user, "tasks.view_all")
      ? undefined
      : or(jsonHas(Task.assignees, me), jsonHas(Task.sharedWith, me), ...(intern ? [] : [eq(Task.reporter, me), eq(Task.reviewer, me), inList(Task.project, memberProjects)]));
    const rows = await db()
      .select({ _id: Task._id, taskNo: Task.taskNo, title: Task.title, project: Task.project, status: Task.status, dueDate: Task.dueDate })
      .from(Task)
      .where(and(scope, searchAny(q, Task.title, Task.taskNo)))
      .orderBy(desc(Task.updatedAt))
      .limit(FETCH);
    if (rows.length === 0) return null;
    const projectIds = rows.flatMap((r) => (r.project ? [r.project] : []));
    const projects = projectIds.length ? await db().select({ _id: Project._id, title: Project.title }).from(Project).where(inList(Project._id, projectIds)) : [];
    const title = new Map(projects.map((p) => [p._id, p.title]));
    return group(
      "tasks",
      "Tasks",
      rows.map((t) => ({
        id: t._id,
        href: `/tasks/${t._id}`,
        title: t.title,
        meta: join([t.project && title.get(t.project), optionLabel(settings.taskStatuses, t.status), t.dueDate && `due ${fmtDate(t.dueDate)}`]),
        tag: t.taskNo,
      })),
      can(user, "tasks.view_all") ? `/tasks?scope=all&q=${enc}` : `/tasks?q=${enc}`,
    );
  })();

  const projects = (async (): Promise<SearchGroup | null> => {
    const scope = projectFilter(user);
    const rows = await db()
      .select({ _id: Project._id, projectNo: Project.projectNo, title: Project.title, status: Project.status, client: Project.client })
      .from(Project)
      .where(and(scope, searchAny(q, Project.title, Project.projectNo)))
      .orderBy(desc(Project.updatedAt))
      .limit(FETCH);
    if (rows.length === 0) return null;
    // Interns / trainees never see client names.
    const clients = await clientNames(intern ? [] : rows.map((r) => r.client), user);
    return group(
      "projects",
      "Projects",
      rows.map((p) => ({
        id: p._id,
        href: `/projects/${p._id}`,
        title: p.title,
        meta: join([!intern && (p.client ? clients.get(p.client) : "Internal"), optionLabel(settings.projectStatuses, p.status)]),
        tag: p.projectNo,
      })),
      `/projects?q=${enc}`,
    );
  })();

  const issues = (async (): Promise<SearchGroup | null> => {
    const scope: SQL | undefined = can(user, "qa.view_all")
      ? undefined
      : or(eq(Issue.assignee, me), eq(Issue.reporter, me), ...(intern ? [] : [inList(Issue.project, memberProjects)]));
    const rows = await db()
      .select({ _id: Issue._id, issueNo: Issue.issueNo, title: Issue.title, severity: Issue.severity, status: Issue.status, project: Issue.project })
      .from(Issue)
      .where(and(scope, searchAny(q, Issue.title, Issue.issueNo)))
      .orderBy(desc(Issue.updatedAt))
      .limit(FETCH);
    if (rows.length === 0) return null;
    const projectRows = await db().select({ _id: Project._id, title: Project.title }).from(Project).where(inList(Project._id, rows.map((r) => r.project)));
    const title = new Map(projectRows.map((p) => [p._id, p.title]));
    return group(
      "issues",
      "QA issues",
      rows.map((i) => ({
        id: i._id,
        href: `/qa/${i._id}`,
        title: i.title,
        meta: join([title.get(i.project), statusLabel("severity", i.severity), statusLabel("issue", i.status)]),
        tag: i.issueNo,
      })),
      `/qa?q=${enc}`,
    );
  })();

  const people = (async (): Promise<SearchGroup | null> => {
    const match = can(user, "staff.view") ? searchAny(q, User.name, User.employeeId, User.email) : and(eq(User._id, me), searchAny(q, User.name, User.employeeId));
    const rows = await db()
      .select({ _id: User._id, name: User.name, employeeId: User.employeeId, personType: User.personType })
      .from(User)
      .where(and(inList(User.personType, PERSON_TYPES), match))
      .orderBy(asc(User.name))
      .limit(FETCH);
    if (rows.length === 0) return null;
    const info = await peopleMap(ids(rows));
    return group(
      "people",
      "People",
      rows.map((u) => {
        const p = info.get(u._id);
        return { id: u._id, href: `/staff/${u._id}`, title: u.name, meta: join([p?.designation, p?.department, titleCase(u.personType)]), tag: u.employeeId };
      }),
      `/staff?q=${enc}`,
    );
  })();

  const clients = (async (): Promise<SearchGroup | null> => {
    if (!seesClients) return null;
    const rows = await db()
      .select({ _id: Client._id, clientNo: Client.clientNo, name: Client.name, contactPerson: Client.contactPerson, status: Client.status, confidential: Client.confidential })
      .from(Client)
      .where(and(clientVisible, searchAny(q, Client.name, Client.contactPerson, Client.email, Client.clientNo, Client.phone)))
      .orderBy(asc(Client.name))
      .limit(FETCH);
    if (rows.length === 0) return null;
    return group(
      "clients",
      "Clients",
      rows.map((c) => ({ id: c._id, href: `/crm/clients/${c._id}`, title: c.name, meta: join([c.contactPerson, statusLabel("client", c.status), c.confidential && "Restricted"]), tag: c.clientNo })),
      `/crm/clients?q=${enc}`,
    );
  })();

  const leads = (async (): Promise<SearchGroup | null> => {
    if (!seesClients) return null;
    const rows = await db()
      .select({ _id: Lead._id, leadNo: Lead.leadNo, title: Lead.title, companyName: Lead.companyName, stage: Lead.stage, status: Lead.status })
      .from(Lead)
      .where(and(hiddenLeadClient, searchAny(q, Lead.title, Lead.companyName, Lead.contactName, Lead.leadNo, Lead.email)))
      .orderBy(desc(Lead.updatedAt))
      .limit(FETCH);
    if (rows.length === 0) return null;
    return group(
      "leads",
      "Leads & enquiries",
      rows.map((l) => ({
        id: l._id,
        href: `/crm/leads/${l._id}`,
        title: l.title,
        meta: join([l.companyName, optionLabel(settings.pipelineStages, l.stage), statusLabel("leadStatus", l.status)]),
        tag: l.leadNo,
      })),
      `/crm?view=list&q=${enc}`,
    );
  })();

  const invoices = (async (): Promise<SearchGroup | null> => {
    if (!can(user, "invoices.view")) return null;
    // Matching clients are limited to the ones this user may see, so a restricted client's name never matches.
    const matchingClients = await db()
      .select({ _id: Client._id })
      .from(Client)
      .where(and(clientVisible, searchAny(q, Client.name)))
      .limit(50);
    const rows = await db()
      .select({ _id: Invoice._id, invoiceNo: Invoice.invoiceNo, draftNo: Invoice.draftNo, client: Invoice.client, total: Invoice.total, status: Invoice.status, balance: Invoice.balance })
      .from(Invoice)
      .where(and(notHiddenClient(hidden, Invoice.client), or(searchAny(q, Invoice.invoiceNo, Invoice.draftNo), inList(Invoice.client, ids(matchingClients)))))
      .orderBy(desc(Invoice.issueDate))
      .limit(FETCH);
    if (rows.length === 0) return null;
    const names = await clientNames(rows.map((r) => r.client), user);
    return group(
      "invoices",
      "Invoices",
      rows.map((i) => ({
        id: i._id,
        href: `/invoices/${i._id}`,
        title: i.invoiceNo ?? i.draftNo,
        meta: join([names.get(i.client), inr(i.total), statusLabel("invoice", i.status)]),
        tag: i.balance > 0 && i.status !== "cancelled" ? `${inr(i.balance)} due` : undefined,
      })),
      `/invoices?q=${enc}`,
    );
  })();

  const proposals = (async (): Promise<SearchGroup | null> => {
    if (!can(user, "proposals.view")) return null;
    const rows = await db()
      .select({ _id: Proposal._id, proposalNo: Proposal.proposalNo, title: Proposal.title, client: Proposal.client, status: Proposal.status, total: Proposal.total })
      .from(Proposal)
      .where(and(notHiddenClient(hidden, Proposal.client), searchAny(q, Proposal.proposalNo, Proposal.title)))
      .orderBy(desc(Proposal.updatedAt))
      .limit(FETCH);
    if (rows.length === 0) return null;
    const names = await clientNames(rows.map((r) => r.client), user);
    return group(
      "proposals",
      "Proposals & quotations",
      rows.map((p) => ({ id: p._id, href: `/proposals/${p._id}`, title: p.title, meta: join([names.get(p.client), statusLabel("proposal", p.status), inr(p.total)]), tag: p.proposalNo })),
      `/proposals?q=${enc}`,
    );
  })();

  const contracts = (async (): Promise<SearchGroup | null> => {
    if (!can(user, "contracts.view")) return null;
    const open = can(user, "crm.confidential") || can(user, "contracts.manage");
    const visible = open ? undefined : or(ne(Contract.confidential, true), eq(Contract.createdBy, me));
    const rows = await db()
      .select({ _id: Contract._id, contractNo: Contract.contractNo, title: Contract.title, client: Contract.client, status: Contract.status, endDate: Contract.endDate })
      .from(Contract)
      .where(and(visible, notHiddenClient(hidden, Contract.client), searchAny(q, Contract.contractNo, Contract.title)))
      .orderBy(desc(Contract.updatedAt))
      .limit(FETCH);
    if (rows.length === 0) return null;
    const names = await clientNames(rows.map((r) => r.client), user);
    return group(
      "contracts",
      "Contracts",
      rows.map((c) => ({ id: c._id, href: `/contracts/${c._id}`, title: c.title, meta: join([names.get(c.client), statusLabel("contract", c.status), c.endDate && `ends ${fmtDate(c.endDate)}`]), tag: c.contractNo })),
      `/contracts?q=${enc}`,
    );
  })();

  const movements = (async (): Promise<SearchGroup | null> => {
    const all = can(user, "movement.view_all");
    const isDate = /^\d{4}-\d{2}-\d{2}$/.test(q);
    let match: SQL | undefined;
    if (isDate) match = eq(Movement.date, q);
    else {
      const people = all
        ? await db()
            .select({ _id: User._id })
            .from(User)
            .where(and(inList(User.personType, PERSON_TYPES), searchAny(q, User.name)))
            .limit(50)
        : [];
      match = or(searchAny(q, Movement.movementNo), people.length ? inList(Movement.user, ids(people)) : undefined);
    }
    const rows = await db()
      .select({
        _id: Movement._id,
        movementNo: Movement.movementNo,
        user: Movement.user,
        date: Movement.date,
        outTime: Movement.outTime,
        inTime: Movement.inTime,
        durationMinutes: Movement.durationMinutes,
        categoryLabel: Movement.categoryLabel,
        official: Movement.official,
        purpose: Movement.purpose,
        status: Movement.status,
      })
      .from(Movement)
      .where(and(all ? undefined : eq(Movement.user, me), ne(Movement.status, "draft"), match))
      .orderBy(desc(Movement.date), desc(Movement.outTime))
      .limit(FETCH);
    if (rows.length === 0) return null;
    const info = await peopleMap(rows.map((r) => r.user));
    const personalVisible = can(user, "movement.view_personal");
    return group(
      "movements",
      "Movements",
      rows.map((m) => {
        const detail = m.official || m.user === user.id || personalVisible ? m.purpose : "Personal";
        return {
          id: m._id,
          href: `/movement/${m._id}`,
          title: `${info.get(m.user)?.name ?? "Unknown"} · ${fmtDate(m.date)}`,
          meta: join([detail, m.outTime && `out ${fmtTime(m.outTime)}${m.inTime ? ` – in ${fmtTime(m.inTime)}` : ""}`, m.durationMinutes !== null && formatDuration(m.durationMinutes)]),
          tag: m.movementNo,
        };
      }),
      `/movement?q=${enc}`,
    );
  })();

  const assets = (async (): Promise<SearchGroup | null> => {
    if (!can(user, "assets.view")) return null;
    const rows = await db()
      .select({ _id: Asset._id, assetNo: Asset.assetNo, name: Asset.name, category: Asset.category, status: Asset.status, assignedTo: Asset.assignedTo })
      .from(Asset)
      .where(searchAny(q, Asset.name, Asset.assetNo, Asset.serialNo))
      .orderBy(asc(Asset.name))
      .limit(FETCH);
    if (rows.length === 0) return null;
    const holders = await peopleMap(rows.map((r) => r.assignedTo));
    return group(
      "assets",
      "Assets",
      rows.map((a) => ({ id: a._id, href: `/assets/${a._id}`, title: a.name, meta: join([a.category, statusLabel("asset", a.status), a.assignedTo && holders.get(a.assignedTo)?.name]), tag: a.assetNo })),
      `/assets?q=${enc}`,
    );
  })();

  const results = await Promise.all([people, clients, leads, projects, tasks, issues, invoices, proposals, contracts, movements, assets]);
  return results.filter((g): g is SearchGroup => g !== null);
}
