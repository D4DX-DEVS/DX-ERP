import Link from "next/link";
import { ListChecks } from "lucide-react";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { Project, Task } from "@/lib/models";
import { jsonHas } from "@/lib/sql";
import { fmtDate } from "@/lib/time";
import { Card, CardHeader } from "@/components/ui/card";
import { OptionChip, StatusChip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/page";
import { EmptyRow, Td, Th, THead, TableWrap, Tr } from "@/components/ui/table";
import type { InternTabProps } from "./types";

/** Tasks assigned to the intern with their latest submission's review status. */
export async function TasksTab({ target, settings, today }: InternTabProps) {
  const id = target._id;
  const tasks = await db()
    .select({
      _id: Task._id,
      taskNo: Task.taskNo,
      title: Task.title,
      project: Task.project,
      projectTitle: Project.title,
      status: Task.status,
      dueDate: Task.dueDate,
      submissions: Task.submissions,
    })
    .from(Task)
    .leftJoin(Project, eq(Project._id, Task.project))
    .where(jsonHas(Task.assignees, target._id))
    .orderBy(asc(Task.dueDate), desc(Task.createdAt))
    .limit(100);
  const closed = new Set(settings.taskStatuses.filter((s) => s.category === "done" || s.category === "cancelled").map((s) => s.key));

  return (
    <Card>
      <CardHeader title="Tasks & submissions" subtitle={`${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} assigned`} />
      <TableWrap phone={[1, 3]} tablet={[1, 3, 4, 5]}>
        <THead>
          <Th>Task</Th>
          <Th>Project</Th>
          <Th>Status</Th>
          <Th>Due</Th>
          <Th>Latest submission</Th>
        </THead>
        <tbody>
          {tasks.length === 0 && (
            <EmptyRow colSpan={5}>
              <EmptyState icon={<ListChecks className="size-5" />} title="No tasks assigned yet" description="Tasks assigned to this person appear here with the review status of their submissions." />
            </EmptyRow>
          )}
          {tasks.map((t) => {
            const latest = [...(t.submissions ?? [])].reverse().find((s) => s.submittedBy === id);
            const overdue = t.dueDate && t.dueDate < today && !closed.has(t.status);
            return (
              <Tr key={t._id}>
                <Td>
                  <Link href={`/tasks/${t._id}`} className="block font-semibold text-ink hover:text-brand-600">
                    {t.title}
                  </Link>
                  <span className="text-xs text-muted">{t.taskNo}</span>
                </Td>
                <Td className="text-ink-2">{t.project ? (t.projectTitle ?? "—") : "—"}</Td>
                <Td>
                  <OptionChip options={settings.taskStatuses} value={t.status} />
                </Td>
                <Td className={overdue ? "font-semibold whitespace-nowrap text-danger" : "whitespace-nowrap text-ink-2"}>
                  {fmtDate(t.dueDate)}
                  {overdue ? " · overdue" : ""}
                </Td>
                <Td>
                  {latest ? (
                    <span className="flex flex-col items-start gap-0.5">
                      <StatusChip domain="submission" value={latest.reviewStatus} size="sm" />
                      <span className="text-xs text-muted">Submitted {fmtDate(latest.submittedAt)}</span>
                    </span>
                  ) : (
                    <span className="text-muted">Not submitted</span>
                  )}
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </TableWrap>
    </Card>
  );
}
