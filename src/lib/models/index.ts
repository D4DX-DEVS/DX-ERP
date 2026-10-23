import "server-only";

export * from "./_base";
export * from "./user";
export * from "./org";
export * from "./system";
export * from "./attendance";
export * from "./movement";
export * from "./leave";
export * from "./payroll";
export * from "./project";
export * from "./work";
export * from "./crm";
export * from "./sales";
export * from "./finance";
export * from "./ops";
export * from "./vault";

import { User } from "./user";
import { Department, Designation, Role, Holiday } from "./org";
import { Settings, Counter, AuditLog, StoredFile, Backup } from "./system";
import { Attendance, AttendanceCorrection } from "./attendance";
import { Movement } from "./movement";
import { LeaveType, LeaveBalance, LeaveRequest } from "./leave";
import { PayrollRun, Payslip, SalaryAdvance } from "./payroll";
import { Project } from "./project";
import { Task, TimesheetEntry, Issue } from "./work";
import { Client, Lead, Activity } from "./crm";
import { Proposal, Contract } from "./sales";
import { Invoice, Payment, Expense } from "./finance";
import { Asset, Notification, Announcement, LearningResource, Review } from "./ops";
import { ProjectVault, VaultItem, VaultEvent } from "./vault";

/**
 * Business collections included in backups / restores. Sessions, login attempts, job locks and
 * the backup index itself are intentionally excluded.
 */
export const BACKUP_MODELS = {
  User,
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
} as const;

export { Backup };
