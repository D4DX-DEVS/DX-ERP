"use client";

import { useState } from "react";
import { ActionForm, Field } from "@/components/ui/form";
import { Checkbox, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { FileUpload } from "@/components/ui/file-upload";
import { Alert } from "@/components/ui/page";
import { NOTIFICATION_EVENTS, type AppSettings } from "@/lib/config-defaults";
import { formatDuration } from "@/lib/time";
import {
  saveAttendance,
  saveCompany,
  saveDataSecurity,
  saveDocumentTemplates,
  saveLeaveSettings,
  saveNotifications,
  saveNumbering,
} from "./actions";
import { CERTIFICATE_PLACEHOLDERS, invoicePreview, MONTH_NAMES, WEEKDAYS } from "./constants";
import { CGrid, PillCheck, SaveRow, SettingsCard } from "./ui";

/* ───────────────────────────── Company ───────────────────────────── */

export function CompanyForm({ company, storageConfigured }: { company: AppSettings["company"]; storageConfigured: boolean }) {
  return (
    <SettingsCard title="Company profile & logo" description="Shown on invoices, proposals, payslips, certificates and exports.">
      <ActionForm action={saveCompany}>
        <CGrid>
          <Field label="Display name" name="name" required>
            <Input id="name" name="name" defaultValue={company.name} maxLength={120} />
          </Field>
          <Field label="Legal name" name="legalName" required hint="Printed on invoices and certificates.">
            <Input id="legalName" name="legalName" defaultValue={company.legalName} maxLength={160} />
          </Field>
          <Field label="Email" name="email">
            <Input id="email" name="email" type="email" defaultValue={company.email} />
          </Field>
          <Field label="Phone" name="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={company.phone} maxLength={40} />
          </Field>
          <Field label="Website" name="website">
            <Input id="website" name="website" type="url" defaultValue={company.website} placeholder="https://" />
          </Field>
          <div className="hidden @lg:block" />
          <Field label="GSTIN" name="gstin" hint="15 characters, e.g. 32ABCDE1234F1Z5">
            <Input id="gstin" name="gstin" defaultValue={company.gstin} className="uppercase" maxLength={15} />
          </Field>
          <Field label="PAN" name="pan" hint="10 characters, e.g. ABCDE1234F">
            <Input id="pan" name="pan" defaultValue={company.pan} className="uppercase" maxLength={10} />
          </Field>
          <Field label="Address" name="address" className="@lg:col-span-2">
            <Textarea id="address" name="address" defaultValue={company.address} rows={3} maxLength={500} />
          </Field>
        </CGrid>

        <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
          <div className="text-[13px] font-semibold text-ink-2">Logo</div>
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex h-16 w-40 items-center justify-center rounded-xl border border-line bg-field p-2">
              {company.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={company.logo} alt="Current company logo" className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-xs text-muted">No logo</span>
              )}
            </span>
            {storageConfigured ? (
              <FileUpload
                name="logoFile"
                multiple={false}
                accept="image/png,image/jpeg,image/webp"
                label="Upload new logo"
                hint="PNG, JPG or WebP · up to 10 MB · transparent background works best"
                context={{ entityType: "company", isPublic: true }}
                className="min-w-0 flex-1 basis-72"
              />
            ) : (
              <Alert tone="warning" className="min-w-0 flex-1 basis-72">
                File storage is not configured, so logos can&apos;t be uploaded.
              </Alert>
            )}
          </div>
          <Checkbox name="resetLogo" label="Use the default D4DX logo instead" />
        </div>
        <SaveRow />
      </ActionForm>
    </SettingsCard>
  );
}

/* ───────────────────────────── Attendance ───────────────────────────── */

