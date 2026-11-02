import Link from "next/link";
import { ArrowRight, UserRoundPen } from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { User } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { Progress } from "@/components/ui/page";
import { loadProfileCompletion } from "@/app/(app)/staff/_lib/completion-data";

const listOf = (items: string[], max = 4) => `${items.slice(0, max).join(" · ")}${items.length > max ? ` and ${items.length - max} more` : ""}`;

/**
 * Shown on a staff member's dashboard until their profile is complete: how far along it is, what is missing, and a
 * link to the checklist on My profile. Employment details are HR's to fill in, so they are called out separately.
 */
export async function ProfileCompletionNudge({ userId }: { userId: string }) {
  const [me] = await db()
    .select({
      _id: User._id,
      personType: User.personType,
      photo: User.photo,
      phone: User.phone,
      whatsapp: User.whatsapp,
      personalEmail: User.personalEmail,
      dob: User.dob,
      gender: User.gender,
      bloodGroup: User.bloodGroup,
      address: User.address,
      emergencyContact: User.emergencyContact,
      department: User.department,
      designation: User.designation,
      joiningDate: User.joiningDate,
      reportingManager: User.reportingManager,
      internship: User.internship,
    })
    .from(User)
    .where(eq(User._id, userId))
    .limit(1);
  if (!me) return null;
  const completion = await loadProfileCompletion(me, await getSettings());
  if (completion.pct >= 100) return null;

  const missingIn = (hr: boolean) => completion.sections.filter((s) => (s.key === "employment") === hr).flatMap((s) => s.items.filter((i) => !i.done).map((i) => i.label));
  const yours = missingIn(false);
  const hr = missingIn(true);

  return (
    <Link
      href="/profile#completion"
      className="group flex flex-col gap-3 rounded-[14px] border border-[#f1d9ac] bg-warning-bg/60 p-4 transition-colors hover:border-warning/50 hover:bg-warning-bg sm:flex-row sm:items-center sm:gap-5 sm:p-5"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white text-warning shadow-sm" aria-hidden>
        <UserRoundPen className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="font-display text-[15px] font-semibold text-ink">{yours.length ? "Complete your profile" : "Your part of the profile is done"}</span>
          <span className="text-[13px] font-semibold text-ink tabular">
            {completion.pct}% <span className="font-medium text-muted">· {completion.done} of {completion.total} items</span>
          </span>
        </span>
        <Progress value={completion.pct} tone={completion.pct >= 60 ? "brand" : "orange"} />
        <span className="text-xs break-words text-ink-2">
          {yours.length > 0 ? `Missing: ${listOf(yours)}` : `HR still needs to add: ${listOf(hr)}`}
          {yours.length > 0 && hr.length > 0 ? ` · HR adds your ${listOf(hr, 2).toLowerCase()}` : ""}
        </span>
      </span>
      {yours.length > 0 && (
        <span className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-[10px] bg-brand-600 px-3.5 text-[13px] font-semibold text-white group-hover:bg-brand-700 sm:self-center">
          Finish profile
          <ArrowRight className="size-4" aria-hidden />
        </span>
      )}
    </Link>
  );
}
