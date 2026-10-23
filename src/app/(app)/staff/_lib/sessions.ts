import "server-only";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { Session, type Id } from "@/lib/models";
import { fmtDateTime, timeAgo } from "@/lib/time";
import type { SessionRow } from "../_components/session-list";
import { describeAgent } from "./agent";

/** Active (not revoked, not expired) sessions of a user, formatted for display. */
export async function loadSessions(userId: Id, currentSid?: string): Promise<SessionRow[]> {
  const rows = await db()
    .select()
    .from(Session)
    .where(and(eq(Session.user, userId), isNull(Session.revokedAt), gt(Session.expiresAt, new Date())))
    .orderBy(desc(Session.lastSeenAt))
    .limit(25);
  return rows.map((s) => ({
    id: s._id,
    device: describeAgent(s.userAgent),
    ip: s.ip ?? undefined,
    method: s.method,
    signedIn: fmtDateTime(s.createdAt),
    lastActive: timeAgo(s.lastSeenAt),
    current: Boolean(currentSid) && s.sid === currentSid,
  }));
}
