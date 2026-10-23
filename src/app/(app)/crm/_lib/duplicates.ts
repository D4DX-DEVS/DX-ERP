import "server-only";
import { and, eq, ne, or, sql, type Column, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { Client, Lead } from "@/lib/models";
import { escapeRegex } from "@/lib/format";
import { eqIgnoreCase, inList } from "@/lib/sql";
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
 * SQL pre-filter for `phoneRegex` (SQLite has no regex): the tail's digits appear in order. Necessary
 * but not sufficient, so candidates are re-checked with the real RegExp in JS.
 */
function phoneCandidate(col: Column, tail: string): SQL {
  return sql`${col} like ${`%${tail.split("").join("%")}%`}`;
}

/** Candidate rows fetched per table before the exact JS check (the old queries returned at most 10 matches). */
const CANDIDATES = 50;
const MAX_MATCHES = 10;

/**
 * Duplicate check (FRS §14.2, §22): existing clients and open leads that share the email, phone
 * (digits only) or company name (case-insensitive).
 */
export async function findDuplicates(user: CurrentUser, q: DuplicateQuery): Promise<DuplicateReport> {
  const email = q.email?.trim().toLowerCase();
  const tail = phoneTail(q.phone);
  const name = q.companyName?.trim();
  const nameRe = name ? new RegExp(`^${escapeRegex(name)}$`, "i") : undefined;
  if (!email && !tail && !nameRe) return { matches: [], restricted: 0 };

  const phoneRe = tail ? phoneRegex(tail) : undefined;
  const reasonsFor = (rec: { email?: string | null; phone?: string | null; altPhone?: string | null; name: string }): string[] => {
    const reasons: string[] = [];
    if (email && rec.email?.toLowerCase() === email) reasons.push("Same email");
    if (tail && [rec.phone, rec.altPhone].some((p) => phoneTail(p ?? undefined) === tail)) reasons.push("Same phone");
    if (nameRe && nameRe.test(rec.name)) reasons.push("Same company name");
    return reasons;
  };

  const matches: DuplicateMatch[] = [];
  let restricted = 0;

  if (q.includeClients) {
    const any: (SQL | undefined)[] = [];
    if (email) any.push(eq(Client.email, email));
    if (tail) any.push(phoneCandidate(Client.phone, tail), phoneCandidate(Client.altPhone, tail));
    if (name) any.push(eqIgnoreCase(Client.name, name));
    const candidates = await db()
      .select({
        _id: Client._id,
        clientNo: Client.clientNo,
        name: Client.name,
        contactPerson: Client.contactPerson,
        email: Client.email,
        phone: Client.phone,
        altPhone: Client.altPhone,
        confidential: Client.confidential,
        owner: Client.owner,
      })
      .from(Client)
      .where(and(or(...any), q.excludeClientId ? ne(Client._id, q.excludeClientId) : undefined))
      .limit(CANDIDATES);
    const clients = candidates
      .filter((c) => (email && c.email === email) || phoneRe?.test(c.phone ?? "") || phoneRe?.test(c.altPhone ?? "") || nameRe?.test(c.name))
      .slice(0, MAX_MATCHES);
    for (const c of clients) {
      if (!canSeeClient(user, c)) {
        restricted++;
        continue;
      }
      matches.push({
        kind: "client",
        id: c._id,
        title: c.name,
        subtitle: `${c.clientNo}${c.contactPerson ? ` · ${c.contactPerson}` : ""}`,
        href: `/crm/clients/${c._id}`,
        reasons: reasonsFor(c),
      });
    }
  }

  const leadAny: (SQL | undefined)[] = [];
  if (email) leadAny.push(eq(Lead.email, email));
  if (tail) leadAny.push(phoneCandidate(Lead.phone, tail));
  if (name) leadAny.push(eqIgnoreCase(Lead.companyName, name));
  const leadCandidates = await db()
    .select({ _id: Lead._id, title: Lead.title, leadNo: Lead.leadNo, companyName: Lead.companyName, email: Lead.email, phone: Lead.phone, client: Lead.client })
    .from(Lead)
    .where(and(eq(Lead.status, "open"), or(...leadAny), q.excludeLeadId ? ne(Lead._id, q.excludeLeadId) : undefined))
    .limit(CANDIDATES);
  const leads = leadCandidates
    .filter((l) => (email && l.email === email) || phoneRe?.test(l.phone ?? "") || nameRe?.test(l.companyName))
    .slice(0, MAX_MATCHES);
  const clientIds = [...new Set(leads.map((l) => l.client).filter((c): c is string => Boolean(c)))];
  const clientDocs = clientIds.length ? await db().select({ _id: Client._id, confidential: Client.confidential, owner: Client.owner }).from(Client).where(inList(Client._id, clientIds)) : [];
  const clientById = new Map(clientDocs.map((c) => [c._id, c]));
  for (const l of leads) {
    const linked = l.client ? clientById.get(l.client) : undefined;
    if (linked && !canSeeClient(user, linked)) {
      restricted++;
      continue;
    }
    matches.push({
      kind: "lead",
      id: l._id,
      title: l.title,
      subtitle: `${l.leadNo} · ${l.companyName}`,
      href: `/crm/leads/${l._id}`,
      reasons: reasonsFor({ email: l.email, phone: l.phone, name: l.companyName }),
    });
  }
  return { matches, restricted };
}
