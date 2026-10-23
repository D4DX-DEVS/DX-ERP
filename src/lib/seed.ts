import "server-only";
import { connectDB } from "@/lib/db";
import { Department, Designation, LeaveType, Settings } from "@/lib/models";
import { ensureRoles } from "@/lib/rbac/roles";

/**
 * First-run setup (idempotent): built-in roles, settings document, leave types and a starter set
 * of departments / designations. Runs when the Super Admin signs in.
 */
export async function ensureSeeded(): Promise<void> {
  await connectDB();
  await ensureRoles();

  await Settings.updateOne({ _id: "global" }, { $setOnInsert: { value: {} } }, { upsert: true });

  if ((await LeaveType.estimatedDocumentCount()) === 0) {
    await LeaveType.insertMany([
      { name: "Casual leave", code: "CL", color: "#284CC7", annualQuota: 12, accrual: "monthly", carryForward: false, paid: true, allowHalfDay: true, requiresHrApproval: false, applicableTo: ["employee", "trainee", "intern"], order: 1 },
      { name: "Sick leave", code: "SL", color: "#0E9F75", annualQuota: 8, accrual: "upfront", carryForward: false, paid: true, allowHalfDay: true, requiresHrApproval: false, requiresAttachmentAfterDays: 2, applicableTo: ["employee", "trainee", "intern"], order: 2 },
      { name: "Annual leave", code: "AL", color: "#6D28D9", annualQuota: 15, accrual: "monthly", carryForward: true, maxCarryForward: 10, paid: true, allowHalfDay: false, requiresHrApproval: true, applicableTo: ["employee"], order: 3 },
      { name: "Compensatory leave", code: "CO", color: "#D0691F", annualQuota: 0, accrual: "upfront", carryForward: false, paid: true, allowHalfDay: true, requiresHrApproval: false, applicableTo: ["employee", "trainee"], order: 4 },
      { name: "Unpaid leave", code: "LOP", color: "#8A93B2", annualQuota: 0, accrual: "upfront", carryForward: false, paid: false, allowHalfDay: true, requiresHrApproval: true, applicableTo: ["employee", "trainee", "intern"], order: 5 },
    ]);
  }

  if ((await Department.estimatedDocumentCount()) === 0) {
    await Department.insertMany(
      [
        ["Engineering", "ENG"],
        ["Design", "DES"],
        ["Digital Marketing", "MKT"],
        ["Business Development", "BD"],
        ["Project Management", "PMO"],
        ["HR & Administration", "HR"],
        ["Finance & Accounts", "FIN"],
        ["Management", "MGT"],
      ].map(([name, code]) => ({ name, code })),
    );
  }

  if ((await Designation.estimatedDocumentCount()) === 0) {
    await Designation.insertMany(
      [
        "Managing Partner",
        "Project Manager",
        "Team Lead",
        "Senior Software Engineer",
        "Software Engineer",
        "UI/UX Designer",
        "QA Engineer",
        "Digital Marketing Executive",
        "Business Development Executive",
        "HR Executive",
        "Accounts Executive",
        "Trainee",
        "Intern",
      ].map((name, i) => ({ name, level: i + 1 })),
    );
  }
}
