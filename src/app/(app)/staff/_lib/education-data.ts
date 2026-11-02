import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { Education } from "@/lib/models";
import { educationSortKey } from "./education";

/** Plain view model of one qualification (safe to pass to client components). */
export interface EducationView {
  id: string;
  level: string;
  qualification: string;
  institution?: string;
  board?: string;
  startYear?: number;
  endYear?: number;
  score?: string;
  status: "completed" | "pursuing";
  certificates: { id: string; type: string; file: string; name: string; size?: number; note?: string; uploadedAt: string; uploadedByName?: string; mine: boolean }[];
}

/** A person's qualifications, SSLC first, with their certificates. `viewerId` marks the viewer's own uploads. */
export async function loadEducation(personId: string, viewerId: string): Promise<EducationView[]> {
  const rows = await db().select().from(Education).where(eq(Education.user, personId));
  return rows
    .sort((a, b) => educationSortKey(a.level, a.endYear) - educationSortKey(b.level, b.endYear))
    .map((r) => ({
      id: r._id,
      level: r.level,
      qualification: r.qualification,
      institution: r.institution ?? undefined,
      board: r.board ?? undefined,
      startYear: r.startYear ?? undefined,
      endYear: r.endYear ?? undefined,
      score: r.score ?? undefined,
      status: r.status,
      certificates: r.certificates.map((c) => ({
        id: c._id,
        type: c.type,
        file: c.file,
        name: c.name,
        size: c.size,
        note: c.note,
        uploadedAt: new Date(c.uploadedAt).toISOString(),
        uploadedByName: c.uploadedByName,
        mine: c.uploadedBy === viewerId,
      })),
    }));
}
