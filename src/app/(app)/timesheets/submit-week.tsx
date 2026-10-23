"use client";

import { Send } from "lucide-react";
import { ActionButton } from "@/components/ui/actions";
import { submitWeek } from "./actions";

/** Submits all draft and rejected entries of the week for review. */
export function SubmitWeek({ week, count }: { week: string; count: number }) {
  return (
    <ActionButton
      action={() => submitWeek(week)}
      icon={<Send className="size-4" aria-hidden />}
      confirm={`Submit ${count} ${count === 1 ? "entry" : "entries"} for review? Approved entries are locked afterwards.`}
      successMessage="Week submitted for review"
    >
      Submit week
    </ActionButton>
  );
}
