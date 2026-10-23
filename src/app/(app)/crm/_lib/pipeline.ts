import type { AppSettings } from "@/lib/config-defaults";
import { todayKey } from "@/lib/time";

export type PipelineStage = AppSettings["pipelineStages"][number];

export function openStages(stages: PipelineStage[]): PipelineStage[] {
  return stages.filter((s) => s.category === "open");
}

export function stageByKey(stages: PipelineStage[], key: string | undefined | null): PipelineStage | undefined {
  return key ? stages.find((s) => s.key === key) : undefined;
}

/** First configured stage of a category (the "won" / "lost" landing stage). */
export function firstStageOf(stages: PipelineStage[], category: PipelineStage["category"]): PipelineStage | undefined {
  return stages.find((s) => s.category === category);
}

/**
 * Finds a stage by key or by a label fragment (stages are configurable, so "Proposal sent" is matched
 * on its default key first, then on the label). Only open stages are considered.
 */
export function findOpenStage(stages: PipelineStage[], keys: string[], labelHint: RegExp): PipelineStage | undefined {
  const open = openStages(stages);
  return open.find((s) => keys.includes(s.key)) ?? open.find((s) => labelHint.test(s.label));
}

/** Indian fiscal year (April–March) containing today, as company-zone day keys. */
export function currentFiscalRange(): { from: string; to: string; label: string } {
  const [y, m] = todayKey().split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31`, label: `${start}-${String((start + 1) % 100).padStart(2, "0")}` };
}
