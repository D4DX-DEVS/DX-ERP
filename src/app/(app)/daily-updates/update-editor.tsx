"use client";

import { useState, type KeyboardEvent } from "react";
import { FolderKanban, Plus, Trash2, X } from "lucide-react";
import { ActionButton } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton, useFormState } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/input";
import { deleteDailyUpdate, saveDailyUpdate } from "./actions";
import { MAX_POINTS, MAX_PROJECTS, POINT_MAX } from "./limits";

export interface ProjectOption {
  id: string;
  label: string;
}

interface Point {
  key: string;
  text: string;
}

interface Entry {
  project: string;
  points: Point[];
}

const newPoint = (text = ""): Point => ({ key: crypto.randomUUID(), text });

/** Points for one project: one line each, Enter adds the next point. */
function ProjectBlock({
  entry,
  label,
  focusKey,
  onChange,
  onRemove,
  onFocusPoint,
}: {
  entry: Entry;
  label: string;
  focusKey?: string;
  onChange: (points: Point[]) => void;
  onRemove: () => void;
  onFocusPoint: (key: string) => void;
}) {
  const { errors } = useFormState();
  const error = errors[`points.${entry.project}`];
  const addAfter = (index: number) => {
    if (entry.points.length >= MAX_POINTS) return;
    const point = newPoint();
    onChange([...entry.points.slice(0, index + 1), point, ...entry.points.slice(index + 1)]);
    onFocusPoint(point.key);
  };
  const onKeyDown = (index: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      addAfter(index);
    } else if (e.key === "Backspace" && entry.points[index].text === "" && entry.points.length > 1) {
      e.preventDefault();
      const previous = entry.points[index - 1] ?? entry.points[index + 1];
      onChange(entry.points.filter((_, i) => i !== index));
      onFocusPoint(previous.key);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white" data-invalid={error ? "" : undefined}>
      <div className="flex items-center justify-between gap-2 border-b border-line-soft bg-field/60 py-1.5 pr-1.5 pl-3">
        <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-ink">
          <FolderKanban className="size-4 shrink-0 text-brand-600" aria-hidden />
          <span className="break-words">{label}</span>
        </span>
        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${label}`} onClick={onRemove}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <ol className="flex flex-col gap-1.5 px-2 pt-2.5 sm:px-3">
        {entry.points.map((point, index) => (
          <li key={point.key} className="flex items-center gap-1.5">
            <span className="w-5 shrink-0 text-right text-xs font-semibold text-subtle tabular">{index + 1}.</span>
            <Input
              aria-label={`${label}, point ${index + 1}`}
              value={point.text}
              maxLength={POINT_MAX}
              placeholder={index === 0 ? "What did you work on?" : "Another point"}
              autoFocus={point.key === focusKey}
              aria-invalid={error && !point.text.trim() ? true : undefined}
              className="h-9"
              onChange={(e) => onChange(entry.points.map((p) => (p.key === point.key ? { ...p, text: e.target.value } : p)))}
              onKeyDown={onKeyDown(index)}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove point ${index + 1}`}
              disabled={entry.points.length === 1}
              onClick={() => onChange(entry.points.filter((p) => p.key !== point.key))}
            >
              <Trash2 className="size-4 text-muted" aria-hidden />
            </Button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5 sm:px-3">
        <Button variant="link" size="sm" icon={<Plus className="size-4" aria-hidden />} disabled={entry.points.length >= MAX_POINTS} onClick={() => addAfter(entry.points.length - 1)} className="ml-6.5 text-[13px]">
          Add point
        </Button>
        {error && <p className="text-xs font-medium text-danger">{error}</p>}
      </div>
    </div>
  );
}

