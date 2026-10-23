import "server-only";
import type { Types } from "mongoose";
import { can, isInternLike, type CurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Asset, Client, Contract, Invoice, Issue, Lead, Movement, PERSON_TYPES, Project, Proposal, Task, User } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { searchRegex } from "@/lib/query";
import { optionLabel, statusLabel } from "@/lib/status";
import { fmtDate, fmtTime, formatDuration } from "@/lib/time";
import { inr, titleCase } from "@/lib/format";
import { clientNames, hiddenClientIds, peopleMap } from "@/lib/reports/shared";

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

const ids = (list: { _id: Types.ObjectId }[]) => list.map((x) => x._id);

/**
 * Global search (FRS §22). Every group is scoped on the server to what the user may open:
 * permission-gated modules, own-or-membership visibility for work items, restricted clients
 * and confidential contracts hidden, and personal movement details masked.
 */
export async function runSearch(user: CurrentUser, query: string): Promise<SearchGroup[]> {
  const rx = searchRegex(query);
  if (!rx) return [];
  await connectDB();
  const q = query.trim().slice(0, 100);
  const enc = encodeURIComponent(q);
  const settings = await getSettings();
  const hidden = await hiddenClientIds(user);
  const intern = isInternLike(user);
  const me = user._id;

  const seesClients = can(user, "crm.view");
  const clientVisible: Record<string, unknown> = can(user, "crm.confidential") ? {} : { $or: [{ confidential: { $ne: true } }, { owner: me }] };
  const notHiddenClient = hidden.length ? { client: { $nin: hidden } } : {};

  // Projects the user belongs to (used to scope tasks and QA issues for people without view-all).
  const memberProjects =
    !can(user, "projects.view_all") || !can(user, "tasks.view_all") || !can(user, "qa.view_all")
      ? await Project.distinct("_id", { $or: [{ manager: me }, { "team.user": me }] })
      : [];

  const tasks = (async (): Promise<SearchGroup | null> => {
    const scope: Record<string, unknown> = can(user, "tasks.view_all")
      ? {}
      : { $or: [{ assignees: me }, { sharedWith: me }, ...(intern ? [] : [{ reporter: me }, { reviewer: me }, { project: { $in: memberProjects } }])] };
    const rows = await Task.find({ $and: [scope, { $or: [{ title: rx }, { taskNo: rx }] }] }, { taskNo: 1, title: 1, project: 1, status: 1, dueDate: 1 })
      .sort({ updatedAt: -1 })
      .limit(FETCH)
      .lean();
    if (rows.length === 0) return null;
    const projectIds = rows.flatMap((r) => (r.project ? [r.project] : []));
    const projects = projectIds.length ? await Project.find({ _id: { $in: projectIds } }, { title: 1 }).lean() : [];
    const title = new Map(projects.map((p) => [p._id.toString(), p.title]));
    return group(
      "tasks",
      "Tasks",
      rows.map((t) => ({
        id: t._id.toString(),
        href: `/tasks/${t._id}`,
        title: t.title,
        meta: join([t.project && title.get(t.project.toString()), optionLabel(settings.taskStatuses, t.status), t.dueDate && `due ${fmtDate(t.dueDate)}`]),
        tag: t.taskNo,
      })),
      can(user, "tasks.view_all") ? `/tasks?scope=all&q=${enc}` : `/tasks?q=${enc}`,
    );
  })();

  const projects = (async (): Promise<SearchGroup | null> => {
    const scope = can(user, "projects.view_all") ? {} : { $or: [{ manager: me }, { "team.user": me }] };
    const rows = await Project.find({ $and: [scope, { $or: [{ title: rx }, { projectNo: rx }] }] }, { projectNo: 1, title: 1, status: 1, client: 1 }).sort({ updatedAt: -1 }).limit(FETCH).lean();
    if (rows.length === 0) return null;
    // Interns / trainees never see client names.
    const clients = await clientNames(intern ? [] : rows.map((r) => r.client), user);
    return group(
      "projects",
      "Projects",
      rows.map((p) => ({
        id: p._id.toString(),
        href: `/projects/${p._id}`,
        title: p.title,
        meta: join([!intern && (p.client ? clients.get(p.client.toString()) : "Internal"), optionLabel(settings.projectStatuses, p.status)]),
        tag: p.projectNo,
      })),
      `/projects?q=${enc}`,
    );
  })();

  const issues = (async (): Promise<SearchGroup | null> => {
    const scope: Record<string, unknown> = can(user, "qa.view_all")
      ? {}
      : { $or: [{ assignee: me }, { reporter: me }, ...(intern ? [] : [{ project: { $in: memberProjects } }])] };
    const rows = await Issue.find({ $and: [scope, { $or: [{ title: rx }, { issueNo: rx }] }] }, { issueNo: 1, title: 1, severity: 1, status: 1, project: 1 }).sort({ updatedAt: -1 }).limit(FETCH).lean();
    if (rows.length === 0) return null;
    const projectRows = await Project.find({ _id: { $in: rows.map((r) => r.project) } }, { title: 1 }).lean();
    const title = new Map(projectRows.map((p) => [p._id.toString(), p.title]));
    return group(
      "issues",
      "QA issues",
      rows.map((i) => ({
        id: i._id.toString(),
        href: `/qa/${i._id}`,
        title: i.title,
        meta: join([title.get(i.project.toString()), statusLabel("severity", i.severity), statusLabel("issue", i.status)]),
        tag: i.issueNo,
      })),
      `/qa?q=${enc}`,
    );
  })();

  const people = (async (): Promise<SearchGroup | null> => {
    const match = can(user, "staff.view") ? { $or: [{ name: rx }, { employeeId: rx }, { email: rx }] } : { _id: me, $or: [{ name: rx }, { employeeId: rx }] };
    const rows = await User.find({ personType: { $in: PERSON_TYPES }, ...match }, { name: 1, employeeId: 1, personType: 1 }).sort({ name: 1 }).limit(FETCH).lean();
    if (rows.length === 0) return null;
    const info = await peopleMap(ids(rows));
    return group(
      "people",
      "People",
      rows.map((u) => {
        const p = info.get(u._id.toString());
        return { id: u._id.toString(), href: `/staff/${u._id}`, title: u.name, meta: join([p?.designation, p?.department, titleCase(u.personType)]), tag: u.employeeId };
      }),
      `/staff?q=${enc}`,
    );
  })();

  const clients = (async (): Promise<SearchGroup | null> => {
    if (!seesClients) return null;
    const rows = await Client.find({ $and: [clientVisible, { $or: [{ name: rx }, { contactPerson: rx }, { email: rx }, { clientNo: rx }, { phone: rx }] }] }, { clientNo: 1, name: 1, contactPerson: 1, status: 1, confidential: 1 })
      .sort({ name: 1 })
      .limit(FETCH)
      .lean();
    if (rows.length === 0) return null;
    return group(
      "clients",
      "Clients",
      rows.map((c) => ({ id: c._id.toString(), href: `/crm/clients/${c._id}`, title: c.name, meta: join([c.contactPerson, statusLabel("client", c.status), c.confidential && "Restricted"]), tag: c.clientNo })),
      `/crm/clients?q=${enc}`,
    );
  })();

  const leads = (async (): Promise<SearchGroup | null> => {
    if (!seesClients) return null;
    const rows = await Lead.find({ $and: [notHiddenClient, { $or: [{ title: rx }, { companyName: rx }, { contactName: rx }, { leadNo: rx }, { email: rx }] }] }, { leadNo: 1, title: 1, companyName: 1, stage: 1, status: 1 })
      .sort({ updatedAt: -1 })
      .limit(FETCH)
      .lean();
    if (rows.length === 0) return null;
    return group(
      "leads",
      "Leads & enquiries",
      rows.map((l) => ({
        id: l._id.toString(),
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
    const matchingClients = await Client.find({ $and: [clientVisible, { name: rx }] }, { _id: 1 }).limit(50).lean();
    const rows = await Invoice.find(
      { $and: [notHiddenClient, { $or: [{ invoiceNo: rx }, { draftNo: rx }, { client: { $in: ids(matchingClients) } }] }] },
      { invoiceNo: 1, draftNo: 1, client: 1, total: 1, status: 1, balance: 1 },
    )
      .sort({ issueDate: -1 })
      .limit(FETCH)
      .lean();
    if (rows.length === 0) return null;
    const names = await clientNames(rows.map((r) => r.client), user);
    return group(
      "invoices",
      "Invoices",
      rows.map((i) => ({
        id: i._id.toString(),
        href: `/invoices/${i._id}`,
        title: i.invoiceNo ?? i.draftNo,
        meta: join([names.get(i.client.toString()), inr(i.total), statusLabel("invoice", i.status)]),
        tag: i.balance > 0 && i.status !== "cancelled" ? `${inr(i.balance)} due` : undefined,
      })),
      `/invoices?q=${enc}`,
    );
  })();

  const proposals = (async (): Promise<SearchGroup | null> => {
    if (!can(user, "proposals.view")) return null;
    const rows = await Proposal.find({ $and: [notHiddenClient, { $or: [{ proposalNo: rx }, { title: rx }] }] }, { proposalNo: 1, title: 1, client: 1, status: 1, total: 1 }).sort({ updatedAt: -1 }).limit(FETCH).lean();
    if (rows.length === 0) return null;
    const names = await clientNames(rows.map((r) => r.client), user);
    return group(
      "proposals",
      "Proposals & quotations",
      rows.map((p) => ({ id: p._id.toString(), href: `/proposals/${p._id}`, title: p.title, meta: join([names.get(p.client.toString()), statusLabel("proposal", p.status), inr(p.total)]), tag: p.proposalNo })),
      `/proposals?q=${enc}`,
    );
  })();

  const contracts = (async (): Promise<SearchGroup | null> => {
    if (!can(user, "contracts.view")) return null;
    const open = can(user, "crm.confidential") || can(user, "contracts.manage");
    const visible = open ? {} : { $or: [{ confidential: { $ne: true } }, { createdBy: me }] };
    const rows = await Contract.find({ $and: [visible, notHiddenClient, { $or: [{ contractNo: rx }, { title: rx }] }] }, { contractNo: 1, title: 1, client: 1, status: 1, endDate: 1 })
      .sort({ updatedAt: -1 })
      .limit(FETCH)
      .lean();
    if (rows.length === 0) return null;
    const names = await clientNames(rows.map((r) => r.client), user);
    return group(
      "contracts",
      "Contracts",
      rows.map((c) => ({ id: c._id.toString(), href: `/contracts/${c._id}`, title: c.title, meta: join([names.get(c.client.toString()), statusLabel("contract", c.status), c.endDate && `ends ${fmtDate(c.endDate)}`]), tag: c.contractNo })),
      `/contracts?q=${enc}`,
    );
  })();

  const movements = (async (): Promise<SearchGroup | null> => {
    const all = can(user, "movement.view_all");
    const isDate = /^\d{4}-\d{2}-\d{2}$/.test(q);
    let match: Record<string, unknown>;
    if (isDate) match = { date: q };
    else {
      const people = all ? await User.find({ personType: { $in: PERSON_TYPES }, name: rx }, { _id: 1 }).limit(50).lean() : [];
      match = { $or: [{ movementNo: rx }, ...(people.length ? [{ user: { $in: ids(people) } }] : [])] };
    }
    const rows = await Movement.find({ $and: [all ? {} : { user: me }, { status: { $ne: "draft" } }, match] }, { movementNo: 1, user: 1, date: 1, outTime: 1, inTime: 1, durationMinutes: 1, categoryLabel: 1, official: 1, purpose: 1, status: 1 })
      .sort({ date: -1, outTime: -1 })
      .limit(FETCH)
      .lean();
    if (rows.length === 0) return null;
    const info = await peopleMap(rows.map((r) => r.user));
    const personalVisible = can(user, "movement.view_personal");
    return group(
      "movements",
      "Movements",
      rows.map((m) => {
        const detail = m.official || m.user.toString() === user.id || personalVisible ? m.purpose : "Personal";
        return {
          id: m._id.toString(),
          href: `/movement/${m._id}`,
          title: `${info.get(m.user.toString())?.name ?? "Unknown"} · ${fmtDate(m.date)}`,
          meta: join([detail, m.outTime && `out ${fmtTime(m.outTime)}${m.inTime ? ` – in ${fmtTime(m.inTime)}` : ""}`, m.durationMinutes !== undefined && formatDuration(m.durationMinutes)]),
          tag: m.movementNo,
        };
      }),
      `/movement?q=${enc}`,
    );
  })();

  const assets = (async (): Promise<SearchGroup | null> => {
    if (!can(user, "assets.view")) return null;
    const rows = await Asset.find({ $or: [{ name: rx }, { assetNo: rx }, { serialNo: rx }] }, { assetNo: 1, name: 1, category: 1, status: 1, assignedTo: 1 }).sort({ name: 1 }).limit(FETCH).lean();
    if (rows.length === 0) return null;
    const holders = await peopleMap(rows.map((r) => r.assignedTo));
    return group(
      "assets",
      "Assets",
      rows.map((a) => ({ id: a._id.toString(), href: `/assets/${a._id}`, title: a.name, meta: join([a.category, statusLabel("asset", a.status), a.assignedTo && holders.get(a.assignedTo.toString())?.name]), tag: a.assetNo })),
      `/assets?q=${enc}`,
    );
  })();

  const results = await Promise.all([people, clients, leads, projects, tasks, issues, invoices, proposals, contracts, movements, assets]);
  return results.filter((g): g is SearchGroup => g !== null);
}
