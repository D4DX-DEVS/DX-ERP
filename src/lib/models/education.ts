import { index, sqliteTable } from "drizzle-orm/sqlite-core";
import { int, json, pk, ref, text, timestamps, type Id } from "./_base";

/** A certificate file for one qualification (marksheet, provisional, degree certificate, …). */
export interface EducationCertificate {
  _id: Id;
  /** Key from EDUCATION_CERTIFICATE_TYPES (staff/_lib/education.ts). */
  type: string;
  /** StoredFile id (entityType "user", category "education_record"). */
  file: Id;
  name: string;
  size?: number;
  mime?: string;
  note?: string;
  uploadedAt: Date;
  uploadedBy?: Id;
  uploadedByName?: string;
}

/**
 * One qualification of a person (SSLC, higher secondary, diploma, degree, …) with its certificates.
 * Writes must trim the text fields.
 */
export const Education = sqliteTable(
  "education",
  {
    _id: pk(),
    user: ref().notNull(),
    /** Key from EDUCATION_LEVELS (staff/_lib/education.ts). */
    level: text().notNull(),
    /** Course / qualification name, e.g. "B.Tech Computer Science", "Plus Two – Science". */
    qualification: text().notNull(),
    institution: text(),
    /** Board or university. */
    board: text(),
    startYear: int(),
    /** Year of passing (or expected). */
    endYear: int(),
    /** Free text: "86%", "8.2 CGPA", "First class". */
    score: text(),
    status: text().$type<"completed" | "pursuing">().notNull().default("completed"),
    certificates: json<EducationCertificate[]>()
      .notNull()
      .$defaultFn(() => []),
    createdBy: ref(),
    ...timestamps(),
  },
  (t) => [index("education_user").on(t.user)],
);
export type IEducation = typeof Education.$inferSelect;
