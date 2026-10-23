"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useServerAction } from "@/components/ui/form";
import { Select, Textarea } from "@/components/ui/input";
import { markLeadLost, markLeadWon } from "../actions";
import { LOST_REASONS } from "../_lib/constants";

/** "Mark lost": a reason is required (pick a common one, optionally add a note). */
export function MarkLostDialog({ leadId, open, onOpenChange }: { leadId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const { pending, run } = useServerAction();
  const invalid = reason.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setReason("");
          setNote("");
          setTouched(false);
        }
      }}
      size="sm"
      title="Mark lead as lost"
      description="Record why the opportunity was lost. It feeds the conversion report."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={pending}
            onClick={() => {
              setTouched(true);
              if (invalid) return;
              run(() => markLeadLost(leadId, { reason, note }), { successMessage: false, onSuccess: () => onOpenChange(false) });
            }}
          >
            Mark lost
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
          Reason <span className="sr-only">(required)</span>
          <Select value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={touched && invalid}>
            <option value="">Choose a reason…</option>
            {LOST_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
          {touched && invalid && <span className="text-xs font-medium text-danger">Reason is required.</span>}
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
          Note (optional)
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Anything worth remembering — competitor, budget, timing…" />
        </label>
      </div>
    </Dialog>
  );
}

interface WonResult {
  leadId: string;
  clientId: string;
  clientNo: string;
  createdClient: boolean;
}

/** "Mark won": ensures a client exists, then offers to start a proposal. */
export function MarkWonDialog({ leadId, open, onOpenChange, canCreateProposal }: { leadId: string; open: boolean; onOpenChange: (open: boolean) => void; canCreateProposal: boolean }) {
  const router = useRouter();
  const [result, setResult] = useState<WonResult | null>(null);
  const { pending, run } = useServerAction();

  const close = () => {
    onOpenChange(false);
    if (result) {
      setResult(null);
      router.refresh();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) onOpenChange(true);
        else close();
      }}
      size="sm"
      title={result ? "Lead won" : "Mark lead as won"}
      description={result ? undefined : "The lead moves to Won. A client record is created from the lead if one isn't linked yet."}
      footer={
        result ? (
          <>
            <Button variant="secondary" onClick={close}>
              Done
            </Button>
            {canCreateProposal && (
              <ButtonLink href={`/proposals/new?lead=${result.leadId}`} onClick={() => onOpenChange(false)}>
                Create proposal
              </ButtonLink>
            )}
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="success" loading={pending} onClick={() => run(() => markLeadWon(leadId), { successMessage: "Lead marked won", refresh: false, onSuccess: setResult })}>
              Mark won
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex items-start gap-3 text-sm text-ink-2">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <p>
            {result.createdClient ? `Client ${result.clientNo} was created from this lead and is now active.` : `Client ${result.clientNo} is now active.`}{" "}
            {canCreateProposal ? "Create a proposal for them now — the details are prefilled from the lead." : ""}
          </p>
        </div>
      ) : (
        <p className="text-sm text-ink-2">Pending follow-ups on this lead will be closed.</p>
      )}
    </Dialog>
  );
}