export function AttendanceForm({ attendance }: { attendance: AppSettings["attendance"] }) {
  const [full, setFull] = useState(String(attendance.fullDayMinutes));
  const [half, setHalf] = useState(String(attendance.halfDayMinutes));
  return (
    <SettingsCard title="Working days & office hours" description="Used for attendance, late marks, half days and working-hour totals.">
      <ActionForm action={saveAttendance}>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-semibold text-ink-2">Working days</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => (
              <PillCheck key={d.value} name="workingDays[]" value={String(d.value)} label={d.label} defaultChecked={attendance.workingDays.includes(d.value)} />
            ))}
          </div>
        </fieldset>
        <CGrid cols={3}>
          <Field label="Office starts" name="officeStart" required>
            <Input id="officeStart" name="officeStart" type="time" defaultValue={attendance.officeStart} />
          </Field>
          <Field label="Office ends" name="officeEnd" required>
            <Input id="officeEnd" name="officeEnd" type="time" defaultValue={attendance.officeEnd} />
          </Field>
          <Field label="Missing check-out alert after" name="missingCheckoutAfter" required hint="Flag a day with no check-out after this time.">
            <Input id="missingCheckoutAfter" name="missingCheckoutAfter" type="time" defaultValue={attendance.missingCheckoutAfter} />
          </Field>
          <Field label="Late grace (minutes)" name="graceMinutes" required hint="Check-ins within this window are not marked late.">
            <Input id="graceMinutes" name="graceMinutes" type="number" min={0} max={240} defaultValue={attendance.graceMinutes} />
          </Field>
          <Field label="Early-leave grace (minutes)" name="earlyLeaveGraceMinutes" required>
            <Input id="earlyLeaveGraceMinutes" name="earlyLeaveGraceMinutes" type="number" min={0} max={240} defaultValue={attendance.earlyLeaveGraceMinutes} />
          </Field>
          <Field label="Attendance tracked from" name="trackingStartDate" hint="Go-live date. Earlier days without attendance are never counted as absent (payroll LOP).">
            <Input id="trackingStartDate" name="trackingStartDate" type="date" defaultValue={attendance.trackingStartDate} />
          </Field>
          <Field label="Full day (minutes)" name="fullDayMinutes" required hint={`Worked time of ${formatDuration(Number(full) || 0)} or more counts as a full day.`}>
            <Input id="fullDayMinutes" name="fullDayMinutes" type="number" min={30} max={1440} value={full} onChange={(e) => setFull(e.target.value)} />
          </Field>
          <Field label="Half day (minutes)" name="halfDayMinutes" required hint={`Worked time of ${formatDuration(Number(half) || 0)} or more (but under a full day) counts as a half day.`}>
            <Input id="halfDayMinutes" name="halfDayMinutes" type="number" min={15} max={1440} value={half} onChange={(e) => setHalf(e.target.value)} />
          </Field>
        </CGrid>
        <div className="flex flex-col gap-4 border-t border-line-soft pt-4">
          <Switch name="allowSelfCheckIn" defaultChecked={attendance.allowSelfCheckIn} label="Allow self check-in and check-out" description="Staff record their own attendance from the app." />
          <Switch name="officialMovementCountsAsWork" defaultChecked={attendance.officialMovementCountsAsWork} label="Official movements count as working time" description="Time out of the office for official purposes is not deducted." />
          <Switch name="personalMovementDeducted" defaultChecked={attendance.personalMovementDeducted} label="Deduct personal movement time" description="Time out for personal reasons is deducted from working hours." />
        </div>
        <SaveRow />
      </ActionForm>
    </SettingsCard>
  );
}

/* ───────────────────────────── Leave settings ───────────────────────────── */

export function LeaveSettingsForm({ leave }: { leave: AppSettings["leave"] }) {
  return (
    <SettingsCard title="Leave year & balance rules" description="Apply to every leave category.">
      <ActionForm action={saveLeaveSettings}>
        <CGrid>
          <Field label="Leave year starts in" name="yearStartMonth" required hint="Balances reset and carry forward at the start of this month.">
            <Select id="yearStartMonth" name="yearStartMonth" defaultValue={String(leave.yearStartMonth)}>
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
        </CGrid>
        <div className="flex flex-col gap-4">
          <Switch name="allowNegativeBalance" defaultChecked={leave.allowNegativeBalance} label="Allow negative leave balance" description="Let people request more leave than they have accrued." />
          <Switch name="countWeekendsInLeave" defaultChecked={leave.countWeekendsInLeave} label="Count weekends and holidays inside a leave period" description="When off, only working days are deducted from the balance." />
        </div>
        <SaveRow />
      </ActionForm>
    </SettingsCard>
  );
}

