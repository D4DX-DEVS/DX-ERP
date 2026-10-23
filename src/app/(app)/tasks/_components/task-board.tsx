"use client";

import { useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import type { StatusOption } from "@/lib/config-defaults";
import { TONE_CLASSES } from "@/lib/status";
import { AvatarStack } from "@/components/ui/avatar";
import { StatusChip, Tag } from "@/components/ui/chip";
import { useConfirm } from "@/components/ui/confirm";
import { changeTaskStatus } from "../actions";
import { BlockedNote, choicesFor, DueLabel } from "./task-bits";
import { TaskStatusMenu } from "./task-status-menu";
import type { TaskRow } from "./task-rows";

export interface BoardColumn {
  status: StatusOption;
  rows: TaskRow[];
  total: number;
}

/** An optimistic move: shown at once, kept until fresh server data confirms it (or reverted on error). */
type Moves = Record<string, { to: string; settled: boolean }>;

interface DragState {
  id: string;
  taskNo: string;
  from: string;
  allowed: string[];
}

function without(moves: Moves, id: string): Moves {
  const next = { ...moves };
  delete next[id];
  return next;
}

/**
 * Kanban board: one column per configured task status. Drag a card onto another column to change its
 * status (desktop); the status menu on each card does the same on touch screens and from the keyboard.
 * Moves follow the same rules as the menu — only statuses the viewer may set accept the drop, and the
 * server re-checks everything (reviews, dependencies, permissions).
 */
export function TaskBoard({ columns, statuses, showProject = true }: { columns: BoardColumn[]; statuses: StatusOption[]; showProject?: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [moves, setMoves] = useState<Moves>({});
  const [drag, setDrag] = useState<DragState | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // The drag state is set one frame after dragstart; a drag that ends sooner must cancel it.
  const pendingFrame = useRef<number | null>(null);
  const endDrag = () => {
    if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current);
    pendingFrame.current = null;
    setDrag(null);
    setOver(null);
  };

  // New server data (after router.refresh) supersedes the optimistic moves it has confirmed.
  const [seen, setSeen] = useState(columns);
  if (seen !== columns) {
    setSeen(columns);
    setMoves((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => !v.settled)));
  }

  // Board as displayed: server columns with optimistic moves applied (moved cards go to the top).
  const movedIn = new Map<string, TaskRow[]>();
  for (const col of columns) {
    for (const row of col.rows) {
      const move = moves[row.id];
      if (move && move.to !== col.status.key) movedIn.set(move.to, [...(movedIn.get(move.to) ?? []), { ...row, status: move.to }]);
    }
  }
  const view = columns.map((col) => {
    const staying = col.rows.filter((r) => !moves[r.id] || moves[r.id].to === col.status.key);
    const incoming = movedIn.get(col.status.key) ?? [];
    return { ...col, rows: [...incoming, ...staying], total: col.total - (col.rows.length - staying.length) + incoming.length };
  });
  const anyDraggable = columns.some((c) => c.rows.some((r) => r.allowedStatuses.length > 0));

  const canDrop = (key: string) => Boolean(drag && drag.from !== key && drag.allowed.includes(key));

  async function move(d: DragState, target: StatusOption) {
    if (target.category === "cancelled") {
      const ok = await confirm({
        title: `Mark ${d.taskNo} ${target.label.toLowerCase()}?`,
        description: "The task is closed and no longer counts as open work. You can reopen it later by changing its status.",
        confirmLabel: target.label,
        tone: "danger",
      });
      if (!ok) return;
    }
    setMoves((m) => ({ ...m, [d.id]: { to: target.key, settled: false } }));
    let error: string | null = null;
    try {
      const res = await changeTaskStatus(d.id, target.key);
      if (!res.ok) error = res.error;
    } catch {
      error = "Could not reach the server. Check your connection and try again.";
    }
    if (error) {
      setMoves((m) => without(m, d.id));
      toast.error(error);
      return;
    }
    setMoves((m) => ({ ...m, [d.id]: { to: target.key, settled: true } }));
    toast.success(`${d.taskNo} moved to ${target.label}`);
    router.refresh();
  }

  const onDrop = (e: DragEvent, target: StatusOption) => {
    e.preventDefault();
    const d = drag;
    endDrag();
    if (d && d.from !== target.key && d.allowed.includes(target.key)) void move(d, target);
  };

  return (
    <div className="flex flex-col gap-2">
      {anyDraggable && <p className="hidden text-xs text-muted md:block">Drag a card to another column to change its status.</p>}
      {/* Never scrolls sideways: status columns wrap into a grid (1 / 2 / 3 per row) and share one row from xl (1280px). */}
      <div>
        <div className="grid grid-cols-1 items-start gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 xl:flex xl:gap-2.5">
          {view.map((col) => {
            const key = col.status.key;
            const droppable = canDrop(key);
            const isOver = over === key && droppable;
            return (
              <section
                key={key}
                aria-label={col.status.label}
                onDragOver={(e) => {
                  if (!drag) return;
                  if (droppable) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  } else {
                    e.dataTransfer.dropEffect = "none";
                  }
                  if (over !== key) setOver(key);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === key ? null : o));
                }}
                onDrop={(e) => onDrop(e, col.status)}
                className={cn(
                  "flex min-w-0 flex-col gap-2 rounded-[14px] bg-[#ebeef5] p-2.5 transition-[background-color,opacity] sm:min-h-24 sm:gap-2.5 sm:p-3 xl:flex-1 xl:basis-0 xl:gap-2 xl:p-2",
                  isOver && "bg-brand-50",
                  drag && !droppable && drag.from !== key && "opacity-50",
                )}
              >
                <div className="flex items-center gap-2 px-1 py-0.5">
                  <span className={cn("size-2.5 rounded-full", TONE_CLASSES[col.status.tone].dot)} aria-hidden />
                  <h2 className="font-sans text-sm font-semibold">{col.status.label}</h2>
                  <span className="text-xs font-semibold text-muted tabular">{col.total}</span>
                </div>
                {isOver && (
                  <div className="flex h-14 items-center justify-center rounded-xl border-2 border-dashed border-brand-400 bg-white/60 text-xs font-semibold text-brand-600">
                    Move to {col.status.label}
                  </div>
                )}
                {col.rows.length === 0 && !isOver && <p className="px-1 py-3 text-center text-xs text-muted">{drag && droppable ? "Drop here" : "No tasks"}</p>}
                {col.rows.map((r) => {
                  const { current, choices } = choicesFor(r, statuses);
                  const draggable = r.allowedStatuses.length > 0;
                  const saving = moves[r.id] && !moves[r.id].settled;
                  return (
                    <article
                      key={r.id}
                      draggable={draggable}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", r.id);
                        // Defer the re-render so the browser has captured the drag image first.
                        const state = { id: r.id, taskNo: r.taskNo, from: key, allowed: r.allowedStatuses };
                        pendingFrame.current = requestAnimationFrame(() => {
                          pendingFrame.current = null;
                          setDrag(state);
                        });
                      }}
                      onDragEnd={endDrag}
                      aria-busy={saving || undefined}
                      title={draggable ? "Drag to another column to change the status" : undefined}
                      className={cn(
                        "group relative flex flex-col gap-1.5 rounded-xl border border-line bg-white p-2.5 shadow-[0_1px_2px_rgba(16,24,58,0.04)] transition-opacity sm:gap-2 sm:p-3",
                        draggable && "cursor-grab active:cursor-grabbing hover:border-brand-200",
                        drag?.id === r.id && "opacity-40",
                        saving && "opacity-70",
                      )}
                    >
                      {draggable && <GripVertical className="absolute top-3 -left-0.5 size-3.5 text-subtle opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />}
                      <Link href={`/tasks/${r.id}`} draggable={false} className="flex flex-col gap-2 hover:[&_.title]:text-brand-600">
                        <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                          <span className="font-mono text-[11px] text-muted">{r.taskNo}</span>
                          <StatusChip domain="priority" value={r.priority} size="sm" />
                        </span>
                        <span className="title text-[13px] leading-snug font-semibold break-words text-ink sm:text-sm">{r.title}</span>
                        {showProject && r.projectTitle && <span className="truncate text-xs text-muted">{r.projectTitle}</span>}
                        <BlockedNote row={r} />
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                          {r.assignees.length > 0 && <AvatarStack people={r.assignees} max={3} />}
                          {r.assignees.some((a) => a.intern) && <Tag tone="purple">INTERN</Tag>}
                          <span className="flex-1" />
                          {r.subtasks.total > 0 && (
                            <span className="tabular">
                              {r.subtasks.done}/{r.subtasks.total}
                            </span>
                          )}
                          <DueLabel row={r} className="font-semibold whitespace-nowrap" />
                        </span>
                      </Link>
                      <div className="border-t border-line-soft pt-2">
                        <TaskStatusMenu taskId={r.id} current={current} choices={choices} size="sm" />
                      </div>
                    </article>
                  );
                })}
                {col.total > col.rows.length && <p className="px-1 text-center text-xs text-muted">Showing {col.rows.length} of {col.total}</p>}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
