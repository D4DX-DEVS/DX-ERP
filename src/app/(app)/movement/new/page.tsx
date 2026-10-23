import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, redirect } from "next/navigation";
import { and, asc, desc, eq, gte, or } from "drizzle-orm";
import { can, isStaff, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Attendance, Client, Movement, Project, User } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { peopleOptions } from "@/lib/people";
import { param, type SearchParams } from "@/lib/query";
import { notInList } from "@/lib/sql";
import { projectFilter } from "@/lib/work-access";
import { fmtDate, fmtLongDate, fmtTime, formatDuration, todayKey, weekStart } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/ui/page";
import { StatusChip } from "@/components/ui/chip";
import { buttonClass } from "@/components/ui/button";
import { MovementForm } from "../movement-form";

export const metadata: Metadata = { title: "Record movement" };

export default async function NewMovementPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const mode = param(sp, "mode") === "late" ? "late" : "live";
  const canManage = can(user, "movement.manage");
  const staff = isStaff(user);
  if (!staff && !canManage) forbidden();

  const settings = await getSettings();
  const today = todayKey();

  if (mode === "live" && staff) {
    const [open] = await db().select({ _id: Movement._id }).from(Movement).where(and(eq(Movement.user, user._id), eq(Movement.status, "out"))).limit(1);
    if (open) redirect(`/movement/${open._id}`);
  }

  const doneStatuses = settings.projectStatuses.filter((s) => s.category === "completed" || s.category === "cancelled").map((s) => s.key);

  const [projects, clients, people, me, [attToday], recent] = await Promise.all([
    db()
      .select({ _id: Project._id, projectNo: Project.projectNo, title: Project.title })
      .from(Project)
      .where(and(projectFilter(user), notInList(Project.status, doneStatuses)))
      .orderBy(desc(Project.updatedAt))
      .limit(200),
    can(user, "crm.view")
      ? db()
          .select({ _id: Client._id, clientNo: Client.clientNo, name: Client.name })
          .from(Client)
          .where(and(notInList(Client.status, ["lost"]), can(user, "crm.confidential") ? undefined : or(eq(Client.confidential, false), eq(Client.owner, user._id))))
          .orderBy(asc(Client.name))
          .limit(300)
      : Promise.resolve([]),
    canManage ? peopleOptions() : Promise.resolve(undefined),
    db().select({ reportingManager: User.reportingManager }).from(User).where(eq(User._id, user._id)).limit(1),
    staff ? db().select({ checkIn: Attendance.checkIn }).from(Attendance).where(and(eq(Attendance.user, user._id), eq(Attendance.date, today))).limit(1) : Promise.resolve([]),
    staff
      ? db().select().from(Movement).where(and(eq(Movement.user, user._id), gte(Movement.date, weekStart(today)))).orderBy(desc(Movement.outTime)).limit(6)
      : Promise.resolve([]),
  ]);
  const myManager = me[0]?.reportingManager;
  const [manager] = myManager ? await db().select({ name: User.name }).from(User).where(eq(User._id, myManager)).limit(1) : [];
  const weekMinutes = recent.reduce((s, m) => s + (m.durationMinutes ?? 0), 0);

  return (
    <PageBody>
      <PageHeader
        back={{ href: "/movement", label: "Movement register" }}
        title={mode === "live" ? "Going out of the office" : "Late entry"}
        description={
          mode === "live"
            ? "Your Out-Time is recorded the moment you confirm. Record your In-Time when you're back."
            : "Add a movement you couldn't record at the time. It is marked as a late entry and reviewed by your manager."
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardBody className="pt-5">
            <MovementForm
              mode={mode}
              categories={settings.movement.categories.filter((c) => c.active)}
              projects={projects.map((p) => ({ id: p._id, label: `${p.projectNo} · ${p.title}` }))}
              clients={clients.map((c) => ({ id: c._id, label: `${c.clientNo} · ${c.name}` }))}
              people={people?.map((p) => ({ id: p.id, name: p.name, employeeId: p.employeeId, designation: p.designation, photo: p.photo }))}
              personLabel={staff ? `${user.name} · ${user.employeeId}` : "Choose a person"}
              dateLabel={fmtLongDate(new Date())}
              approverName={manager?.name}
              notCheckedIn={staff && !attToday?.checkIn}
              maxLateDays={settings.movement.alternativeEntryMaxDays}
            />
          </CardBody>
        </Card>
        <aside className="flex flex-col gap-5">
          {staff && (
            <Card>
              <CardHeader title="My movements" subtitle={`This week · ${formatDuration(weekMinutes)}`} href="/movement?tab=mine" hrefLabel="History" />
              <CardBody className="flex flex-col divide-y divide-line-soft pt-0">
                {recent.length === 0 && <p className="py-3 text-[13px] text-muted">No movements this week.</p>}
                {recent.map((m) => (
                  <Link key={m._id} href={`/movement/${m._id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-brand-600">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] font-semibold">
                        {m.categoryLabel} · {m.purpose}
                      </span>
                      <span className="text-xs text-muted">
                        {fmtDate(m.date, "EEE d")} · {fmtTime(m.outTime)} – {m.inTime ? fmtTime(m.inTime) : "…"}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <span className="text-[13px] font-semibold tabular">{m.durationMinutes != null ? formatDuration(m.durationMinutes) : "Open"}</span>
                      <StatusChip domain={m.approvalStatus === "not_required" ? "movement" : "movementApproval"} value={m.approvalStatus === "not_required" ? m.status : m.approvalStatus} size="sm" />
                    </span>
                  </Link>
                ))}
              </CardBody>
            </Card>
          )}
          {mode === "live" && (
            <Card>
              <CardBody className="flex flex-col gap-2 pt-5">
                <h2 className="font-display text-[17px] font-semibold">Forgot to record?</h2>
                <p className="text-[13px] leading-relaxed text-muted">
                  Add a past movement or fix a time. It is marked as a late entry, needs a reason and goes to {manager?.name ?? "your approver"} for approval. Original times are kept.
                </p>
                <Link href="/movement/new?mode=late" className={buttonClass("secondary", "md", "mt-1 self-start")}>
                  Add late entry
                </Link>
              </CardBody>
            </Card>
          )}
        </aside>
      </div>
    </PageBody>
  );
}
