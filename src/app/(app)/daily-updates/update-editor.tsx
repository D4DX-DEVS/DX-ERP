"use client";

import { useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { FolderKanban, Plus, Trash2, X } from "lucide-react";
import { ActionButton } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { ActionForm, Field, FormActions, SubmitButton, useFormState } from "@/components/ui/form";
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
    <div className="rounded-xl border border-line bg-white" data-invalid={error ? "" : undefined}>
      <div className="flex items-center justify-between gap-2 border-b border-line-soft py-2 pr-2 pl-3 sm:pl-4">
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
          <FolderKanban className="size-4 shrink-0 text-brand-600" aria-hidden />
          <span className="break-words">{label}</span>
        </span>
        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${label}`} onClick={onRemove}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <ol className="flex flex-col gap-2 p-3 sm:px-4">
        {entry.points.map((point, index) => (
          <li key={point.key} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right text-xs font-semibold text-muted tabular">{index + 1}.</span>
            <Input
              aria-label={`${label}, point ${index + 1}`}
              value={point.text}
              maxLength={POINT_MAX}
              placeholder={index === 0 ? "What did you work on?" : "Another point"}
              autoFocus={point.key === focusKey}
              aria-invalid={error && !point.text.trim() ? true : undefined}
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
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3 sm:px-4">
        <Button variant="ghost" size="sm" icon={<Plus className="size-4" aria-hidden />} disabled={entry.points.length >= MAX_POINTS} onClick={() => addAfter(entry.points.length - 1)}>
          Add point
        </Button>
        {error && <p className="text-xs font-medium text-danger">{error}</p>}
      </div>
    </div>
  );
}

/** The signed-in person's update for one day: pick projects, then list points under each. */
export function UpdateEditor({
  date,
  today,
  projects,
  initial,
  exists,
}: {
  date: string;
  today: string;
  projects: ProjectOption[];
  initial: { project: string; points: string[] }[];
  exists: boolean;
}) {
  const router = useRouter();
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
      <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:gap-4">
        <Field label="Date" name="date" required>
          <Input id="date" type="date" max={today} value={date} onChange={(e) => e.target.value && router.push(e.target.value === today ? "/daily-updates" : `/daily-updates?date=${e.target.value}`)} />
        </Field>
        <Field label="Projects" name="projects" required hint={projects.length ? "Only the projects you're assigned to are listed. Add as many as you worked on." : undefined}>
          <Select id="projects" value="" onChange={(e) => addProject(e.target.value)} disabled={available.length === 0 || entries.length >= MAX_PROJECTS}>
            <option value="">{projects.length === 0 ? "You're not assigned to any project yet" : available.length === 0 ? "All your projects are added" : "Add a project…"}</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {entries.length > 0 ? (
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
      ) : (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">Pick the projects you worked on, then add your points under each.</p>
      )}

      <FormActions className="justify-between">
        {exists ? (
          <ActionButton
            action={() => deleteDailyUpdate(date)}
            variant="ghost"
            size="sm"
            icon={<Trash2 className="size-4" aria-hidden />}
            className="text-danger"
            confirm="This removes every point you posted for this day."
            confirmTitle="Delete this day's update?"
            confirmLabel="Delete"
            confirmTone="danger"
            onSuccess={() => setEntries([])}
          >
            Delete update
          </ActionButton>
        ) : (
          <span />
        )}
        <SubmitButton disabled={entries.length === 0}>{exists ? "Save changes" : "Post update"}</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
