import "server-only";
import { connectDB } from "@/lib/db";
import { Lead, Proposal } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { statusLabel } from "@/lib/status";
import { fmtDate } from "@/lib/time";
import { inr, round2, titleCase } from "@/lib/format";
import { clientNames, clientScope, hiddenClientIds, instantRange, peopleMap, rangeOf, RANGE_FILTERS } from "./shared";
import { defineReport } from "./types";

/* ------------------------------------------------------ enquiries & conversion */

interface ConversionRow {
  group: string;
  total: number;
  open: number;
  won: number;
  lost: number;
  conversion?: number;
  winRate?: number;
  openValue: number;
  wonValue: number;
  avgDaysToWin?: number;
}

const enquiriesConversion = defineReport<ConversionRow>({
  key: "enquiries-conversion",
  title: "Enquiries & conversion rates",
  group: "CRM & Finance",
  description: "Leads created in the period by source, pipeline stage or owner, with won / lost counts and conversion rate.",
  permissions: ["reports.view", "crm.view"],
  filters: [
    ...RANGE_FILTERS,
    {
      key: "groupBy",
      label: "Group by",
      type: "select",
      options: [
        { value: "source", label: "Lead source" },
        { value: "stage", label: "Pipeline stage" },
        { value: "owner", label: "Assigned to" },
      ],
      defaultValue: () => "source",
    },
    { key: "source", label: "Source", type: "select", optionsFrom: "leadSources" },
    { key: "owner", label: "Assigned to", type: "person" },
  ],
  async run(f, user) {
    await connectDB();
    const settings = await getSettings();
    const hidden = await hiddenClientIds(user);
    const { from, to } = rangeOf(f);
    const { start, end } = instantRange(from, to);
    const filter: Record<string, unknown> = { createdAt: { $gte: start, $lte: end }, ...(hidden.length ? { client: { $nin: hidden } } : {}) };
    if (f.source) filter.source = f.source;
    if (f.owner) filter.assignedTo = f.owner;
    const leads = await Lead.find(filter, { source: 1, stage: 1, status: 1, assignedTo: 1, expectedValue: 1, budget: 1, convertedAt: 1, createdAt: 1 }).limit(50_000).lean();
    const people = await peopleMap(leads.map((l) => l.assignedTo));
    const groupBy = f.groupBy || "source";
    const keyOf = (l: (typeof leads)[number]): string => {
      if (groupBy === "stage") return settings.pipelineStages.find((s) => s.key === l.stage)?.label ?? titleCase(l.stage);
      if (groupBy === "owner") return l.assignedTo ? (people.get(l.assignedTo.toString())?.name ?? "Unknown") : "Unassigned";
      return l.source || "Unspecified";
    };
    const groups = new Map<string, ConversionRow & { winDays: number[] }>();
    for (const l of leads) {
      const key = keyOf(l);
      const g = groups.get(key) ?? { group: key, total: 0, open: 0, won: 0, lost: 0, openValue: 0, wonValue: 0, winDays: [] };
      const value = l.expectedValue ?? l.budget ?? 0;
      g.total += 1;
      if (l.status === "won") {
        g.won += 1;
        g.wonValue += value;
        if (l.convertedAt) g.winDays.push((l.convertedAt.getTime() - l.createdAt.getTime()) / 86_400_000);
      } else if (l.status === "lost") g.lost += 1;
      else {
        g.open += 1;
        g.openValue += value;
      }
      groups.set(key, g);
    }
    const rows: ConversionRow[] = [...groups.values()]
      .map((g) => ({
        group: g.group,
        total: g.total,
        open: g.open,
        won: g.won,
        lost: g.lost,
        conversion: g.total ? Math.round((g.won / g.total) * 100) : undefined,
        winRate: g.won + g.lost ? Math.round((g.won / (g.won + g.lost)) * 100) : undefined,
        openValue: g.openValue,
        wonValue: g.wonValue,
        avgDaysToWin: g.winDays.length ? Math.round(g.winDays.reduce((s, d) => s + d, 0) / g.winDays.length) : undefined,
      }))
      .sort((a, b) => b.total - a.total);
    const won = rows.reduce((s, r) => s + r.won, 0);
    const lost = rows.reduce((s, r) => s + r.lost, 0);
    const total = rows.reduce((s, r) => s + r.total, 0);
    const label = { source: "Lead source", stage: "Pipeline stage", owner: "Assigned to" }[groupBy] ?? "Lead source";
    return {
      columns: [
        { header: label, value: (r) => r.group, width: 26 },
        { header: "Enquiries", value: (r) => r.total, type: "number" },
        { header: "Open", value: (r) => r.open, type: "number" },
        { header: "Won", value: (r) => r.won, type: "number" },
        { header: "Lost", value: (r) => r.lost, type: "number" },
        { header: "Conversion %", value: (r) => r.conversion, type: "number" },
        { header: "Win rate %", value: (r) => r.winRate, type: "number" },
        { header: "Open pipeline value", value: (r) => r.openValue, type: "money" },
        { header: "Won value", value: (r) => r.wonValue, type: "money" },
        { header: "Avg days to win", value: (r) => r.avgDaysToWin, type: "number" },
      ],
      rows,
      summary: [
        { label: "Enquiries", value: String(total) },
        { label: "Won", value: String(won) },
        { label: "Lost", value: String(lost) },
        { label: "Conversion", value: total ? `${Math.round((won / total) * 100)}%` : "—" },
        { label: "Win rate", value: won + lost ? `${Math.round((won / (won + lost)) * 100)}%` : "—" },
      ],
      note: "Conversion = won ÷ all enquiries; win rate = won ÷ (won + lost). Leads of restricted clients are excluded unless you may see them.",
    };
  },
});

