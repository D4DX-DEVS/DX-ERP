"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileSpreadsheet } from "lucide-react";
import { Alert } from "@/components/ui/page";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip, Tag } from "@/components/ui/chip";
import { useServerAction } from "@/components/ui/form";
import { Switch } from "@/components/ui/input";
import { Td, Th, THead, TableWrap, Tr } from "@/components/ui/table";
import { importPeople, previewImport } from "../actions";
import type { ImportPreviewRow } from "../_lib/import";
import { parseCsv, rowsFromCsv } from "./csv";

const MAX_BYTES = 1024 * 1024;

interface Result {
  created: number;
  skipped: number;
  failed: { line: number; error: string }[];
}

export function ImportClient({ canEnableLogin, maxRows }: { canEnableLogin: boolean; maxRows: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [warning, setWarning] = useState("");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [preview, setPreview] = useState<ImportPreviewRow[] | null>(null);
  const [enableLogin, setEnableLogin] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const previewing = useServerAction();
  const importing = useServerAction();

  const valid = preview?.filter((r) => r.valid).length ?? 0;
  const invalid = (preview?.length ?? 0) - valid;

  function reset() {
    setFileName("");
    setParseError("");
    setWarning("");
    setRows([]);
    setPreview(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onFile(file: File | undefined) {
    setResult(null);
    setPreview(null);
    setParseError("");
    setWarning("");
    if (!file) return;
    setFileName(file.name);
    if (file.size > MAX_BYTES) {
      setParseError("The file is larger than 1 MB.");
      return;
    }
    const parsed = rowsFromCsv(parseCsv(await file.text()));
    if (parsed.error) {
      setParseError(parsed.error);
      return;
    }
    if (parsed.rows.length === 0) {
      setParseError("The file has a header but no data rows.");
      return;
    }
    if (parsed.rows.length > maxRows) {
      setParseError(`The file has ${parsed.rows.length} rows. Import at most ${maxRows} at a time.`);
      return;
    }
    if (parsed.unknownColumns.length > 0) setWarning(`Ignored unknown columns: ${parsed.unknownColumns.join(", ")}.`);
    setRows(parsed.rows);
    previewing.run(() => previewImport({ rows: parsed.rows }), { successMessage: false, refresh: false, onSuccess: (d) => setPreview(d.rows) });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="1. Choose a CSV file" subtitle="Header row required. Dates as yyyy-mm-dd (dd/mm/yyyy also works). Up to 500 rows." />
        <div className="flex flex-col gap-3 px-5 pb-5">
          <label className="flex cursor-pointer items-center gap-3 rounded-[10px] border border-dashed border-line-strong bg-field px-4 py-4 text-sm text-ink-2 hover:border-brand-400 hover:bg-brand-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500">
            <FileSpreadsheet className="size-6 text-brand-600" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-semibold">{fileName || "Select or drop a .csv file"}</span>
              <span className="text-xs text-muted">{previewing.pending ? "Checking rows…" : "The file is read in your browser; only the rows are sent for validation."}</span>
            </span>
            <input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          {parseError && <Alert tone="danger">{parseError}</Alert>}
          {warning && <Alert tone="warning">{warning}</Alert>}
        </div>
      </Card>

      {preview && !result && (
        <Card>
          <CardHeader
            title="2. Review"
            subtitle={
              <span className="flex flex-wrap items-center gap-2">
                <Chip tone="green">{valid} ready</Chip>
                {invalid > 0 && <Chip tone="red">{invalid} with issues</Chip>}
                <span>Rows with issues are skipped.</span>
              </span>
            }
          />
          <TableWrap phone={[2, 10]} tablet={[2, 3, 4, 10]}>
            <THead>
              <Th>#</Th>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Type</Th>
              <Th>Role</Th>
              <Th>Department</Th>
              <Th>Designation</Th>
              <Th>Joined</Th>
              <Th>Manager</Th>
              <Th>Check</Th>
            </THead>
            <tbody>
              {preview.map((r) => (
                <Tr key={r.line} className={r.valid ? undefined : "bg-danger-bg/40"}>
                  <Td className="text-muted tabular">{r.line}</Td>
                  <Td className="font-medium">{r.name || "—"}</Td>
                  <Td>{r.email || "—"}</Td>
                  <Td>
                    <Tag tone="gray">{r.personType}</Tag>
                  </Td>
                  <Td>{r.role || "default"}</Td>
                  <Td>{r.department || "—"}</Td>
                  <Td>{r.designation || "—"}</Td>
                  <Td className="whitespace-nowrap">{r.joiningDate || "—"}</Td>
                  <Td>{r.manager || "—"}</Td>
                  <Td className="min-w-56">
                    {r.valid ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                        <CheckCircle2 className="size-4" /> Ready
                      </span>
                    ) : (
                      <ul className="flex flex-col gap-0.5 text-xs font-medium text-danger">
                        {r.issues.map((i) => (
                          <li key={i}>{i}</li>
                        ))}
                      </ul>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft px-5 py-4">
            <div className="flex flex-col gap-2">
              {canEnableLogin ? (
                <Switch checked={enableLogin} onChange={(e) => setEnableLogin(e.target.checked)} label="Enable login access for imported people" description="Otherwise accounts start with login off and can be enabled later." />
              ) : (
                <p className="text-[13px] text-muted">Imported accounts start with login access off. Someone with access rights can enable it afterwards.</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={reset}>
                Start over
              </Button>
              <Button
                disabled={valid === 0}
                loading={importing.pending}
                onClick={() =>
                  importing.run(() => importPeople({ rows, enableLogin }), {
                    successMessage: false,
                    refresh: false,
                    onSuccess: (d) => setResult(d),
                  })
                }
              >
                Import {valid} {valid === 1 ? "person" : "people"}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader title="Import finished" />
          <div className="flex flex-col gap-3 px-5 pb-5">
            <div className="flex flex-wrap gap-2">
              <Chip tone="green">{result.created} added</Chip>
              {result.skipped > 0 && <Chip tone="amber">{result.skipped} skipped (issues)</Chip>}
              {result.failed.length > 0 && <Chip tone="red">{result.failed.length} failed</Chip>}
            </div>
            {result.failed.length > 0 && (
              <Alert tone="danger" title="Some rows could not be saved:">
                <ul className="mt-1 list-disc pl-4">
                  {result.failed.map((f) => (
                    <li key={f.line}>
                      Row {f.line}: {f.error}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
            <div className="flex gap-2">
              <ButtonLink href="/staff">View staff</ButtonLink>
              <Button variant="secondary" onClick={reset}>
                Import another file
              </Button>
            </div>
            <p className="text-xs text-muted">
              Documents, salary and onboarding checklists are completed from each profile.{" "}
              <Link href="/staff" className="font-semibold text-brand-600">
                Open the directory
              </Link>
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
