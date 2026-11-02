/** Client-safe constants for the structured education records (qualifications + their certificates). */

/** Legacy flat document category for educational certificates (still listed when old files exist). */
export const EDUCATION_CATEGORY = "education";
/** `StoredFile.category` of certificate files attached to an education record. */
export const EDUCATION_FILE_CATEGORY = "education_record";

export const EDUCATION_LEVELS: { key: string; label: string; short: string }[] = [
  { key: "sslc", label: "SSLC / 10th standard", short: "SSLC / 10th" },
  { key: "hss", label: "Higher secondary (HSS / Plus Two / 12th)", short: "Higher secondary" },
  { key: "iti", label: "ITI / vocational", short: "ITI" },
  { key: "diploma", label: "Diploma", short: "Diploma" },
  { key: "ug", label: "Bachelor's degree (UG)", short: "Degree (UG)" },
  { key: "pg", label: "Master's degree (PG)", short: "Postgraduate (PG)" },
  { key: "doctorate", label: "Doctorate (PhD)", short: "Doctorate" },
  { key: "certification", label: "Professional certification / course", short: "Certification" },
  { key: "other", label: "Other", short: "Other" },
];

export const EDUCATION_CERTIFICATE_TYPES: { key: string; label: string }[] = [
  { key: "marksheet", label: "Marksheet / grade card" },
  { key: "consolidated_marksheet", label: "Consolidated marksheet" },
  { key: "provisional", label: "Provisional certificate" },
  { key: "course_completion", label: "Course completion certificate" },
  { key: "degree", label: "Degree / pass certificate" },
  { key: "transfer", label: "Transfer certificate (TC)" },
  { key: "migration", label: "Migration certificate" },
  { key: "conduct", label: "Conduct / character certificate" },
  { key: "equivalency", label: "Equivalency certificate" },
  { key: "other", label: "Other" },
];

/** Certificates usually collected for each level — shown as a checklist; every type can still be uploaded. */
export const EXPECTED_CERTIFICATES: Record<string, string[]> = {
  sslc: ["marksheet"],
  hss: ["marksheet", "transfer"],
  iti: ["marksheet", "course_completion"],
  diploma: ["consolidated_marksheet", "course_completion", "degree"],
  ug: ["consolidated_marksheet", "provisional", "degree"],
  pg: ["consolidated_marksheet", "provisional", "degree"],
  doctorate: ["provisional", "degree"],
  certification: ["course_completion"],
  other: [],
};

const levelOrder = new Map(EDUCATION_LEVELS.map((l, i) => [l.key, i]));

export function educationLevelLabel(key: string, short = false): string {
  const level = EDUCATION_LEVELS.find((l) => l.key === key);
  return level ? (short ? level.short : level.label) : key;
}

export function certificateTypeLabel(key: string): string {
  return EDUCATION_CERTIFICATE_TYPES.find((t) => t.key === key)?.label ?? key;
}

/** Sort key: level order (SSLC first), then the year of passing. */
export function educationSortKey(level: string, endYear: number | null | undefined): number {
  return (levelOrder.get(level) ?? 99) * 10_000 + (endYear ?? 0);
}
