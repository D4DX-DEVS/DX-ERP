"use client";

import { Check, ChevronDown } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { useConfirm } from "@/components/ui/confirm";
import { Menu } from "@/components/ui/menu";
import { useServerAction } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/config-defaults";
import { TONE_CLASSES } from "@/lib/status";
import { changeTaskStatus } from "../actions";

export interface StatusChoice {
  key: string;
  label: string;
  tone: Tone;
  /** Status category; moving to "cancelled" asks for confirmation. */
  category?: string;
}

/** Status chip that opens a menu of the statuses the viewer may move the task to. */
export function TaskStatusMenu({ taskId, current, choices, size = "md" }: { taskId: string; current: StatusChoice; choices: StatusChoice[]; size?: "sm" | "md" }) {
  const { pending, run } = useServerAction();
  const confirm = useConfirm();
  if (choices.length === 0) {
    return (
      <Chip tone={current.tone} size={size === "sm" ? "sm" : "md"}>
        {current.label}
      </Chip>
    );
  }
  return (
    <Menu
      label="Change status"
      align="start"
      trigger={
        <button
          type="button"
          disabled={pending}
          aria-label={`Status: ${current.label}. Change status`}
          className={cn("inline-flex items-center gap-1 rounded-full focus-visible:outline-2", pending && "opacity-60")}
        >
          <Chip tone={current.tone} size={size === "sm" ? "sm" : "md"} className="pr-1.5">
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
        onSelect: async () => {
          if (c.category === "cancelled") {
            const ok = await confirm({ title: `Mark task ${c.label.toLowerCase()}?`, description: "The task is closed and no longer counts as open work. You can reopen it later by changing its status.", confirmLabel: c.label, tone: "danger" });
            if (!ok) return;
          }
          run(() => changeTaskStatus(taskId, c.key), { successMessage: `Moved to ${c.label}` });
        },
      }))}
    />
  );
}
