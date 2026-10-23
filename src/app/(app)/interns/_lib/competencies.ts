/** Evaluation competencies (client- and server-safe). Ratings are 1–5. */
export const COMPETENCIES = [
  { key: "quality", label: "Quality of work", hint: "Accuracy, polish and completeness" },
  { key: "communication", label: "Communication", hint: "Updates, questions and handoff notes" },
  { key: "learning", label: "Learning ability", hint: "Picks up new tools and feedback quickly" },
  { key: "ownership", label: "Ownership", hint: "Takes responsibility and flags blockers" },
  { key: "punctuality", label: "Punctuality", hint: "Attendance and meeting deadlines" },
] as const;

export type CompetencyKey = (typeof COMPETENCIES)[number]["key"];

/** Average of ratings, one decimal. */
export function averageRating(scores: number[]): number {
  if (scores.length === 0) return 0;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}
