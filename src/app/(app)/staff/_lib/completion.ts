/** Profile completion (pure, client-safe): which of a person's details and documents are on file. */
import type { DocumentCategory } from "@/lib/config-defaults";
import { BANK_CATEGORY } from "./bank";
import { categoriesFor } from "./documents";
import { EDUCATION_CATEGORY, educationLevelLabel } from "./education";

export type CompletionSectionKey = "personal" | "employment" | "documents" | "education" | "bank";

export interface CompletionItem {
  label: string;
  done: boolean;
}

export interface CompletionSection {
  key: CompletionSectionKey;
  label: string;
  items: CompletionItem[];
  done: number;
  total: number;
}

export interface ProfileCompletion {
  /** 0–100, rounded down so 100 means everything is on file. */
  pct: number;
  done: number;
  total: number;
  sections: CompletionSection[];
}

export interface CompletionFacts {
  person: {
    personType: string;
    photo?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
    personalEmail?: string | null;
    dob?: string | null;
    gender?: string | null;
    bloodGroup?: string | null;
    address?: { line1?: string; city?: string } | null;
    emergencyContact?: { name?: string; phone?: string } | null;
    department?: string | null;
    designation?: string | null;
    joiningDate?: string | null;
    reportingManager?: string | null;
    internship?: { startDate?: string; mentor?: string | null; stipend?: { eligible: boolean } } | null;
  };
  /** Categories of the person's current documents (flat document list). */
  documentCategories: string[];
  education: { level: string; qualification: string; certificates: number }[];
  bank: { primary: boolean; hasProof: boolean }[];
}

const has = (v: string | null | undefined) => Boolean(v?.trim());

/**
 * Every item weighs the same. Documents count only the categories required for the person type; education and bank proofs
 * are measured by their own sections. Unpaid interns (no stipend) are not asked for bank details.
 */
export function profileCompletion(facts: CompletionFacts, categories: DocumentCategory[]): ProfileCompletion {
  const p = facts.person;
  const internLike = p.personType === "intern" || p.personType === "trainee";
  const present = new Set(facts.documentCategories);
  const salary = facts.bank.find((b) => b.primary);

  const sections: Omit<CompletionSection, "done" | "total">[] = [
    {
      key: "personal",
      label: "Personal & contact",
      items: [
        { label: "Profile photo", done: has(p.photo) },
        { label: "Phone", done: has(p.phone) },
        { label: "WhatsApp", done: has(p.whatsapp) },
        { label: "Personal email", done: has(p.personalEmail) },
        { label: "Date of birth", done: has(p.dob) },
        { label: "Gender", done: has(p.gender) },
        { label: "Blood group", done: has(p.bloodGroup) },
        { label: "Address", done: has(p.address?.line1) && has(p.address?.city) },
        { label: "Emergency contact", done: has(p.emergencyContact?.name) && has(p.emergencyContact?.phone) },
      ],
    },
    {
      key: "employment",
      label: "Employment",
      items: [
        { label: "Department", done: has(p.department) },
        { label: "Designation", done: has(p.designation) },
        { label: "Joining date", done: has(p.joiningDate) || has(p.internship?.startDate) },
        internLike ? { label: "Mentor or reporting manager", done: has(p.internship?.mentor) || has(p.reportingManager) } : { label: "Reporting manager", done: has(p.reportingManager) },
      ],
    },
    {
      key: "documents",
      label: "Required documents",
      items: categoriesFor(categories, p.personType)
        .filter((c) => c.required && c.key !== EDUCATION_CATEGORY && c.key !== BANK_CATEGORY)
        .map((c) => ({ label: c.label, done: present.has(c.key) })),
    },
    {
      key: "education",
      label: "Education",
      items: [
        { label: "Qualifications", done: facts.education.length > 0 },
        ...facts.education.map((e) => ({ label: `${educationLevelLabel(e.level, true)} certificate (${e.qualification})`, done: e.certificates > 0 })),
      ],
    },
    ...(p.personType !== "intern" || p.internship?.stipend?.eligible
      ? [
          {
            key: "bank" as const,
            label: "Bank details",
            items: [
              { label: "Salary account details", done: Boolean(salary) },
              { label: "Passbook or cancelled cheque", done: Boolean(salary?.hasProof) },
            ],
          },
        ]
      : []),
  ];

  const counted = sections
    .filter((s) => s.items.length > 0)
    .map((s) => ({ ...s, done: s.items.filter((i) => i.done).length, total: s.items.length }));
  const done = counted.reduce((n, s) => n + s.done, 0);
  const total = counted.reduce((n, s) => n + s.total, 0);
  return { pct: total ? Math.floor((done * 100) / total) : 100, done, total, sections: counted };
}
