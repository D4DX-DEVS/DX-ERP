"use client";

import { useState } from "react";
import { Check, FileText, GraduationCap, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { ActionButton } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip, Tag } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { FileUpload } from "@/components/ui/file-upload";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/page";
import { fileSize } from "@/lib/format";
import { fmtDate } from "@/lib/time";
import { addEducationCertificate, deleteEducation, removeEducationCertificate, saveEducation } from "../[id]/education-actions";
import { EDUCATION_CERTIFICATE_TYPES, EDUCATION_LEVELS, EXPECTED_CERTIFICATES, certificateTypeLabel, educationLevelLabel } from "../_lib/education";
import type { EducationView } from "../_lib/education-data";

const PLACEHOLDER: Record<string, string> = {
  sslc: "e.g. SSLC — Kerala State Board",
  hss: "e.g. Plus Two — Computer Science",
  iti: "e.g. ITI Electrician",
  diploma: "e.g. Diploma in Computer Engineering",
  ug: "e.g. B.Tech Computer Science",
  pg: "e.g. MBA Marketing",
  doctorate: "e.g. PhD in Design",
  certification: "e.g. Google UX Design Certificate",
  other: "Course name",
};

/**
 * Structured education: one entry per qualification (SSLC, higher secondary, diploma, degree…), each with any number
 * of typed certificates (marksheets, provisional, course completion, degree certificate…).
 */
