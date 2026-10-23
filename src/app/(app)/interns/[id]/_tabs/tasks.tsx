import Link from "next/link";
import { ListChecks } from "lucide-react";
import { connectDB } from "@/lib/db";
import { Project, Task } from "@/lib/models";
import { fmtDate } from "@/lib/time";
import { Card, CardHeader } from "@/components/ui/card";
import { OptionChip, StatusChip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/page";
import { EmptyRow, Td, Th, THead, TableWrap, Tr } from "@/components/ui/table";
import type { InternTabProps } from "./types";

/** Tasks assigned to the intern with their latest submission's review status. */
export async function TasksTab({ target, settings, today }: InternTabProps) {
  await connectDB();
  const id = target._id.toString();
  const tasks = await Task.find({ assignees: target._id }, { taskNo: 1, title: 1, project: 1, status: 1, dueDate: 1, submissions: 1 }).sort({ dueDate: 1, createdAt: -1 }).limit(100).lean();
  const projectIds = tasks.flatMap((t) => (t.project ? [t.project] : []));
  const projects = await Project.find({ _id: { $in: projectIds } }, { title: 1 }).lean();
  const projectName = new Map(projects.map((p) => [p._id.toString(), p.title]));
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
            const latest = [...(t.submissions ?? [])].reverse().find((s) => s.submittedBy.toString() === id);
            const overdue = t.dueDate && t.dueDate < today && !closed.has(t.status);
            return (
              <Tr key={t._id.toString()}>
                <Td>
                  <Link href={`/tasks/${t._id}`} className="block font-semibold text-ink hover:text-brand-600">
                    {t.title}
                  </Link>
                  <span className="text-xs text-muted">{t.taskNo}</span>
                </Td>
                <Td className="text-ink-2">{t.project ? (projectName.get(t.project.toString()) ?? "—") : "—"}</Td>
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
