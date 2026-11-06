import { getSettings } from "@/lib/settings";
import { CheckInOutButton } from "./_components/today-actions";
import { loadToday, todayState } from "./_lib/today";

/** Dashboard header quick action: check in / check out without opening the Today card. */
export async function TodayCheckButton({ userId }: { userId: string }) {
  // A failed lookup only hides the shortcut; the Today card reports its own errors.
  const [settings, t] = await Promise.all([getSettings(), loadToday(userId)]).catch(() => [null, null] as const);
  if (!settings || !t) return null;
  const { state } = todayState(t, settings);
  return <CheckInOutButton state={state} openMovementId={t.openMovement?._id} qr={settings.attendance.qrCheckIn} />;
}