export function EducationPanel({ personId, records, canEdit, manage }: { personId: string; records: EducationView[]; canEdit: boolean; manage: boolean }) {
  const certificateCount = records.reduce((n, r) => n + r.certificates.length, 0);
  return (
    <Card id="education" className="scroll-mt-20">
      <CardHeader
        title="Education"
        subtitle={records.length ? `${records.length} ${records.length === 1 ? "qualification" : "qualifications"} · ${certificateCount} ${certificateCount === 1 ? "certificate" : "certificates"}` : "Qualifications with their marksheets and certificates"}
        action={canEdit ? <RecordDialog personId={personId} /> : undefined}
      />
      {records.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="size-5" />}
          title="No education added yet"
          description={canEdit ? "Add each qualification — SSLC, higher secondary, diploma, degree — then upload its certificates." : undefined}
        />
      ) : (
        <ul className="pb-2">
          {records.map((r) => (
            <EducationRow key={r.id} personId={personId} record={r} canEdit={canEdit} manage={manage} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function EducationRow({ personId, record: r, canEdit, manage }: { personId: string; record: EducationView; canEdit: boolean; manage: boolean }) {
  const expected = EXPECTED_CERTIFICATES[r.level] ?? [];
  const have = new Set(r.certificates.map((c) => c.type));
  const years = r.startYear && r.endYear ? `${r.startYear} – ${r.endYear}` : r.endYear ? (r.status === "pursuing" ? `Expected ${r.endYear}` : `Passed ${r.endYear}`) : r.startYear ? `From ${r.startYear}` : "";
  const canDelete = manage || r.certificates.every((c) => c.mine);
  return (
    <li className="border-t border-line-soft px-5 py-3.5 first:border-t-0">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-60">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone="blue">{educationLevelLabel(r.level, true)}</Tag>
            <span className="font-display text-sm font-semibold break-words text-ink">{r.qualification}</span>
            {r.status === "pursuing" && (
              <Chip tone="amber" size="sm">
                Pursuing
              </Chip>
            )}
          </div>
          <div className="mt-1 text-xs text-muted">{[r.institution, r.board, years, r.score].filter(Boolean).join(" · ") || "—"}</div>
        </div>
        {canEdit && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <CertificateDialog personId={personId} record={r} />
            <RecordDialog personId={personId} record={r} />
            {canDelete && (
              <ActionButton
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${r.qualification}`}
                title="Delete qualification"
                action={() => deleteEducation(personId, r.id)}
                confirmTone="danger"
                confirmTitle="Delete qualification"
                confirmLabel="Delete"
                confirm={`Delete “${r.qualification}”${r.certificates.length ? ` and its ${r.certificates.length} certificate${r.certificates.length === 1 ? "" : "s"}` : ""}?`}
                successMessage="Qualification deleted"
              >
                <Trash2 className="size-4 text-subtle" />
              </ActionButton>
            )}
          </div>
        )}
      </div>

      {r.certificates.length > 0 && (
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {r.certificates.map((c) => (
            <li key={c.id} className="flex items-start gap-2.5 rounded-[10px] bg-field px-3 py-2">
              <FileText className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-ink">{certificateTypeLabel(c.type)}</div>
                <a href={`/api/files/${c.file}`} target="_blank" rel="noopener noreferrer" className="block text-xs break-words text-brand-600 hover:underline">
                  {c.name}
                </a>
                <div className="text-[11px] text-muted">
                  {[c.size ? fileSize(c.size) : null, `uploaded ${fmtDate(c.uploadedAt)}`, c.uploadedByName ? `by ${c.uploadedByName}` : null, c.note].filter(Boolean).join(" · ")}
                </div>
              </div>
              {canEdit && (manage || c.mine) && (
                <ActionButton
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${c.name}`}
                  title="Remove certificate"
                  action={() => removeEducationCertificate(personId, r.id, c.id)}
                  confirmTone="danger"
                  confirmTitle="Remove certificate"
                  confirmLabel="Remove"
                  confirm={`Remove “${c.name}” (${certificateTypeLabel(c.type)})?`}
                  successMessage="Certificate removed"
                >
                  <Trash2 className="size-3.5 text-subtle" />
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      )}

      {expected.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-muted">Usually collected:</span>
          {expected.map((t) => (
            <span key={t} className={have.has(t) ? "inline-flex items-center gap-1 text-success" : "text-muted"}>
              {have.has(t) && <Check className="size-3.5" aria-hidden />}
              {certificateTypeLabel(t)}
              {!have.has(t) && " — not uploaded"}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

/** Add (no `record`) or edit a qualification. */
function RecordDialog({ personId, record }: { personId: string; record?: EducationView }) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState(record?.level ?? "");
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="lg"
      title={record ? "Edit qualification" : "Add qualification"}
      description={record ? undefined : "Add one entry per course. Certificates (marksheets, provisional, degree certificate…) are uploaded on the entry."}
      trigger={
        record ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${record.qualification}`} title="Edit qualification">
            <Pencil className="size-4 text-subtle" />
          </Button>
        ) : (
          <Button variant="secondary" icon={<Plus className="size-4" />}>
            <span className="max-sm:sr-only">Add qualification</span>
          </Button>
        )
      }
    >
      <ActionForm action={saveEducation} values={{ personId, ...(record ? { id: record.id } : {}) }} successMessage="Education saved" onSuccess={() => setOpen(false)} className="gap-4">
        <FormGrid>
          <Field label="Level" name="level" required>
            <Select id="level" name="level" value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="" disabled>
                Select level
              </option>
              {EDUCATION_LEVELS.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" name="status">
            <Select id="status" name="status" defaultValue={record?.status ?? "completed"}>
              <option value="completed">Completed</option>
              <option value="pursuing">Pursuing</option>
            </Select>
          </Field>
          <Field label="Course / qualification" name="qualification" required className="sm:col-span-2">
            <Input id="qualification" name="qualification" maxLength={150} defaultValue={record?.qualification} placeholder={PLACEHOLDER[level] ?? "Course name"} />
          </Field>
          <Field label="School / college / institute" name="institution">
            <Input id="institution" name="institution" maxLength={200} defaultValue={record?.institution} />
          </Field>
          <Field label="Board / university" name="board">
            <Input id="board" name="board" maxLength={200} defaultValue={record?.board} />
          </Field>
          <Field label="Start year" name="startYear">
            <Input id="startYear" name="startYear" type="number" inputMode="numeric" min={1950} max={2100} defaultValue={record?.startYear ?? ""} />
          </Field>
          <Field label="Year of passing" name="endYear">
            <Input id="endYear" name="endYear" type="number" inputMode="numeric" min={1950} max={2100} defaultValue={record?.endYear ?? ""} />
          </Field>
          <Field label="Score / grade" name="score" hint="e.g. 86%, 8.2 CGPA, First class">
            <Input id="score" name="score" maxLength={40} defaultValue={record?.score} />
          </Field>
        </FormGrid>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>{record ? "Save changes" : "Add qualification"}</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

/** Upload one certificate of a chosen type to a qualification. Expected types for the level are listed first. */
function CertificateDialog({ personId, record }: { personId: string; record: EducationView }) {
  const [open, setOpen] = useState(false);
  const expected = EXPECTED_CERTIFICATES[record.level] ?? [];
  const missing = expected.find((t) => !record.certificates.some((c) => c.type === t));
  const ordered = [...EDUCATION_CERTIFICATE_TYPES].sort((a, b) => Number(expected.includes(b.key)) - Number(expected.includes(a.key)));
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Upload certificate"
      description={`${educationLevelLabel(record.level, true)} · ${record.qualification}`}
      trigger={
        <Button variant="secondary" size="sm" icon={<Upload className="size-3.5" />}>
          <span className="max-sm:sr-only">Certificate</span>
        </Button>
      }
    >
      <ActionForm action={addEducationCertificate} values={{ personId, educationId: record.id }} successMessage="Certificate saved" onSuccess={() => setOpen(false)} className="gap-4">
        <Field label="Certificate type" name="type" required>
          <Select id="type" name="type" defaultValue={missing ?? ""}>
            <option value="" disabled>
              Select type
            </option>
            {ordered.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
                {expected.includes(t.key) ? (record.certificates.some((c) => c.type === t.key) ? " ✓" : " · usually needed") : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="File" name="fileId" required>
          <FileUpload name="fileId" multiple={false} label="Choose file" context={{ entityType: "user", entityId: personId }} />
        </Field>
        <Field label="Note" name="note">
          <Input id="note" name="note" maxLength={200} placeholder="Optional — e.g. Semester 1–8" />
        </Field>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Save certificate</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}
