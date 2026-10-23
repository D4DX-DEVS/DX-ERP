"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, FormSection, SubmitButton, type FormAction } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/input";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";
import { updateMyProfile } from "../../profile/actions";
import { updatePersonSection, type ProfileSection } from "../actions";
import { BLOOD_GROUPS, EMPLOYMENT_TYPE_OPTIONS, GENDER_OPTIONS } from "../_lib/constants";
import { PersonalFields, type PersonalDefaults } from "./personal-fields";

/** Pencil icon button used in card headers (`size="md"`) and next to individual values (`size="sm"`). */
export function EditIconButton({ label, onClick, size = "sm" }: { label: string; onClick: () => void; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-field hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-brand-500",
        size === "sm" ? "size-7" : "size-8",
      )}
    >
      <Pencil className={size === "sm" ? "size-3.5" : "size-4"} aria-hidden />
    </button>
  );
}

/** Current values shown in the section dialogs (all optional strings, as the form inputs expect). */
export interface SectionPerson extends PersonalDefaults {
  id: string;
  name: string;
  email: string;
  dob?: string;
  gender?: string;
  bloodGroup?: string;
  employmentType: string;
  team?: string;
  joiningDate?: string;
  internship?: { startDate?: string; endDate?: string; college?: string; course?: string; assignedRole?: string; mentor?: string };
}

const TITLES: Record<ProfileSection, { title: string; description?: string }> = {
  employment: { title: "Edit employment & contact", description: "Department, designation, status and reporting manager have their own ✎ buttons so the change history stays complete." },
  personal: { title: "Edit personal details" },
  internship: { title: "Edit internship details", description: "To extend an internship use Completion → Extend on the internship page." },
};

function SectionDialog({ open, onOpenChange, title, description, action, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; action: FormAction; children: React.ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={title} description={description}>
      <ActionForm action={action} successMessage="Details saved" onSuccess={() => onOpenChange(false)} className="gap-5">
        {children}
        <FormActions className="border-t border-line-soft pt-4">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SubmitButton>Save</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

/** Card-header pencil that edits one section of a staff profile (staff.edit). */
export function SectionEditButton({
  section,
  person,
  today,
  canEmail = false,
  people = [],
}: {
  section: ProfileSection;
  person: SectionPerson;
  today: string;
  canEmail?: boolean;
  people?: PickerOption[];
}) {
  const [open, setOpen] = useState(false);
  const meta = TITLES[section];
  return (
    <>
      <EditIconButton size="md" label={meta.title} onClick={() => setOpen(true)} />
      {open && (
        <SectionDialog open onOpenChange={setOpen} title={meta.title} description={meta.description} action={(input) => updatePersonSection(person.id, section, input)}>
          {section === "employment" && (
            <FormGrid>
              <Field label="Work email" name="email" hint={canEmail ? "Changing it signs the person out and re-links Google sign-in" : "Only users who manage access can change this"}>
                <Input id="email" name="email" type="email" inputMode="email" defaultValue={person.email} readOnly={!canEmail} />
              </Field>
              <Field label="Phone" name="phone">
                <Input id="phone" name="phone" type="tel" inputMode="tel" maxLength={30} defaultValue={person.phone ?? ""} />
              </Field>
              <Field label="Employment type" name="employmentType">
                <Select id="employmentType" name="employmentType" defaultValue={person.employmentType}>
                  {EMPLOYMENT_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Joining date" name="joiningDate" required>
                <Input id="joiningDate" name="joiningDate" type="date" max={today} defaultValue={person.joiningDate ?? ""} />
              </Field>
              <Field label="Team" name="team" className="sm:col-span-2">
                <Input id="team" name="team" maxLength={80} defaultValue={person.team ?? ""} />
              </Field>
            </FormGrid>
          )}

          {section === "personal" && (
            <>
              <FormSection title="Identity">
                <FormGrid>
                  <Field label="Full name" name="name" required className="sm:col-span-2">
                    <Input id="name" name="name" maxLength={120} defaultValue={person.name} />
                  </Field>
                  <Field label="Date of birth" name="dob">
                    <Input id="dob" name="dob" type="date" max={today} defaultValue={person.dob ?? ""} />
                  </Field>
                  <FormGrid cols={1} className="sm:grid-cols-2">
                    <Field label="Gender" name="gender">
                      <Select id="gender" name="gender" defaultValue={person.gender ?? ""}>
                        <option value="">—</option>
                        {GENDER_OPTIONS.map((g) => (
                          <option key={g.value} value={g.value}>
                            {g.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Blood group" name="bloodGroup">
                      <Select id="bloodGroup" name="bloodGroup" defaultValue={person.bloodGroup ?? ""}>
                        <option value="">—</option>
                        {BLOOD_GROUPS.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </FormGrid>
                </FormGrid>
              </FormSection>
              <PersonalFields defaults={person} withPhone={false} />
            </>
          )}

          {section === "internship" && (
            <FormGrid>
              <Field label="Start date" name="internStartDate">
                <Input id="internStartDate" name="internStartDate" type="date" defaultValue={person.internship?.startDate ?? ""} />
              </Field>
              <Field label="Expected end date" name="internEndDate">
                <Input id="internEndDate" name="internEndDate" type="date" defaultValue={person.internship?.endDate ?? ""} />
              </Field>
              <Field label="College / institution" name="college">
                <Input id="college" name="college" maxLength={150} defaultValue={person.internship?.college ?? ""} />
              </Field>
              <Field label="Course" name="course">
                <Input id="course" name="course" maxLength={150} defaultValue={person.internship?.course ?? ""} />
              </Field>
              <Field label="Assigned role" name="assignedRole">
                <Input id="assignedRole" name="assignedRole" maxLength={100} defaultValue={person.internship?.assignedRole ?? ""} />
              </Field>
              <Field label="Mentor" name="mentor">
                <PeoplePicker name="mentor" options={people.filter((p) => p.id !== person.id)} defaultValue={person.internship?.mentor} placeholder="Select mentor" />
              </Field>
            </FormGrid>
          )}
        </SectionDialog>
      )}
    </>
  );
}

/** For people viewing their own profile without staff.edit: the self-service contact fields from /profile. */
export function SelfContactEditButton({ person }: { person: PersonalDefaults }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <EditIconButton size="md" label="Edit my contact details" onClick={() => setOpen(true)} />
      {open && (
        <SectionDialog open onOpenChange={setOpen} title="Edit my contact details" description="Phone, personal email, address and emergency contact. Ask HR to change anything else." action={updateMyProfile}>
          <PersonalFields defaults={person} />
        </SectionDialog>
      )}
    </>
  );
}
