import "server-only";
import { connectDB } from "@/lib/db";
import { Attendance, Holiday, LeaveRequest, Movement } from "@/lib/models";
import { fmtTime, todayKey } from "@/lib/time";
import type { Presence } from "@/components/shell/types";

/** Today's presence pill for the top bar (in office / out on a movement / not checked in …). */
export async function presenceFor(userId: string): Promise<Presence> {
  await connectDB();
  const today = todayKey();
  const [att, openMove, leave, holiday] = await Promise.all([
    Attendance.findOne({ user: userId, date: today }, { checkIn: 1, checkOut: 1, status: 1 }).lean(),
    Movement.findOne({ user: userId, status: "out" }, { categoryLabel: 1, outTime: 1 }).sort({ outTime: -1 }).lean(),
    LeaveRequest.exists({ user: userId, status: "approved", startDate: { $lte: today }, endDate: { $gte: today }, halfDay: false }),
    Holiday.exists({ date: today, optional: false }),
  ]);
  if (openMove) return { state: "out", label: `Out · ${openMove.categoryLabel} since ${fmtTime(openMove.outTime)}` };
  if (att?.checkIn && !att.checkOut) return { state: "in", label: `In office · since ${fmtTime(att.checkIn)}` };
  if (att?.checkOut) return { state: "checked_out", label: `Checked out ${fmtTime(att.checkOut)}` };
  if (leave) return { state: "leave", label: "On leave today" };
  if (holiday) return { state: "holiday", label: "Holiday" };
  return { state: "not_in", label: "Not checked in" };
}
