import Link from "next/link";
import { LogOut } from "lucide-react";
import { connectDB } from "@/lib/db";
import { Movement } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { displayStatus } from "@/lib/movement/access";
import { fmtDate, fmtTime, formatDuration, todayKey } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/chip";
import { buttonClass } from "@/components/ui/button";
import { ElapsedTimer, ExtendReturnDialog, RecordInButton } from "./movement-controls";

/**
 * The signed-in person's current movement (FRS §4.2 "current movement status"): live timer with
 * Record In-Time when out, otherwise today's total time outside and a "Record movement" action.
 */
export async function CurrentMovementCard({ userId }: { userId: string }) {
  await connectDB();
  const [settings, open, todays] = await Promise.all([
    getSettings(),
    Movement.findOne({ user: userId, status: "out" }).sort({ outTime: -1 }).lean(),
    Movement.find({ user: userId, date: todayKey(), status: "returned" }, { durationMinutes: 1, official: 1 }).lean(),
  ]);

  if (open && open.outTime) {
    const status = displayStatus(open, settings, todayKey());
    return (
      <Card className="border-[#fcd3bd]">
        <CardHeader title="Current movement" action={<StatusChip domain="movement" value={status} />} />
        <CardBody className="flex flex-col gap-3">
          <div className="text-[13px] text-ink-2">
            <span className="font-semibold text-ink">{open.categoryLabel}</span> · {open.purpose}
            <div className="text-xs text-muted">
              {open.movementNo} · out {fmtTime(open.outTime)}
              {open.date !== todayKey() ? ` on ${fmtDate(open.date)}` : ""}
              {open.expectedReturn ? ` · back by ${fmtTime(open.expectedReturn)}` : ""}
            </div>
          </div>
          <ElapsedTimer outTime={open.outTime.toISOString()} expectedReturn={open.expectedReturn?.toISOString()} />
          <div className="flex flex-wrap gap-2">
            <RecordInButton id={open._id.toString()} />
            <ExtendReturnDialog id={open._id.toString()} current={open.expectedReturn?.toISOString()} />
          </div>
        </CardBody>
      </Card>
    );
  }

  const official = todays.filter((m) => m.official).reduce((s, m) => s + (m.durationMinutes ?? 0), 0);
  const personal = todays.filter((m) => !m.official).reduce((s, m) => s + (m.durationMinutes ?? 0), 0);
  return (
    <Card>
      <CardHeader title="Movement" href="/movement?tab=mine" hrefLabel="History" />
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-success-bg text-success">
            <LogOut className="size-5 rotate-180" />
          </span>
          <div className="text-[13px]">
            <div className="font-semibold text-ink">In the office</div>
            <div className="text-muted">
              {todays.length === 0
                ? "No movements today"
                : `${todays.length} movement${todays.length === 1 ? "" : "s"} today · official ${formatDuration(official)} · personal ${formatDuration(personal)}`}
            </div>
          </div>
        </div>
        <Link href="/movement/new" className={buttonClass("secondary", "md", "self-start")}>
          <LogOut className="size-4" />
          Record movement out
        </Link>
      </CardBody>
    </Card>
  );
}
