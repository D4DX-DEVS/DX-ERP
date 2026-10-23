import "server-only";
import { connectDB } from "@/lib/db";
import { Client, Lead } from "@/lib/models";
import { escapeRegex } from "@/lib/format";
import type { CurrentUser } from "@/lib/auth/session";
import { canSeeClient } from "./access";

export interface DuplicateMatch {
  kind: "client" | "lead";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  reasons: string[];
}

export interface DuplicateReport {
  matches: DuplicateMatch[];
  /** Matches that exist but belong to restricted clients (not described to the user). */
  restricted: number;
}

export interface DuplicateQuery {
  email?: string;
  phone?: string;
  companyName?: string;
  /** Include existing clients in the search (false when attaching a lead to a chosen client). */
  includeClients: boolean;
  excludeClientId?: string;
  excludeLeadId?: string;
}

const digitsOnly = (v: string | undefined) => (v ?? "").replace(/\D/g, "");
const phoneTail = (v: string | undefined) => {
  const d = digitsOnly(v);
  return d.length >= 7 ? d.slice(-10) : "";
};

/** Matches a stored phone string ignoring any formatting, comparing the last 10 digits. */
function phoneRegex(tail: string): RegExp {
  return new RegExp(`${tail.split("").join("[^0-9]*")}[^0-9]*$`);
}

/**
 * Duplicate check (FRS §14.2, §22): existing clients and open leads that share the email, phone
 * (digits only) or company name (case-insensitive).
 */
export async function findDuplicates(user: CurrentUser, q: DuplicateQuery): Promise<DuplicateReport> {
  await connectDB();
  const email = q.email?.trim().toLowerCase();
  const tail = phoneTail(q.phone);
  const name = q.companyName?.trim();
  const nameRe = name ? new RegExp(`^${escapeRegex(name)}$`, "i") : undefined;
  if (!email && !tail && !nameRe) return { matches: [], restricted: 0 };

  const phoneRe = tail ? phoneRegex(tail) : undefined;
  const reasonsFor = (rec: { email?: string; phone?: string; altPhone?: string; name: string }): string[] => {
    const reasons: string[] = [];
    if (email && rec.email?.toLowerCase() === email) reasons.push("Same email");
    if (tail && [rec.phone, rec.altPhone].some((p) => phoneTail(p) === tail)) reasons.push("Same phone");
    if (nameRe && nameRe.test(rec.name)) reasons.push("Same company name");
    return reasons;
  };

  const matches: DuplicateMatch[] = [];
  let restricted = 0;

  if (q.includeClients) {
    const or: Record<string, unknown>[] = [];
    if (email) or.push({ email });
    if (phoneRe) or.push({ phone: phoneRe }, { altPhone: phoneRe });
    if (nameRe) or.push({ name: nameRe });
    const filter: Record<string, unknown> = { $or: or };
    if (q.excludeClientId) filter._id = { $ne: q.excludeClientId };
    const clients = await Client.find(filter).limit(10).lean();
    for (const c of clients) {
      if (!canSeeClient(user, c)) {
        restricted++;
        continue;
      }
      matches.push({
        kind: "client",
        id: c._id.toString(),
        title: c.name,
        subtitle: `${c.clientNo}${c.contactPerson ? ` · ${c.contactPerson}` : ""}`,
        href: `/crm/clients/${c._id}`,
        reasons: reasonsFor(c),
      });
    }
  }

  const leadOr: Record<string, unknown>[] = [];
  if (email) leadOr.push({ email });
  if (phoneRe) leadOr.push({ phone: phoneRe });
  if (nameRe) leadOr.push({ companyName: nameRe });
  const leadFilter: Record<string, unknown> = { status: "open", $or: leadOr };
  if (q.excludeLeadId) leadFilter._id = { $ne: q.excludeLeadId };
  const leads = await Lead.find(leadFilter).limit(10).lean();
  const clientIds = [...new Set(leads.map((l) => l.client?.toString()).filter(Boolean))] as string[];
  const clientDocs = clientIds.length ? await Client.find({ _id: { $in: clientIds } }, { confidential: 1, owner: 1 }).lean() : [];
  const clientById = new Map(clientDocs.map((c) => [c._id.toString(), c]));
  for (const l of leads) {
    const linked = l.client ? clientById.get(l.client.toString()) : undefined;
    if (linked && !canSeeClient(user, linked)) {
      restricted++;
      continue;
    }
    matches.push({
      kind: "lead",
      id: l._id.toString(),
      title: l.title,
      subtitle: `${l.leadNo} · ${l.companyName}`,
      href: `/crm/leads/${l._id}`,
      reasons: reasonsFor({ email: l.email, phone: l.phone, name: l.companyName }),
    });
  }
  return { matches, restricted };
}