/* ───────────────────────────── Numbering ───────────────────────────── */

export function NumberingForm({ numbering, fiscalYear }: { numbering: AppSettings["numbering"]; fiscalYear: string }) {
  const [prefix, setPrefix] = useState(numbering.invoicePrefix);
  const [padding, setPadding] = useState(String(numbering.invoicePadding));
  const [fiscal, setFiscal] = useState(numbering.invoiceIncludeFiscalYear);
  return (
    <SettingsCard title="Document numbering" description="Prefixes for numbers generated on new documents. Existing documents keep their numbers.">
      <ActionForm action={saveNumbering}>
        <CGrid cols={3}>
          <Field label="Invoice prefix" name="invoicePrefix">
            <Input id="invoicePrefix" name="invoicePrefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={24} />
          </Field>
          <Field label="Number length" name="invoicePadding" required hint="Digits, zero-padded.">
            <Input id="invoicePadding" name="invoicePadding" type="number" min={1} max={8} value={padding} onChange={(e) => setPadding(e.target.value)} />
          </Field>
          <div className="flex items-end pb-1.5">
            <Switch name="invoiceIncludeFiscalYear" checked={fiscal} onChange={(e) => setFiscal(e.target.checked)} label="Include fiscal year" description="April–March, e.g. 2026-27" />
          </div>
        </CGrid>
        <div className="rounded-xl bg-brand-50 px-4 py-3 text-[13px] text-ink-2" aria-live="polite">
          Next invoice number looks like <strong className="font-mono text-ink">{invoicePreview(prefix, Number(padding), fiscal, fiscalYear)}</strong>
        </div>
        <CGrid>
          <Field label="Proposal prefix" name="proposalPrefix" hint="Proposals read like PRP-0001.">
            <Input id="proposalPrefix" name="proposalPrefix" defaultValue={numbering.proposalPrefix} maxLength={24} />
          </Field>
          <Field label="Certificate prefix" name="certificatePrefix" hint="Internship certificates read like D4DX/INT/0001.">
            <Input id="certificatePrefix" name="certificatePrefix" defaultValue={numbering.certificatePrefix} maxLength={24} />
          </Field>
        </CGrid>
        <SaveRow />
      </ActionForm>
    </SettingsCard>
  );
}

/* ───────────────────────────── Templates ───────────────────────────── */

export function TemplatesForm({ documents }: { documents: AppSettings["documents"] }) {
  return (
    <SettingsCard title="Document templates" description="Standard text printed on generated documents.">
      <ActionForm action={saveDocumentTemplates}>
        <CGrid>
          <Field label="Invoice notes" name="invoiceNotes">
            <Textarea id="invoiceNotes" name="invoiceNotes" defaultValue={documents.invoiceNotes} rows={3} maxLength={1000} />
          </Field>
          <Field label="Invoice terms" name="invoiceTerms">
            <Textarea id="invoiceTerms" name="invoiceTerms" defaultValue={documents.invoiceTerms} rows={3} maxLength={2000} />
          </Field>
          <Field label="Proposal terms" name="proposalTerms">
            <Textarea id="proposalTerms" name="proposalTerms" defaultValue={documents.proposalTerms} rows={3} maxLength={2000} />
          </Field>
          <Field label="Payslip footer" name="payslipFooter">
            <Textarea id="payslipFooter" name="payslipFooter" defaultValue={documents.payslipFooter} rows={3} maxLength={500} />
          </Field>
          <Field label="Bank details" name="bankDetails" hint="Printed on invoices so clients know where to pay." className="@lg:col-span-2">
            <Textarea id="bankDetails" name="bankDetails" defaultValue={documents.bankDetails} rows={4} maxLength={1000} placeholder={"Account name\nBank and branch\nAccount number · IFSC"} />
          </Field>
          <Field
            label="Internship certificate text"
            name="certificateText"
            required
            className="@lg:col-span-2"
            hint={
              <>
                Placeholders filled in automatically:{" "}
                {CERTIFICATE_PLACEHOLDERS.map((p) => (
                  <code key={p} className="mr-1.5 rounded bg-track px-1 py-0.5 font-mono text-[11px] text-ink-2">
                    {p}
                  </code>
                ))}
              </>
            }
          >
            <Textarea id="certificateText" name="certificateText" defaultValue={documents.certificateText} rows={5} maxLength={2000} />
          </Field>
        </CGrid>
        <SaveRow />
      </ActionForm>
    </SettingsCard>
  );
}

