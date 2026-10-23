import "server-only";
import { and, eq, gte, isNull, lte, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { Lead, User } from "@/lib/models";
import { inList } from "@/lib/sql";
import { endOfDay, startOfDay } from "@/lib/time";
import { currentFiscalRange, type PipelineStage } from "./pipeline";

export interface UserCard {
  name: string;
  photo?: string;
}

/** Name + photo for a set of user ids (owner avatars). */
export async function userCards(ids: (string | null | undefined)[]): Promise<Map<string, UserCard>> {
  const unique = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  if (unique.length === 0) return new Map();
  const users = await db().select({ id: User._id, name: User.name, photo: User.photo }).from(User).where(inList(User._id, unique));
  return new Map(users.map((u) => [u.id, { name: u.name, photo: u.photo ?? undefined }]));
}

/** Condition for leads closed (won or lost) in the current fiscal year. Falls back to updatedAt for legacy rows. */
export function closedThisFiscalYear(status: "won" | "lost"): SQL {
  const fy = currentFiscalRange();
  const from = startOfDay(fy.from);
  const to = endOfDay(fy.to);
  return and(
    eq(Lead.status, status),
    or(and(gte(Lead.closedAt, from), lte(Lead.closedAt, to)), and(isNull(Lead.closedAt), gte(Lead.updatedAt, from), lte(Lead.updatedAt, to))),
  )!;
}

export interface PipelineMetrics {
  openCount: number;
  openValue: number;
  weightedValue: number;
  wonCount: number;
  wonValue: number;
  lostCount: number;
  topLostReason?: string;
  /** Won / (won + lost) for the fiscal year, as a percentage (null when nothing closed yet). */
  winRate: number | null;
  fiscalLabel: string;
}

/** Headline pipeline numbers for the pipeline page (scoped by the caller's lead filter). */
export async function pipelineMetrics(scope: SQL | undefined, stages: PipelineStage[]): Promise<PipelineMetrics> {
  const probability = new Map(stages.map((s) => [s.key, s.probability]));
  const [open, won, lost] = await Promise.all([
    db().select({ stage: Lead.stage, expectedValue: Lead.expectedValue }).from(Lead).where(and(scope, eq(Lead.status, "open"))),
    db().select({ expectedValue: Lead.expectedValue }).from(Lead).where(and(scope, closedThisFiscalYear("won"))),
    db().select({ lostReason: Lead.lostReason }).from(Lead).where(and(scope, closedThisFiscalYear("lost"))),
  ]);
  const reasons = new Map<string, number>();
  for (const l of lost) if (l.lostReason) reasons.set(l.lostReason, (reasons.get(l.lostReason) ?? 0) + 1);
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const closed = won.length + lost.length;
  return {
    openCount: open.length,
    openValue: open.reduce((s, l) => s + (l.expectedValue ?? 0), 0),
    weightedValue: open.reduce((s, l) => s + ((l.expectedValue ?? 0) * (probability.get(l.stage) ?? 0)) / 100, 0),
    wonCount: won.length,
    wonValue: won.reduce((s, l) => s + (l.expectedValue ?? 0), 0),
    lostCount: lost.length,
    topLostReason: top,
    winRate: closed > 0 ? Math.round((won.length / closed) * 100) : null,
    fiscalLabel: currentFiscalRange().label,
  };
}
