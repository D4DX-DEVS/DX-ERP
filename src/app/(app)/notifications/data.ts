import "server-only";
import { and, desc, eq, gte, isNull, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { Announcement } from "@/lib/models";
import type { CurrentUser } from "@/lib/auth/session";
import { PERSON_TYPES } from "@/lib/models";
import { ROLE_LABELS } from "@/lib/rbac/permissions";
import { jsonHasAny } from "@/lib/sql";
import { titleCase } from "@/lib/format";

export interface AnnouncementView {
  id: string;
  title: string;
  body: string;
  audience: string;
  pinned: boolean;
  expired: boolean;
  expiresOn?: string;
  publishedByName: string;
  createdAt: Date;
}

/** Announcements aimed at this person (everyone, their role or their person type) that have not expired. */
export function announcementFilter(user: Pick<CurrentUser, "role" | "personType">, today: string): SQL {
  return and(
    jsonHasAny(Announcement.audience, ["all", user.role, user.personType]),
    or(isNull(Announcement.expiresOn), eq(Announcement.expiresOn, ""), gte(Announcement.expiresOn, today)),
  )!;
}

export function audienceLabel(audience: string[]): string {
  if (audience.length === 0 || audience.includes("all")) return "Everyone";
  return audience.map((a) => (PERSON_TYPES.includes(a as (typeof PERSON_TYPES)[number]) ? `${titleCase(a)}s` : (ROLE_LABELS[a] ?? titleCase(a)))).join(", ");
}

/**
 * Announcements for the notifications panel and dashboard, pinned first. Managers see every
 * announcement (including other audiences and expired ones); everyone else sees only their own.
 */
export async function loadAnnouncements(user: CurrentUser, today: string, opts: { limit: number; all?: boolean }): Promise<AnnouncementView[]> {
  const docs = await db()
    .select()
    .from(Announcement)
    .where(opts.all ? undefined : announcementFilter(user, today))
    .orderBy(desc(Announcement.pinned), desc(Announcement.createdAt))
    .limit(opts.limit);
  return docs.map((a) => ({
    id: a._id,
    title: a.title,
    body: a.body,
    audience: audienceLabel(a.audience),
    pinned: a.pinned,
    expired: Boolean(a.expiresOn && a.expiresOn < today),
    expiresOn: a.expiresOn || undefined,
    publishedByName: a.publishedByName ?? "",
    createdAt: a.createdAt,
  }));
}
