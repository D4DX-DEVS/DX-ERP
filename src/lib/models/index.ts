import "server-only";

export * from "./_tables";

import { User } from "./user";
import { Education } from "./education";
import { BankAccount } from "./bank";
import { Department, Designation, Role, Holiday } from "./org";
import { Settings, Counter, AuditLog, StoredFile, Backup } from "./system";
import { Attendance, AttendanceCorrection, AttendanceKiosk } from "./attendance";
import { Movement } from "./movement";
import { LeaveType, LeaveBalance, LeaveRequest } from "./leave";
import { PayrollRun, Payslip, SalaryAdvance } from "./payroll";
import { Project } from "./project";
import { Task, TimesheetEntry, Issue } from "./work";
import { Client, Lead, Activity } from "./crm";
import { Proposal, Contract } from "./sales";
import { Invoice, Payment, Expense } from "./finance";
import { Asset, Notification, Announcement, LearningResource, Review } from "./ops";
import { ProjectVault, VaultItem, VaultEvent, Credential } from "./vault";

/**
 * Business tables included in backups / restores. Sessions, login attempts, job locks and
 * the backup index itself are intentionally excluded.
 */
export const BACKUP_TABLES = {
  User,
  Education,
  BankAccount,
  Department,
  Designation,
  Role,
  Holiday,
  Settings,
  Counter,
  AuditLog,
  StoredFile,
  Attendance,
  AttendanceCorrection,
  AttendanceKiosk,
  Movement,
  LeaveType,
  LeaveBalance,
  LeaveRequest,
  PayrollRun,
  Payslip,
  SalaryAdvance,
  Project,
  Task,
  TimesheetEntry,
  Issue,
  Client,
  Lead,
  Activity,
  Proposal,
  Contract,
  Invoice,
  Payment,
  Expense,
  Asset,
  Notification,
  Announcement,
  LearningResource,
  Review,
  // Vault data is stored encrypted; restoring it needs the same VAULT_MASTER_KEY.
  ProjectVault,
  VaultItem,
  VaultEvent,
  Credential,
} as const;

export { Backup };
