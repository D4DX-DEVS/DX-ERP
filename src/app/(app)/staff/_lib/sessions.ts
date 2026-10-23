import "server-only";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Session } from "@/lib/models";
import { fmtDateTime, timeAgo } from "@/lib/time";
import type { SessionRow } from "../_components/session-list";
import { describeAgent } from "./agent";

/** Active (not revoked, not expired) sessions of a user, formatted for display. */
export async function loadSessions(userId: string | Types.ObjectId, currentSid?: string): Promise<SessionRow[]> {
  await connectDB();
  const rows = await Session.find({ user: userId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastSeenAt: -1 })
    .limit(25)
    .lean();
  return rows.map((s) => ({
    id: s._id.toString(),
    device: describeAgent(s.userAgent),
    ip: s.ip,
    method: s.method,
    signedIn: fmtDateTime(s.createdAt),
    lastActive: timeAgo(s.lastSeenAt),
    current: Boolean(currentSid) && s.sid === currentSid,
  }));
}
