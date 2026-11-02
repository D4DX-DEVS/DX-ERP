"use client";

import { useState } from "react";
import { Field, FormGrid } from "@/components/ui/form";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { fmtDate } from "@/lib/time";
import { CONTRACT_DURATIONS, contractEndFor, contractLengthLabel } from "../_lib/constants";

/** Phone + WhatsApp number (two grid cells). "Same as phone" mirrors the phone number into the WhatsApp field. */
export function PhoneFields({ defaultPhone = "", defaultWhatsapp = "" }: { defaultPhone?: string; defaultWhatsapp?: string }) {
  const [phone, setPhone] = useState(defaultPhone);
  const [whatsapp, setWhatsapp] = useState(defaultWhatsapp);
  const [same, setSame] = useState(defaultWhatsapp === defaultPhone);
  return (
    <>
      <Field label="Phone" name="phone">
        <Input id="phone" name="phone" type="tel" inputMode="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label="WhatsApp number" name="whatsapp">
        <Input
          id="whatsapp"
          name="whatsapp"
          type="tel"
          inputMode="tel"
          maxLength={30}
          value={same ? phone : whatsapp}
          readOnly={same}
          onChange={(e) => setWhatsapp(e.target.value)}
          className={same ? "bg-field text-muted" : undefined}
        />
        <div className="mt-1.5">
          <Checkbox
            label="Same as phone"
            checked={same}
            onChange={(e) => {
              setSame(e.target.checked);
              if (!e.target.checked && !whatsapp) setWhatsapp(phone);
            }}
          />
        </div>
      </Field>
    </>
  );
}

/**
 * Contract start / length / end. Picking a length fills the end date from the start date (or `fallbackStart`,
 * usually the joining date); the end date stays editable. An empty end date means open-ended.
 */
export function ContractPeriodFields({ defaultStart = "", defaultEnd = "", fallbackStart }: { defaultStart?: string; defaultEnd?: string; fallbackStart?: string }) {
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [length, setLength] = useState("");
  const from = start || fallbackStart || "";

  function applyLength(value: string, base: string) {
    const months = Number(value);
    if (value === "open") setEnd("");
    else if (months > 0 && base) setEnd(contractEndFor(base, months));
  }

  const summary = from && end ? (end < from ? "The end date is before the start date." : `${contractLengthLabel(from, end)} · ${fmtDate(from)} – ${fmtDate(end)}`) : from ? "Open-ended (no end date)" : "";
  return (
    <div className="flex flex-col gap-1.5">
      <FormGrid cols={3}>
        <Field label="Contract start" name="contractStart" hint={fallbackStart && !start ? "Defaults to the joining date" : undefined}>
          <Input
            id="contractStart"
            name="contractStart"
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              if (length) applyLength(length, e.target.value || fallbackStart || "");
            }}
          />
        </Field>
        <Field label="Length">
          <Select
            id="contractLength"
            aria-label="Contract length"
            value={length}
            onChange={(e) => {
              setLength(e.target.value);
              applyLength(e.target.value, from);
            }}
          >
            <option value="">Custom</option>
            {CONTRACT_DURATIONS.map((m) => (
              <option key={m} value={m}>
                {m % 12 === 0 ? `${m / 12} ${m === 12 ? "year" : "years"}` : `${m} months`}
              </option>
            ))}
            <option value="open">Open-ended</option>
          </Select>
        </Field>
        <Field label="Contract end" name="contractEnd" hint="Last day of the contract">
          <Input
            id="contractEnd"
            name="contractEnd"
            type="date"
            min={from || undefined}
            value={end}
            onChange={(e) => {
              setEnd(e.target.value);
              setLength("");
            }}
          />
        </Field>
      </FormGrid>
      {summary && <p className="text-xs text-muted">{summary}</p>}
    </div>
  );
}
