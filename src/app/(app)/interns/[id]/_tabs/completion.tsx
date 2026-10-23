import { Check, Download } from "lucide-react";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/chip";
import { Alert } from "@/components/ui/page";
import { cn } from "@/lib/cn";
import { ApproveCertificateButton, CompleteInternshipButton, ExtendInternshipButton, IssueCertificateButton, RequestCertificateButton } from "../../_components/completion-actions";
import type { InternTabProps } from "./types";

const CERT_STEPS = [
  { key: "requested", label: "Requested" },
  { key: "approved", label: "Approved" },
  { key: "issued", label: "Issued" },
] as const;

export function CompletionTab({ target, access }: InternTabProps) {
  const internship = target.internship;
  const id = target._id.toString();
  if (!internship) {
    return (
      <Card>
        <CardBody className="pt-5 text-[13px] text-muted">This person has no internship record.</CardBody>
      </Card>
    );
  }
  const running = ["registered", "active", "extended"].includes(internship.status);
  const completed = internship.status === "completed";
  const cert = internship.certificateStatus;
  const reached = cert === "none" ? 0 : CERT_STEPS.findIndex((s) => s.key === cert) + 1;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Completion" action={<StatusChip domain="internship" value={internship.status} />} />
        <CardBody className="flex flex-col gap-3">
          {completed ? (
            <>
              <p className="text-[13px] text-ink-2">Completed {fmtDateTime(internship.completedAt)}.</p>
              {internship.completionNote && <p className="rounded-xl bg-field px-3.5 py-2.5 text-[13px] whitespace-pre-line text-ink-2">{internship.completionNote}</p>}
            </>
          ) : internship.status === "terminated" ? (
            <Alert tone="warning">This internship was terminated when the person left. No further completion steps apply.</Alert>
          ) : (
            <p className="text-[13px] text-ink-2">
              Planned end date: <strong>{fmtDate(internship.endDate)}</strong>
              {internship.status === "extended" ? " (extended)" : ""}. Mark the internship completed after the final evaluation, or extend it.
            </p>
          )}
          {running && access.canRun && (
            <div className="flex flex-wrap gap-2">
              <CompleteInternshipButton userId={id} name={target.name} />
              <ExtendInternshipButton userId={id} currentEnd={internship.endDate} />
            </div>
          )}
          {running && !access.canRun && <p className="text-xs text-muted">Your mentor marks the internship completed.</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Certificate" action={<StatusChip domain="certificate" value={cert} />} />
        <CardBody className="flex flex-col gap-4">
          <ol className="flex items-center gap-2" aria-label="Certificate progress">
            {CERT_STEPS.map((s, i) => (
              <li key={s.key} className="flex flex-1 items-center gap-2">
                <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", i < reached ? "bg-success text-white" : "bg-track text-tone-gray")}>
                  {i < reached ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className={cn("text-[13px]", i < reached ? "font-semibold text-ink" : "text-muted")}>{s.label}</span>
                {i < CERT_STEPS.length - 1 && <span className={cn("h-px flex-1", i + 1 < reached ? "bg-success" : "bg-line")} aria-hidden />}
              </li>
            ))}
          </ol>

          {cert === "issued" && (
            <div className="flex flex-col gap-2 text-[13px] text-ink-2">
              <p>
                Certificate <strong>{internship.certificateNo}</strong> issued on {fmtDate(internship.certificateIssuedAt)}.
              </p>
              <div>
                <ButtonLink href={`/api/pdf/certificate/${id}`} target="_blank" rel="noopener noreferrer" icon={<Download className="size-4" />}>
                  Download certificate (PDF)
                </ButtonLink>
              </div>
            </div>
          )}
          {cert === "approved" && (
            <div className="flex flex-col gap-2 text-[13px] text-ink-2">
              <p>The request is approved and waiting to be issued.</p>
              {access.canManage && (
                <div>
                  <IssueCertificateButton userId={id} />
                </div>
              )}
            </div>
          )}
          {cert === "requested" && (
            <div className="flex flex-col gap-2 text-[13px] text-ink-2">
              <p>Waiting for approval by an internship manager.</p>
              {access.canManage && (
                <div>
                  <ApproveCertificateButton userId={id} />
                </div>
              )}
            </div>
          )}
          {cert === "none" && (
            <div className="flex flex-col gap-2 text-[13px] text-ink-2">
              {completed ? (
                <>
                  <p>The internship is completed. A certificate can be requested and issued after management approval.</p>
                  {(access.isSelf || access.isMentor || access.canManage) && (
                    <div>
                      <RequestCertificateButton userId={id} />
                    </div>
                  )}
                </>
              ) : (
                <p>Certificates become available once the internship is completed.</p>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
