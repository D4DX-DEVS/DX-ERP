"use client";

import { useState } from "react";
import { Copy, Plus } from "lucide-react";
import { toast } from "sonner";
import { ActionButton } from "@/components/ui/actions";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { EmptyRow, TableWrap, THead, Td, Th, Tr } from "@/components/ui/table";
import type { Tone } from "@/lib/config-defaults";
import { createKiosk, deleteKiosk, renewKioskLink } from "./kiosk-actions";
import { FormDialog, SettingsCard } from "./ui";

export interface KioskView {
  id: string;
  name: string;
  status: { label: string; tone: Tone };
  lastSeen: string;
}

// Dialog triggers receive their click handler and ref as props, so this wrapper must forward them.
function AddButton(props: ButtonProps) {
  return <Button size="sm" icon={<Plus className="size-4" />} {...props} />;
}

/** Office computers that show the rotating attendance QR (Settings → Attendance). */
export function KioskCard({ screens }: { screens: KioskView[] }) {
  const [link, setLink] = useState<string | null>(null);
  const show = (data: { path: string }) => setLink(window.location.origin + data.path);

  return (
    <SettingsCard
      title="QR check-in screens"
      description="Office computers that show the attendance QR. It changes every 15 seconds; staff scan it from their portal to check in and out."
      action={
        <FormDialog trigger={<AddButton>Add screen</AddButton>} title="Add QR screen" action={createKiosk} successMessage={false} submitLabel="Create link" onSuccess={show}>
          <Field label="Screen name" name="name" required hint="Where it stands, e.g. Front desk.">
            <Input id="name" name="name" maxLength={60} placeholder="Front desk" />
          </Field>
        </FormDialog>
      }
    >
      <TableWrap phone={[1, 2, 3]} tablet={[1, 2, 3]} laptop="auto" className="-mx-5">
        <THead>
          <Th>Screen</Th>
          <Th>Status</Th>
          <Th align="right">
            <span className="sr-only">Actions</span>
          </Th>
        </THead>
        <tbody>
          {screens.length === 0 && <EmptyRow colSpan={3}>No screens yet. Add one, then open its link on the office computer.</EmptyRow>}
          {screens.map((s) => (
            <Tr key={s.id}>
              <Td className="font-medium">{s.name}</Td>
              <Td>
                <div className="flex flex-col items-start gap-1">
                  <Chip tone={s.status.tone}>{s.status.label}</Chip>
                  <span className="text-xs text-muted">{s.lastSeen}</span>
                </div>
              </Td>
              <Td align="right" className="whitespace-nowrap">
                <ActionButton
                  variant="ghost"
                  size="sm"
                  action={() => renewKioskLink(s.id)}
                  successMessage={false}
                  onSuccess={show}
                  confirmTitle="Create a new link"
                  confirmLabel="Create new link"
                  confirmTone="warning"
                  confirm={`The current link and the computer showing "${s.name}" stop working until the new link is opened there.`}
                >
                  New link
                </ActionButton>
                <ActionButton
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:bg-danger-bg hover:text-danger"
                  action={() => deleteKiosk(s.id)}
                  confirmTone="danger"
                  confirmTitle="Remove screen"
                  confirmLabel="Remove"
                  confirm={`Remove "${s.name}"? Its QR codes stop working at once.`}
                >
                  Remove
                </ActionButton>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableWrap>

      <Dialog open={link !== null} onOpenChange={(o) => !o && setLink(null)} title="Screen link" description="Shown only once. Create a new link if you lose it." size="md">
        <div className="flex flex-col gap-4 pb-1">
          <div className="flex gap-2">
            <Input readOnly value={link ?? ""} aria-label="Screen link" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="secondary"
              icon={<Copy className="size-4" />}
              onClick={() =>
                navigator.clipboard
                  .writeText(link ?? "")
                  .then(() => toast.success("Link copied"))
                  .catch(() => toast.error("Copy failed — select the link and copy it."))
              }
            >
              Copy
            </Button>
          </div>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13px] text-ink-2">
            <li>Open the link in Chrome on the office computer (not on your own device).</li>
            <li>Click “Use this computer as the attendance screen”. The link then works only in that browser.</li>
            <li>Press F11 for full screen and leave the page open.</li>
          </ol>
        </div>
      </Dialog>
    </SettingsCard>
  );
}
