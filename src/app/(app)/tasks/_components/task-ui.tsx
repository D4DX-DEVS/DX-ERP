import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { AvatarStack } from "@/components/ui/avatar";
import { StatusChip, Tag } from "@/components/ui/chip";
import { Progress } from "@/components/ui/page";
import { EmptyRow, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import type { StatusOption } from "@/lib/config-defaults";
import { BlockedNote, choicesFor, DueLabel } from "./task-bits";
import { TaskStatusMenu } from "./task-status-menu";
import type { TaskRow } from "./task-rows";

export { DueLabel } from "./task-bits";
export { TaskBoard, type BoardColumn } from "./task-board";

export function TaskTable({ rows, statuses, showProject = true, empty = "No tasks match these filters." }: { rows: TaskRow[]; statuses: StatusOption[]; showProject?: boolean; empty?: string }) {
  return (
    <TableWrap phone={[1, 6]} tablet={[1, 2, 4, 6]}>
      <THead>
        <Th>Task</Th>
        <Th>Assignee</Th>
        <Th>Priority</Th>
        <Th>Due</Th>
        <Th className="w-36">Progress</Th>
        <Th>Status</Th>
      </THead>
      <tbody>
        {rows.length === 0 && <EmptyRow colSpan={6}>{empty}</EmptyRow>}
        {rows.map((r) => {
          const { current, choices } = choicesFor(r, statuses);
          return (
            <Tr key={r.id}>
              <Td className="max-w-[380px]">
                <Link href={`/tasks/${r.id}`} className="block min-w-0 hover:text-brand-600">
                  <span className="flex items-center gap-2 font-semibold">
                    <span className="truncate">{r.title}</span>
                    {r.isLearning && (
                      <Tag tone="purple" className="shrink-0">
                        <GraduationCap className="mr-1 size-3" aria-hidden />
                        Learning
                      </Tag>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {r.taskNo}
                    {showProject && r.projectTitle ? ` · ${r.projectNo} ${r.projectTitle}` : ""}
                    {r.subtasks.total > 0 ? ` · ${r.subtasks.done}/${r.subtasks.total} subtasks` : ""}
                  </span>
                </Link>
                <BlockedNote row={r} />
              </Td>
              <Td>
                {r.assignees.length === 0 ? (
                  <span className="text-muted">Unassigned</span>
                ) : (
                  <span className="flex items-center gap-2">
                    <AvatarStack people={r.assignees} max={3} />
                    {r.assignees.length === 1 && <span className="max-w-32 truncate text-[13px]">{r.assignees[0].name}</span>}
                  </span>
                )}
              </Td>
              <Td>
                <StatusChip domain="priority" value={r.priority} />
              </Td>
              <Td className="whitespace-nowrap">
                <DueLabel row={r} />
              </Td>
              <Td>
                <div className="flex items-center gap-2">
                  <Progress value={r.progress} size="sm" tone={r.daysLate > 0 ? "orange" : "brand"} />
                  <span className="w-9 text-right text-xs text-muted tabular">{r.progress}%</span>
                </div>
              </Td>
              <Td>
                <TaskStatusMenu taskId={r.id} current={current} choices={choices} />
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </TableWrap>
  );
}
