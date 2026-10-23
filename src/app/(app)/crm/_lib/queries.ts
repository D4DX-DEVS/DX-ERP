import "server-only";
import { connectDB } from "@/lib/db";
import { Lead, User } from "@/lib/models";
import { endOfDay, startOfDay } from "@/lib/time";
import { currentFiscalRange, type PipelineStage } from "./pipeline";

export interface UserCard {
  name: string;
  photo?: string;
}

/** Name + photo for a set of user ids (owner avatars). */
export async function userCards(ids: (string | { toString(): string } | null | undefined)[]): Promise<Map<string, UserCard>> {
  const unique = [...new Set(ids.filter(Boolean).map((i) => i!.toString()))];
  if (unique.length === 0) return new Map();
  await connectDB();
  const users = await User.find({ _id: { $in: unique } }, { name: 1, photo: 1 }).lean();
  return new Map(users.map((u) => [u._id.toString(), { name: u.name, photo: u.photo }]));
}

/** Filter for leads closed (won or lost) in the current fiscal year. Falls back to updatedAt for legacy rows. */
export function closedThisFiscalYear(status: "won" | "lost"): Record<string, unknown> {
  const fy = currentFiscalRange();
  const range = { $gte: startOfDay(fy.from), $lte: endOfDay(fy.to) };
  return { status, $or: [{ closedAt: range }, { closedAt: null, updatedAt: range }] };
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
export async function pipelineMetrics(scope: Record<string, unknown>, stages: PipelineStage[]): Promise<PipelineMetrics> {
  await connectDB();
  const probability = new Map(stages.map((s) => [s.key, s.probability]));
  const [open, won, lost] = await Promise.all([
    Lead.find({ ...scope, status: "open" }, { stage: 1, expectedValue: 1 }).lean(),
    Lead.find({ $and: [scope, closedThisFiscalYear("won")] }, { expectedValue: 1 }).lean(),
    Lead.find({ $and: [scope, closedThisFiscalYear("lost")] }, { lostReason: 1 }).lean(),
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
