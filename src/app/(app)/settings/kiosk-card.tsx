"use client";

import { useEffect, useState } from "react";
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
import { fetchNetworkToken } from "@/lib/network-token";
import { allowOfficeNetwork, createKiosk, deleteKiosk, removeOfficeNetwork, renewKioskLink } from "./kiosk-actions";
import { FormDialog, SettingsCard } from "./ui";

export interface KioskView {
  id: string;
  name: string;
  status: { label: string; tone: Tone };
  lastSeen: string;
  networks: string[];
}

// Dialog triggers receive their click handler and ref as props, so this wrapper must forward them.
function AddButton(props: ButtonProps) {
  return <Button size="sm" icon={<Plus className="size-4" />} {...props} />;
}

/** Office computers that show the rotating attendance QR (Settings → Attendance). */
/** A network scans were refused from recently (`last` already formatted). */
export interface RefusedNetworkView {
  net: string;
  count: number;
  last: string;
  names: string[];
}

export function KioskCard({
  screens,
  networkOrigin,
  officeNetworks,
  refused,
}: {
  screens: KioskView[];
  networkOrigin: string;
  officeNetworks: string[];
  refused: RefusedNetworkView[];
}) {
  const [link, setLink] = useState<string | null>(null);
  // Measured the way phones and screens are (a network token), so it shows what the same-network rule compares.
  const [yourNetwork, setYourNetwork] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void fetchNetworkToken(networkOrigin).then((r) => {
      if (alive) setYourNetwork(r?.net ?? null);
    });
    return () => {
      alive = false;
    };
  }, [networkOrigin]);
  const show = (data: { path: string }) => setLink(window.location.origin + data.path);

  return (
    <SettingsCard
      title="QR check-in screens"
      description="Office computers that show the attendance QR. It changes every minute; staff scan it from their portal to check in and out."
      action={
        <FormDialog trigger={<AddButton>Add screen</AddButton>} title="Add QR screen" action={createKiosk} successMessage={false} submitLabel="Create link" onSuccess={show}>
          <Field label="Screen name" name="name" required hint="Where it stands, e.g. Front desk.">
            <Input id="name" name="name" maxLength={60} placeholder="Front desk" />
          </Field>
        </FormDialog>
      }
    >
      <TableWrap phone={[1, 2, 4]} tablet={[1, 2, 4]} laptop={[1, 2, 4]} className="-mx-5">
        <THead>
          <Th>Screen</Th>
          <Th>Status</Th>
          <Th>Network</Th>
          <Th align="right">
            <span className="sr-only">Actions</span>
          </Th>
        </THead>
        <tbody>
          {screens.length === 0 && <EmptyRow colSpan={4}>No screens yet. Add one, then open its link on the office computer.</EmptyRow>}
          {screens.map((s) => (
            <Tr key={s.id}>
              <Td className="font-medium">{s.name}</Td>
              <Td>
                <div className="flex flex-col items-start gap-1">
                  <Chip tone={s.status.tone}>{s.status.label}</Chip>
                  <span className="text-xs text-muted">{s.lastSeen}</span>
                </div>
              </Td>
              <Td className="font-mono text-xs break-all text-ink-2">{s.networks.length ? s.networks.join(", ") : "—"}</Td>
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
      <div className="mt-4 flex flex-col gap-4 border-t border-line-soft pt-4">
        <div className="flex flex-col gap-1.5">
          <div className="text-[13px] font-semibold text-ink-2">Office networks</div>
          <p className="text-xs text-muted">
            With the same-network rule on, a phone&apos;s network must match a screen&apos;s or one of these. Add the office Wi-Fi&apos;s other address type here: a
            screen computer may report only IPv4 while phones use IPv6, or the reverse.
          </p>
          {officeNetworks.length === 0 ? (
            <p className="text-xs text-subtle">None added.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {officeNetworks.map((net) => (
                <li key={net} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-field px-3 py-1.5">
                  <span className="font-mono text-xs break-all text-ink-2">{net}</span>
                  <ActionButton variant="ghost" size="sm" className="text-danger hover:bg-danger-bg hover:text-danger" action={() => removeOfficeNetwork(net)} confirmTone="danger" confirmTitle="Remove office network" confirmLabel="Remove" confirm={`Phones on ${net} will no longer pass the same-network rule.`}>
                    Remove
                  </ActionButton>
                </li>
              ))}
            </ul>
          )}
        </div>

        {refused.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="text-[13px] font-semibold text-ink-2">Refused in the last 7 days</div>
            <p className="text-xs text-muted">Scans turned away for being on another network. Allow one only if it is the office Wi-Fi.</p>
            <ul className="flex flex-col gap-1">
              {refused.map((r) => (
                <li key={r.net} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-field px-3 py-1.5">
                  <div className="min-w-0">
                    <div className="font-mono text-xs break-all text-ink-2">{r.net}</div>
                    <div className="text-xs text-muted">
                      {r.names.join(", ")} · {r.count} {r.count === 1 ? "scan" : "scans"} · {r.last}
                    </div>
                  </div>
                  <ActionButton variant="secondary" size="sm" action={() => allowOfficeNetwork(r.net)} confirmTitle="Allow this network" confirmLabel="Allow" confirm={`Phones on ${r.net} will pass the same-network rule. Allow it only if it is the office Wi-Fi.`}>
                    Allow
                  </ActionButton>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>
            Your connection: <span className="font-mono text-ink-2">{yourNetwork === undefined ? "checking…" : (yourNetwork ?? "unknown")}</span>
          </span>
          {yourNetwork && !officeNetworks.includes(yourNetwork) && !screens.some((s) => s.networks.includes(yourNetwork)) && (
            <ActionButton variant="ghost" size="sm" action={() => allowOfficeNetwork(yourNetwork)} confirmTitle="Allow this network" confirmLabel="Allow" confirm={`Phones on ${yourNetwork} will pass the same-network rule. Allow it only if this device is on the office Wi-Fi.`}>
              Allow this network
            </ActionButton>
          )}
        </div>
      </div>

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
