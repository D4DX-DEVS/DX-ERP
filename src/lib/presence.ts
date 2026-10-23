import "server-only";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { Attendance, Holiday, LeaveRequest, Movement } from "@/lib/models";
import { fmtTime, todayKey } from "@/lib/time";
import type { Presence } from "@/components/shell/types";

/** Today's presence pill for the top bar (in office / out on a movement / not checked in …). */
export async function presenceFor(userId: string): Promise<Presence> {
  const today = todayKey();
  const [[att], [openMove], [leave], [holiday]] = await Promise.all([
    db()
      .select({ checkIn: Attendance.checkIn, checkOut: Attendance.checkOut, status: Attendance.status })
      .from(Attendance)
      .where(and(eq(Attendance.user, userId), eq(Attendance.date, today)))
      .limit(1),
    db()
      .select({ categoryLabel: Movement.categoryLabel, outTime: Movement.outTime })
      .from(Movement)
      .where(and(eq(Movement.user, userId), eq(Movement.status, "out")))
      .orderBy(desc(Movement.outTime))
      .limit(1),
    db()
      .select({ id: LeaveRequest._id })
      .from(LeaveRequest)
      .where(
        and(
          eq(LeaveRequest.user, userId),
          eq(LeaveRequest.status, "approved"),
          lte(LeaveRequest.startDate, today),
          gte(LeaveRequest.endDate, today),
          eq(LeaveRequest.halfDay, false),
        ),
      )
      .limit(1),
    db()
      .select({ id: Holiday._id })
      .from(Holiday)
      .where(and(eq(Holiday.date, today), eq(Holiday.optional, false)))
      .limit(1),
  ]);
  if (openMove) return { state: "out", label: `Out · ${openMove.categoryLabel} since ${fmtTime(openMove.outTime)}` };
  if (att?.checkIn && !att.checkOut) return { state: "in", label: `In office · since ${fmtTime(att.checkIn)}` };
  if (att?.checkOut) return { state: "checked_out", label: `Checked out ${fmtTime(att.checkOut)}` };
  if (leave) return { state: "leave", label: "On leave today" };
  if (holiday) return { state: "holiday", label: "Holiday" };
  return { state: "not_in", label: "Not checked in" };
}
