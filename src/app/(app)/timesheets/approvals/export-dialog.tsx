"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";

/** Export form: a plain GET to the export route, which responds with a file download. */
export function ExportDialog({ people, projects }: { people: { id: string; name: string }[]; projects: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="sm"
      title="Export timesheets"
      description="Choose what to include. Only entries you are allowed to see are exported."
      trigger={
        <Button variant="secondary" icon={<Download className="size-4" aria-hidden />}>
          Export
        </Button>
      }
    >
      <form method="get" action="/timesheets/export" className="flex flex-col gap-4" onSubmit={() => window.setTimeout(() => setOpen(false), 400)}>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
          Employee
          <Select name="employee" defaultValue="">
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
          Project
          <Select name="project" defaultValue="">
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
            From
            <Input type="date" name="from" />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
            To
            <Input type="date" name="to" />
          </label>
        </div>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
          Format
          <Select name="format" defaultValue="xlsx">
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="csv">CSV</option>
            <option value="pdf">PDF</option>
          </Select>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit">Download</Button>
        </div>
      </form>
    </Dialog>
  );
}
