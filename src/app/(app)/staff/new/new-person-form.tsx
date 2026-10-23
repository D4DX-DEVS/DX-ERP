"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ActionForm, Field, FormActions, FormGrid, FormSection, SubmitButton } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input, Select, Switch } from "@/components/ui/input";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";
import { cn } from "@/lib/cn";
import { createPerson } from "../actions";
import { MoneyLines } from "../_components/money-lines";
import { BLOOD_GROUPS, DEFAULT_EMPLOYMENT_TYPE, DEFAULT_ROLE_FOR, EMPLOYMENT_TYPE_OPTIONS, GENDER_OPTIONS, NEW_PERSON_TYPES, STIPEND_PERIODS, type NewPersonType } from "../_lib/constants";

interface Props {
  today: string;
  defaultType: NewPersonType;
  roles: { key: string; name: string }[];
  departments: { id: string; name: string }[];
  designations: { id: string; name: string; department?: string }[];
  people: PickerOption[];
  documentCategories: { key: string; label: string; required: boolean; appliesTo: string[]; confidential: boolean }[];
  canSalary: boolean;
  canAccess: boolean;
}

export function NewPersonForm({ today, defaultType, roles, departments, designations, people, documentCategories, canSalary, canAccess }: Props) {
  const router = useRouter();
  const roleFor = (type: NewPersonType) => (roles.some((r) => r.key === DEFAULT_ROLE_FOR[type]) ? DEFAULT_ROLE_FOR[type] : (roles[0]?.key ?? ""));
  const [personType, setPersonType] = useState<NewPersonType>(defaultType);
  const [role, setRole] = useState(roleFor(defaultType));
  const [employmentType, setEmploymentType] = useState(DEFAULT_EMPLOYMENT_TYPE[defaultType]);
  const [department, setDepartment] = useState("");
  const [stipend, setStipend] = useState(false);
  const internLike = personType !== "employee";
  const shownDesignations = designations.filter((d) => !department || !d.department || d.department === department);
  const docs = documentCategories.filter((c) => c.appliesTo.includes(personType));

  function choose(type: NewPersonType) {
    setPersonType(type);
    setRole(roleFor(type));
    setEmploymentType(DEFAULT_EMPLOYMENT_TYPE[type]);
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardBody className="pt-5">
          <ActionForm action={createPerson} successMessage="Person added" onSuccess={(d) => router.push(`/staff/${d.id}`)} className="gap-6">
            <FormSection title="Personal details" description="The work email is the Google account the person will sign in with.">
              <FormGrid>
                <Field label="Full name" name="name" required>
                  <Input id="name" name="name" autoComplete="off" maxLength={120} />
                </Field>
                <Field label="Work email" name="email" required hint="Must be unique and different from the super admin email">
                  <Input id="email" name="email" type="email" autoComplete="off" inputMode="email" />
                </Field>
                <Field label="Phone" name="phone">
                  <Input id="phone" name="phone" type="tel" inputMode="tel" maxLength={30} />
                </Field>
                <Field label="Personal email" name="personalEmail">
                  <Input id="personalEmail" name="personalEmail" type="email" inputMode="email" />
                </Field>
                <Field label="Date of birth" name="dob">
                  <Input id="dob" name="dob" type="date" max={today} />
                </Field>
                <FormGrid cols={1} className="sm:grid-cols-2">
                  <Field label="Gender" name="gender">
                    <Select id="gender" name="gender" defaultValue="">
                      <option value="">—</option>
                      {GENDER_OPTIONS.map((g) => (
                        <option key={g.value} value={g.value}>
                          {g.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Blood group" name="bloodGroup">
                    <Select id="bloodGroup" name="bloodGroup" defaultValue="">
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

            <FormSection title="Role & reporting" description="Fields change with the person type. Trainees and interns get a mentor and an end date.">
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-[13px] font-semibold text-ink-2">Person type</legend>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {NEW_PERSON_TYPES.map((t) => (
                    <label
                      key={t.value}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500",
                        personType === t.value ? "border-2 border-brand-600 bg-brand-50" : "border-line-strong bg-white hover:bg-field",
                      )}
                    >
                      <input type="radio" name="personType" value={t.value} checked={personType === t.value} onChange={() => choose(t.value)} className="mt-0.5 size-[18px] accent-brand-600" />
                      <span>
                        <strong className="block font-semibold text-ink">{t.label}</strong>
                        <span className="text-xs text-muted">{t.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <FormGrid>
                <Field label="Role" name="role" required hint={canAccess ? undefined : "You can assign roles without extra permissions. Ask the Super Admin for elevated roles."}>
                  <Select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value)}>
                    {roles.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Employment type" name="employmentType">
                  <Select id="employmentType" name="employmentType" value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}>
                    {EMPLOYMENT_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Department" name="department">
                  <Select id="department" name="department" value={department} onChange={(e) => setDepartment(e.target.value)}>
                    <option value="">Not assigned</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Designation" name="designation">
                  <Select id="designation" name="designation" defaultValue="">
                    <option value="">Not assigned</option>
                    {shownDesignations.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Joining date" name="joiningDate" required>
                  <Input id="joiningDate" name="joiningDate" type="date" defaultValue={today} />
                </Field>
                <Field label="Team" name="team">
                  <Input id="team" name="team" maxLength={80} placeholder="e.g. Commerce squad" />
                </Field>
                <Field label="Reporting manager" name="reportingManager" className="sm:col-span-2">
                  <PeoplePicker name="reportingManager" options={people} placeholder="Select reporting manager" />
                </Field>
              </FormGrid>
            </FormSection>

            {internLike && (
              <FormSection title={personType === "intern" ? "Internship" : "Traineeship"} description="Dates, mentor and stipend. Objectives can be added from the internship page.">
                <FormGrid>
                  <Field label="Start date" name="internStartDate">
                    <Input id="internStartDate" name="internStartDate" type="date" defaultValue={today} />
                  </Field>
                  <Field label="Expected end date" name="internEndDate">
                    <Input id="internEndDate" name="internEndDate" type="date" />
                  </Field>
                  <Field label="College / institution" name="college">
                    <Input id="college" name="college" maxLength={150} />
                  </Field>
                  <Field label="Course" name="course">
                    <Input id="course" name="course" maxLength={150} placeholder="e.g. B.Des, final year" />
                  </Field>
                  <Field label="Assigned role" name="assignedRole">
                    <Input id="assignedRole" name="assignedRole" maxLength={100} placeholder="e.g. UI/UX intern" />
                  </Field>
                  <Field label="Mentor" name="mentor">
                    <PeoplePicker name="mentor" options={people} placeholder="Select mentor" />
                  </Field>
                  <div className="sm:col-span-2">
                    <Switch name="stipendEligible" label="Stipend eligible" description="Included in stipend payroll runs" checked={stipend} onChange={(e) => setStipend(e.target.checked)} />
                  </div>
                  {stipend && (
                    <>
                      <Field label="Stipend amount (₹)" name="stipendAmount">
                        <Input id="stipendAmount" name="stipendAmount" inputMode="decimal" placeholder="12000" />
                      </Field>
                      <Field label="Period" name="stipendPeriod">
                        <Select id="stipendPeriod" name="stipendPeriod" defaultValue="monthly">
                          {STIPEND_PERIODS.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </>
                  )}
                </FormGrid>
              </FormSection>
            )}

            {canSalary && !internLike && (
              <FormSection title="Salary" description="Restricted — visible only to people with access to confidential records.">
                <FormGrid>
                  <Field label="Basic salary (₹ / month)" name="salaryBasic">
                    <Input id="salaryBasic" name="salaryBasic" inputMode="decimal" placeholder="42000" />
                  </Field>
                  <Field label="Effective from" name="salaryEffectiveFrom">
                    <Input id="salaryEffectiveFrom" name="salaryEffectiveFrom" type="date" defaultValue={today} />
                  </Field>
                </FormGrid>
                <MoneyLines label="Allowances" prefix="allowance" suggestions={["House rent allowance", "Conveyance allowance", "Special allowance"]} />
                <MoneyLines label="Deductions" prefix="deduction" suggestions={["Provident fund", "Professional tax"]} />
              </FormSection>
            )}

            {canAccess && (
              <FormSection title="Access">
                <Switch name="loginAccess" label="Enable login access" description="Lets the person sign in with their work Google account. You can change this later from the Access tab." />
              </FormSection>
            )}

            <FormActions className="border-t border-line-soft pt-4">
              <Button variant="secondary" onClick={() => router.push("/staff")}>
                Cancel
              </Button>
              <SubmitButton>Add person</SubmitButton>
            </FormActions>
          </ActionForm>
        </CardBody>
      </Card>

      <aside className="flex flex-col gap-4">
        <Card>
          <div className="flex flex-col gap-3 p-5">
            <h2 className="font-display text-[17px] font-semibold text-ink">Documents to collect</h2>
            {docs.length === 0 ? (
              <p className="text-[13px] text-muted">No document categories apply to this person type.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {docs.map((d) => (
                  <li key={d.key} className="flex items-center gap-2.5 text-[13px]">
                    <span className="size-[18px] shrink-0 rounded-[5px] border-[1.5px] border-[#c4cad9]" aria-hidden />
                    <span className="min-w-0 flex-1 text-ink">{d.label}</span>
                    <span className="text-xs text-muted">{d.confidential ? "Restricted" : d.required ? "Required" : "Optional"}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted">Upload these from the Documents tab once the record is created.</p>
          </div>
        </Card>
        <section className="flex flex-col gap-2.5 rounded-[14px] bg-navy p-5 text-[13px] leading-relaxed text-[#e3e9fc]">
          <h2 className="font-display text-base font-semibold text-white">On creation</h2>
          <p>A staff ID is generated and the onboarding checklist starts with this record.</p>
          <p>The reporting manager{internLike ? " and mentor are" : " is"} notified.</p>
          <p>
            Login stays off until someone with access rights enables it. People can sign in only with the work email entered here.{" "}
            <Link href="/staff/import" className="font-semibold text-white underline underline-offset-2">
              Adding many people? Import a CSV.
            </Link>
          </p>
        </section>
      </aside>
    </div>
  );
}