/* ───────────────────────────── Notifications ───────────────────────────── */

export function NotificationsForm({ notifications, smtpConfigured }: { notifications: AppSettings["notifications"]; smtpConfigured: boolean }) {
  return (
    <SettingsCard title="Notifications" description="Choose how people are notified and which events are sent at all.">
      <ActionForm action={saveNotifications}>
        <div className="flex flex-col gap-4">
          <Switch name="inApp" defaultChecked={notifications.inApp} label="In-app notifications" description="Shown in the bell menu and notification centre." />
          <Switch name="email" defaultChecked={notifications.email} label="Email notifications" description="Send a copy of each notification by email." />
        </div>
        {smtpConfigured ? (
          <Alert tone="success">Email server (SMTP) is configured. Emails are sent from the address set in the server environment.</Alert>
        ) : (
          <Alert tone="warning" title="Email server not configured.">
            Turning on email has no effect until SMTP_HOST (and related variables) are set on the server.
          </Alert>
        )}
        <CGrid cols={3}>
          <Field label="Reminder lead time (days)" name="reminderDaysBefore" required hint="How early expiry and due-date reminders start.">
            <Input id="reminderDaysBefore" name="reminderDaysBefore" type="number" min={1} max={60} defaultValue={notifications.reminderDaysBefore} />
          </Field>
        </CGrid>
        <fieldset className="flex flex-col gap-3 border-t border-line-soft pt-4">
          <legend className="font-display text-[15px] font-semibold text-ink">Events</legend>
          <div className="grid gap-x-8 gap-y-3.5 @lg:grid-cols-2">
            {NOTIFICATION_EVENTS.map((e) => (
              <Switch key={e.key} name={`event_${e.key}`} defaultChecked={notifications.events[e.key] !== false} label={e.label} />
            ))}
          </div>
        </fieldset>
        <SaveRow />
      </ActionForm>
    </SettingsCard>
  );
}

/* ───────────────────────────── Data & security ───────────────────────────── */

export function DataSecurityForm({ data, security }: { data: AppSettings["data"]; security: AppSettings["security"] }) {
  return (
    <SettingsCard title="Data retention & security" description="How long records are kept and how long people stay signed in.">
      <ActionForm action={saveDataSecurity}>
        <CGrid cols={3}>
          <Field label="Audit trail retention (days)" name="auditRetentionDays" required hint="Entries older than this are purged. Minimum 90.">
            <Input id="auditRetentionDays" name="auditRetentionDays" type="number" min={90} max={3650} defaultValue={data.auditRetentionDays} />
          </Field>
          <Field label="Notification retention (days)" name="notificationRetentionDays" required hint="Minimum 7.">
            <Input id="notificationRetentionDays" name="notificationRetentionDays" type="number" min={7} max={730} defaultValue={data.notificationRetentionDays} />
          </Field>
          <Field label="Backups to keep" name="backupRetentionCount" required hint="Older backups are deleted automatically.">
            <Input id="backupRetentionCount" name="backupRetentionCount" type="number" min={1} max={90} defaultValue={data.backupRetentionCount} />
          </Field>
          <Field label="Session length (hours)" name="sessionHours" required hint="Sign-in lasts this long without “remember me”.">
            <Input id="sessionHours" name="sessionHours" type="number" min={1} max={72} defaultValue={security.sessionHours} />
          </Field>
          <Field label="“Remember me” length (days)" name="rememberDays" required>
            <Input id="rememberDays" name="rememberDays" type="number" min={1} max={90} defaultValue={security.rememberDays} />
          </Field>
        </CGrid>
        <Switch name="autoBackup" defaultChecked={data.autoBackup} label="Automatic daily backup" description="Runs once every 24 hours when file storage is configured, then removes backups beyond the limit above." />
        <p className="text-[13px] text-muted">New session lengths apply to sign-ins from now on; people who are already signed in keep their current session.</p>
        <SaveRow />
      </ActionForm>
    </SettingsCard>
  );
}
