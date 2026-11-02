"use client";

import { useState } from "react";
import { GraduationCap, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { ActionButton } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip, Tag } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { FileUpload } from "@/components/ui/file-upload";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/page";
import { addEducationCertificate, deleteEducation, removeEducationCertificate, saveEducation } from "../[id]/education-actions";
import { EDUCATION_CERTIFICATE_TYPES, EDUCATION_LEVELS, EXPECTED_CERTIFICATES, certificateTypeLabel, educationLevelLabel } from "../_lib/education";
import type { EducationView } from "../_lib/education-data";
import { FileTile, MissingTile } from "./file-tile";

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
    <Card id="education" className="@container scroll-mt-20">
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
        <ul className="flex flex-col gap-3 px-4 pb-4 sm:px-5 sm:pb-5">
          {records.map((r) => (
            <EducationRow key={r.id} personId={personId} record={r} canEdit={canEdit} manage={manage} />
          ))}
        </ul>
      )}
    </Card>
  );
}

type Slot = { kind: "file"; cert: EducationView["certificates"][number] } | { kind: "missing"; type: string };

function EducationRow({ personId, record: r, canEdit, manage }: { personId: string; record: EducationView; canEdit: boolean; manage: boolean }) {
  const expected = EXPECTED_CERTIFICATES[r.level] ?? [];
  const have = new Set(r.certificates.map((c) => c.type));
  const collected = expected.filter((t) => have.has(t)).length;
  const years = r.startYear && r.endYear ? `${r.startYear} – ${r.endYear}` : r.endYear ? (r.status === "pursuing" ? `Expected ${r.endYear}` : `Passed ${r.endYear}`) : r.startYear ? `From ${r.startYear}` : "";
  const canDelete = manage || r.certificates.every((c) => c.mine);
  const details = [
    { label: "School / college", value: r.institution },
    { label: "Board / university", value: r.board },
    { label: r.status === "pursuing" ? "Duration" : "Years", value: years },
    { label: "Score / grade", value: r.score },
  ];
  // Expected certificate types first (each uploaded file, or a slot to upload it), then anything else on file.
  const slots: Slot[] = [
    ...expected.flatMap((t): Slot[] => (have.has(t) ? r.certificates.filter((c) => c.type === t).map((cert) => ({ kind: "file", cert })) : [{ kind: "missing", type: t }])),
    ...r.certificates.filter((c) => !expected.includes(c.type)).map((cert): Slot => ({ kind: "file", cert })),
  ];
  return (
    <li className="overflow-hidden rounded-xl border border-line">
      <div className="flex flex-wrap items-start gap-3 px-3.5 py-3 sm:px-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600" aria-hidden>
          <GraduationCap className="size-5" />
        </span>
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-sm font-semibold break-words text-ink">{r.qualification}</h3>
            {r.status === "pursuing" && (
              <Chip tone="amber" size="sm">
                Pursuing
              </Chip>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Tag tone="blue">{educationLevelLabel(r.level, true)}</Tag>
            {expected.length > 0 && (
              <Chip tone={collected === expected.length ? "green" : "amber"} size="sm">
                {collected}/{expected.length} certificates
              </Chip>
            )}
          </div>
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

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-line-soft px-3.5 py-3 sm:gap-x-6 sm:px-4 @3xl:grid-cols-4">
        {details.map((d) => (
          <div key={d.label} className="min-w-0">
            <dt className="text-[11px] font-medium text-muted">{d.label}</dt>
            <dd className="text-[13px] break-words text-ink">{d.value || "—"}</dd>
          </div>
        ))}
      </dl>

      {slots.length > 0 && (
        <div className="grid gap-2 border-t border-line-soft bg-field/60 p-2.5 sm:p-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
          {slots.map((slot) =>
            slot.kind === "file" ? (
              <FileTile
                key={slot.cert.id}
                title={certificateTypeLabel(slot.cert.type)}
                file={slot.cert.file}
                name={slot.cert.name}
                size={slot.cert.size}
                uploadedAt={slot.cert.uploadedAt}
                uploadedByName={slot.cert.uploadedByName}
                note={slot.cert.note}
                actions={
                  canEdit && (manage || slot.cert.mine) ? (
                    <ActionButton
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${slot.cert.name}`}
                      title="Remove certificate"
                      action={() => removeEducationCertificate(personId, r.id, slot.cert.id)}
                      confirmTone="danger"
                      confirmTitle="Remove certificate"
                      confirmLabel="Remove"
                      confirm={`Remove “${slot.cert.name}” (${certificateTypeLabel(slot.cert.type)})?`}
                      successMessage="Certificate removed"
                    >
                      <Trash2 className="size-4 text-subtle" />
                    </ActionButton>
                  ) : undefined
                }
              />
            ) : (
              <MissingTile key={`missing-${slot.type}`} title={certificateTypeLabel(slot.type)} action={canEdit ? <CertificateDialog personId={personId} record={r} type={slot.type} /> : undefined} />
            ),
          )}
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

/**
 * Upload one certificate of a chosen type to a qualification. Expected types for the level are listed first; `type`
 * preselects one (the "Upload" button on an empty slot).
 */
function CertificateDialog({ personId, record, type }: { personId: string; record: EducationView; type?: string }) {
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
        type ? (
          <Button variant="secondary" size="sm" icon={<Upload className="size-3.5" />} aria-label={`Upload ${certificateTypeLabel(type)}`}>
            <span className="max-sm:sr-only">Upload</span>
          </Button>
        ) : (
          <Button variant="secondary" size="sm" icon={<Upload className="size-3.5" />}>
            <span className="max-sm:sr-only">Certificate</span>
          </Button>
        )
      }
    >
      <ActionForm action={addEducationCertificate} values={{ personId, educationId: record.id }} successMessage="Certificate saved" onSuccess={() => setOpen(false)} className="gap-4">
        <Field label="Certificate type" name="type" required>
          <Select id="type" name="type" defaultValue={type ?? missing ?? ""}>
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