/** Compact "+ Add project" dropdown of the assigned projects not yet in the update. */
function AddProject({ options, disabled, onAdd }: { options: ProjectOption[]; disabled: boolean; onAdd: (id: string) => void }) {
  const { errors } = useFormState();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="relative w-44 max-w-full">
        <Plus className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-brand-600" aria-hidden />
        <Select
          id="projects"
          aria-label="Add a project"
          value=""
          disabled={disabled}
          aria-invalid={errors.projects ? true : undefined}
          onChange={(e) => onAdd(e.target.value)}
          className="h-9 border-dashed border-brand-300 bg-brand-50/60 pl-9 text-sm font-semibold text-brand-700 hover:border-brand-500 hover:bg-brand-50 sm:h-9 sm:pl-9"
        >
          {/* Hidden from the list: it only labels the closed button. */}
          <option value="" hidden>
            Add project
          </option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>
      {errors.projects && <p className="text-xs font-medium text-danger">{errors.projects}</p>}
    </div>
  );
}

/** The signed-in person's update for one day: pick projects, then list points under each. */
export function UpdateEditor({ date, projects, initial, exists }: { date: string; projects: ProjectOption[]; initial: { project: string; points: string[] }[]; exists: boolean }) {
  const [entries, setEntries] = useState<Entry[]>(() =>
    initial.map((e) => ({ project: e.project, points: (e.points.length ? e.points : [""]).map((text, i) => ({ key: `${e.project}-${i}`, text })) })),
  );
  const [focusKey, setFocusKey] = useState<string>();
  const labels = new Map(projects.map((p) => [p.id, p.label]));
  const chosen = new Set(entries.map((e) => e.project));
  const available = projects.filter((p) => !chosen.has(p.id));

  const addProject = (id: string) => {
    if (!id || chosen.has(id) || entries.length >= MAX_PROJECTS) return;
    const point = newPoint();
    setEntries([...entries, { project: id, points: [point] }]);
    setFocusKey(point.key);
  };
  const setPoints = (project: string, points: Point[]) => setEntries(entries.map((e) => (e.project === project ? { ...e, points } : e)));

  return (
    <ActionForm action={saveDailyUpdate} values={{ date, entries: entries.map((e) => ({ project: e.project, points: e.points.map((p) => p.text) })) }} successMessage="Daily update saved">
      {entries.length > 0 && (
        <div className="flex flex-col gap-3">
          {entries.map((entry) => (
            <ProjectBlock
              key={entry.project}
              entry={entry}
              label={labels.get(entry.project) ?? "Project"}
              focusKey={focusKey}
              onChange={(points) => setPoints(entry.project, points)}
              onRemove={() => setEntries(entries.filter((e) => e.project !== entry.project))}
              onFocusPoint={setFocusKey}
            />
          ))}
        </div>
      )}

      {projects.length === 0 && entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-5 text-center text-sm text-muted">You&apos;re not assigned to any project yet. Ask your project lead to add you to a team.</p>
      ) : (
        // The picker follows the last project, so the next one is added where the points end — no scrolling back up.
        <div className="flex flex-wrap items-start justify-between gap-2">
          {available.length > 0 ? <AddProject options={available} disabled={entries.length >= MAX_PROJECTS} onAdd={addProject} /> : <span />}
          <div className="flex items-center gap-1.5">
            {exists && (
              <ActionButton
                action={() => deleteDailyUpdate(date)}
                variant="ghost"
                size="icon-sm"
                aria-label="Delete this day's update"
                confirm="This removes every point you posted for this day."
                confirmTitle="Delete this day's update?"
                confirmLabel="Delete"
                confirmTone="danger"
                onSuccess={() => setEntries([])}
              >
                <Trash2 className="size-4 text-danger" aria-hidden />
              </ActionButton>
            )}
            <SubmitButton disabled={entries.length === 0}>{exists ? "Save changes" : "Post update"}</SubmitButton>
          </div>
        </div>
      )}
      {entries.length === 0 && projects.length > 0 && <p className="-mt-1 text-xs text-muted">Only the projects you&apos;re assigned to are listed. Add each one you worked on.</p>}
    </ActionForm>
  );
}
