"use client";

import { useRouter } from "next/navigation";
import { Ban, Check, ChevronDown, Trash2 } from "lucide-react";
import { ActionButton, ReasonAction } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useServerAction } from "@/components/ui/form";
import { Menu } from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/config-defaults";
import { TONE_CLASSES } from "@/lib/status";
import { cancelProject, deleteProject, setProjectStatus } from "../actions";

/** Danger buttons collapse to their icon on phones so the header actions fit one row. */
const ICON_ON_PHONE = "max-sm:w-9 max-sm:px-0";

export interface ProjectStatusChoice {
  key: string;
  label: string;
  tone: Tone;
}

/** Status chip with a menu to move the project, plus cancel / delete for users who may. */
export function ProjectStatusControl({
  projectId,
  current,
  choices,
  canCancel,
  canDelete,
}: {
  projectId: string;
  current: ProjectStatusChoice;
  /** Statuses the user may set (empty = read-only chip). */
  choices: ProjectStatusChoice[];
  canCancel: boolean;
  canDelete: boolean;
}) {
  const { pending, run } = useServerAction();
  const router = useRouter();

  const menu =
    choices.length === 0 ? (
      <Chip tone={current.tone}>{current.label}</Chip>
    ) : (
      <Menu
        label="Change project status"
        align="start"
        trigger={
          <button type="button" disabled={pending} aria-label={`Status: ${current.label}. Change status`} className="inline-flex items-center rounded-full">
            <Chip tone={current.tone} className="pr-1.5">
              {current.label}
              <ChevronDown className="size-3.5" aria-hidden />
            </Chip>
          </button>
        }
        items={choices.map((c) => ({
          label: (
            <span className="flex w-full items-center gap-2">
              <span className={cn("size-2 rounded-full", TONE_CLASSES[c.tone].dot)} aria-hidden />
              <span className="flex-1">{c.label}</span>
              {c.key === current.key && <Check className="size-4 text-brand-600" aria-hidden />}
            </span>
          ),
          disabled: c.key === current.key,
          onSelect: () => run(() => setProjectStatus(projectId, c.key), { successMessage: `Status set to ${c.label}` }),
        }))}
      />
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {menu}
      {canCancel && (
        <ReasonAction
          action={(reason) => cancelProject(projectId, reason)}
          title="Cancel project"
          description="The project is kept for the record but marked cancelled. The team is notified."
          label="Reason for cancelling"
          confirmLabel="Cancel project"
          confirmVariant="danger"
          successMessage="Project cancelled"
          trigger={
            <Button variant="danger-outline" icon={<Ban className="size-4" aria-hidden />} className={ICON_ON_PHONE}>
              <span className="max-sm:sr-only">Cancel project</span>
            </Button>
          }
        />
      )}
      {canDelete && (
        <ActionButton
          action={() => deleteProject(projectId)}
          variant="danger-outline"
          icon={<Trash2 className="size-4" aria-hidden />}
          className={ICON_ON_PHONE}
          confirm="Delete this project permanently? This only works for projects with no tasks, timesheets, issues, invoices or expenses."
          confirmTitle="Delete project?"
          confirmLabel="Delete project"
          successMessage="Project deleted"
          onSuccess={() => router.push("/projects")}
        >
          <span className="max-sm:sr-only">Delete project</span>
        </ActionButton>
      )}
    </div>
  );
}