/* ------------------------------------------------------ proposals & pipeline */

interface ProposalRow {
  proposalNo: string;
  kind: string;
  version: number;
  title: string;
  client: string;
  status: string;
  statusKey: string;
  total: number;
  sentAt?: Date;
  decidedAt?: Date;
  validUntil?: string;
  owner: string;
  createdAt: Date;
}

const proposalPipeline = defineReport<ProposalRow>({
  key: "proposal-pipeline",
  title: "Proposal status & pipeline",
  group: "CRM & Finance",
  description: "Proposals and quotations created in the period with status, value and decision dates.",
  permissions: ["reports.view", "proposals.view"],
  filters: [
    ...RANGE_FILTERS,
    { key: "status", label: "Status", type: "select", options: ["draft", "sent", "negotiation", "approved", "rejected", "expired", "converted"].map((s) => ({ value: s, label: statusLabel("proposal", s) })) },
    { key: "client", label: "Client", type: "client" },
  ],
  async run(f, user) {
    await connectDB();
    const hidden = await hiddenClientIds(user);
    const { from, to } = rangeOf(f);
    const { start, end } = instantRange(from, to);
    const filter: Record<string, unknown> = { createdAt: { $gte: start, $lte: end }, ...clientScope(f, hidden) };
    if (f.status) filter.status = f.status;
    const docs = await Proposal.find(filter, { proposalNo: 1, kind: 1, version: 1, title: 1, client: 1, status: 1, total: 1, sentAt: 1, decidedAt: 1, validUntil: 1, owner: 1, createdAt: 1 })
      .sort({ createdAt: -1 })
      .limit(20_000)
      .lean();
    const [clients, people] = await Promise.all([clientNames(docs.map((d) => d.client), user), peopleMap(docs.map((d) => d.owner))]);
    const rows: ProposalRow[] = docs.map((d) => ({
      proposalNo: d.proposalNo,
      kind: titleCase(d.kind),
      version: d.version,
      title: d.title,
      client: clients.get(d.client.toString()) ?? "",
      status: statusLabel("proposal", d.status),
      statusKey: d.status,
      total: d.total,
      sentAt: d.sentAt,
      decidedAt: d.decidedAt,
      validUntil: d.validUntil,
      owner: d.owner ? (people.get(d.owner.toString())?.name ?? "") : "",
      createdAt: d.createdAt,
    }));
    const value = (...keys: string[]) => round2(rows.filter((r) => keys.includes(r.statusKey)).reduce((s, r) => s + r.total, 0));
    const decided = rows.filter((r) => ["approved", "rejected", "converted"].includes(r.statusKey));
    const accepted = decided.filter((r) => r.statusKey !== "rejected");
    return {
      columns: [
        { header: "Number", value: (r) => r.proposalNo },
        { header: "Type", value: (r) => r.kind },
        { header: "Version", value: (r) => r.version, type: "number" },
        { header: "Title", value: (r) => r.title, width: 34 },
        { header: "Client", value: (r) => r.client, width: 26 },
        { header: "Status", value: (r) => r.status },
        { header: "Value", value: (r) => r.total, type: "money" },
        { header: "Created", value: (r) => fmtDate(r.createdAt) },
        { header: "Sent", value: (r) => fmtDate(r.sentAt) },
        { header: "Decided", value: (r) => fmtDate(r.decidedAt) },
        { header: "Valid until", value: (r) => fmtDate(r.validUntil) },
        { header: "Owner", value: (r) => r.owner, width: 22 },
      ],
      rows,
      summary: [
        { label: "Proposals", value: String(rows.length) },
        { label: "In pipeline (sent / negotiation)", value: String(rows.filter((r) => ["sent", "negotiation"].includes(r.statusKey)).length) },
        { label: "Pipeline value", value: inr(value("sent", "negotiation")) },
        { label: "Approved / converted value", value: inr(value("approved", "converted")) },
        { label: "Acceptance rate", value: decided.length ? `${Math.round((accepted.length / decided.length) * 100)}%` : "—" },
      ],
      note: "Proposals for restricted clients are excluded unless you may see them.",
    };
  },
});

export const crmReports = [enquiriesConversion, proposalPipeline];
