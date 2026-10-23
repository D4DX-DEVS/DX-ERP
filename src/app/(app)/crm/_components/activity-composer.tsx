"use client";

import { useState } from "react";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Switch, Textarea } from "@/components/ui/input";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";
import { cn } from "@/lib/cn";
import type { ActivityType } from "@/lib/models/crm";
import { saveActivity } from "../actions";
import { COMPOSER_TYPES } from "../_lib/constants";

/** Log a call / meeting / email / WhatsApp / note, or schedule a follow-up with a due time and assignee. */
export function ActivityComposer({ lead, client, people, currentUserId }: { lead?: string; client?: string; people: PickerOption[]; currentUserId: string }) {
  const [type, setType] = useState<ActivityType>("call");
  const [next, setNext] = useState(false);
  const isFollowUp = type === "follow_up";

  return (
    <ActionForm
      action={saveActivity}
      values={{ lead, client, type }}
      resetOnSuccess
      successMessage={false}
      onSuccess={() => setNext(false)}
      className="gap-3"
    >
      <div role="radiogroup" aria-label="Activity type" className="inline-flex max-w-full flex-wrap self-start rounded-[10px] bg-segment p-[3px]">
        {COMPOSER_TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            role="radio"
            aria-checked={type === t.key}
            onClick={() => setType(t.key)}
            className={cn("h-8 rounded-lg px-3 text-[13px] whitespace-nowrap", type === t.key ? "bg-white font-semibold text-ink shadow-segment" : "font-medium text-ink-2 hover:text-ink")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Field label="Subject" name="subject" required>
        <Input id="subject" name="subject" maxLength={300} placeholder={isFollowUp ? "What needs to happen?" : "e.g. Discovery call with the client"} autoComplete="off" />
      </Field>
      <Field label={isFollowUp ? "Details" : "Notes"} name="notes">
        <Textarea id="notes" name="notes" rows={2} maxLength={10000} placeholder={isFollowUp ? "Optional context for whoever picks this up" : "What was discussed?"} />
      </Field>
      {isFollowUp ? (
        <FormGrid>
          <Field label="Due" name="dueAt" required>
            <Input id="dueAt" name="dueAt" type="datetime-local" />
          </Field>
          <Field label="Assign to" name="assignedTo">
            <PeoplePicker name="assignedTo" options={people} defaultValue={currentUserId} allowClear={false} />
          </Field>
        </FormGrid>
      ) : (
        <>
          <Field label="When" name="at" hint="Leave empty for now." className="sm:max-w-64">
            <Input id="at" name="at" type="datetime-local" />
          </Field>
          <Switch label="Schedule a follow-up" description="Adds a reminder for the assignee." checked={next} onChange={(e) => setNext(e.target.checked)} />
          {next && (
            <FormGrid>
              <Field label="Follow-up due" name="nextFollowUpAt" required>
                <Input id="nextFollowUpAt" name="nextFollowUpAt" type="datetime-local" />
              </Field>
              <Field label="Assign to" name="nextFollowUpAssignee">
                <PeoplePicker name="nextFollowUpAssignee" options={people} defaultValue={currentUserId} allowClear={false} />
              </Field>
            </FormGrid>
          )}
        </>
      )}
      <FormActions className="pt-0">
        <SubmitButton size="sm">{isFollowUp ? "Schedule follow-up" : "Save activity"}</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
