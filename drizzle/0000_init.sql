CREATE TABLE `users` (
	`_id` text PRIMARY KEY NOT NULL,
	`employeeId` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`personalEmail` text,
	`phone` text,
	`photo` text,
	`personType` text DEFAULT 'employee' NOT NULL,
	`role` text NOT NULL,
	`isSuperAdmin` integer DEFAULT false NOT NULL,
	`department` text,
	`designation` text,
	`employmentType` text DEFAULT 'full_time' NOT NULL,
	`joiningDate` text,
	`status` text DEFAULT 'active' NOT NULL,
	`accountActive` integer DEFAULT false NOT NULL,
	`reportingManager` text,
	`team` text,
	`dob` text,
	`gender` text,
	`bloodGroup` text,
	`address` text,
	`emergencyContact` text,
	`salary` text,
	`salaryHistory` text NOT NULL,
	`bank` text,
	`exit` text NOT NULL,
	`internship` text,
	`onboarding` text NOT NULL,
	`history` text NOT NULL,
	`googleSub` text,
	`lastLoginAt` integer,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_employee_id` ON `users` (`employeeId`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_single_super_admin` ON `users` (`isSuperAdmin`) WHERE "isSuperAdmin" = 1;--> statement-breakpoint
CREATE INDEX `users_person_type` ON `users` (`personType`);--> statement-breakpoint
CREATE INDEX `users_role` ON `users` (`role`);--> statement-breakpoint
CREATE INDEX `users_department` ON `users` (`department`);--> statement-breakpoint
CREATE INDEX `users_status` ON `users` (`status`);--> statement-breakpoint
CREATE INDEX `users_reporting_manager` ON `users` (`reportingManager`);--> statement-breakpoint
CREATE TABLE `departments` (
	`_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`head` text,
	`description` text,
	`active` integer DEFAULT true NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `departments_name` ON `departments` (`name`);--> statement-breakpoint
CREATE TABLE `designations` (
	`_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`department` text,
	`level` integer,
	`active` integer DEFAULT true NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `designations_name` ON `designations` (`name`);--> statement-breakpoint
CREATE TABLE `holidays` (
	`_id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`optional` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holidays_date` ON `holidays` (`date`);--> statement-breakpoint
CREATE TABLE `roles` (
	`_id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`permissions` text NOT NULL,
	`system` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_key` ON `roles` (`key`);--> statement-breakpoint
CREATE TABLE `auditlogs` (
	`_id` text PRIMARY KEY NOT NULL,
	`actor` text,
	`actorName` text NOT NULL,
	`actorRole` text,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entityId` text,
	`ref` text,
	`summary` text NOT NULL,
	`changes` text,
	`ip` text,
	`userAgent` text,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auditlogs_actor` ON `auditlogs` (`actor`);--> statement-breakpoint
CREATE INDEX `auditlogs_action` ON `auditlogs` (`action`);--> statement-breakpoint
CREATE INDEX `auditlogs_entity` ON `auditlogs` (`entity`);--> statement-breakpoint
CREATE INDEX `auditlogs_entity_id` ON `auditlogs` (`entityId`);--> statement-breakpoint
CREATE INDEX `auditlogs_at` ON `auditlogs` (`at`);--> statement-breakpoint
CREATE TABLE `backups` (
	`_id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`collections` text NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`by` text,
	`byName` text,
	`status` text DEFAULT 'completed' NOT NULL,
	`error` text,
	`restoredAt` integer,
	`restoredBy` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `counters` (
	`_id` text PRIMARY KEY NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `loginattempts` (
	`_id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `loginattempts_key` ON `loginattempts` (`key`);--> statement-breakpoint
CREATE INDEX `loginattempts_at` ON `loginattempts` (`at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`_id` text PRIMARY KEY NOT NULL,
	`sid` text NOT NULL,
	`user` text NOT NULL,
	`createdAt` integer NOT NULL,
	`lastSeenAt` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`ip` text,
	`userAgent` text,
	`method` text NOT NULL,
	`revokedAt` integer,
	`revokedReason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_sid` ON `sessions` (`sid`);--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at` ON `sessions` (`expiresAt`);--> statement-breakpoint
CREATE TABLE `settings` (
	`_id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updatedBy` text,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `storedfiles` (
	`_id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`mime` text DEFAULT 'application/octet-stream' NOT NULL,
	`isPublic` integer DEFAULT false NOT NULL,
	`url` text,
	`entityType` text NOT NULL,
	`entityId` text,
	`category` text,
	`confidential` integer DEFAULT false NOT NULL,
	`expiryDate` text,
	`notes` text,
	`version` integer DEFAULT 1 NOT NULL,
	`replaces` text,
	`replacedBy` text,
	`uploadedBy` text,
	`uploadedByName` text,
	`deletedAt` integer,
	`deletedBy` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storedfiles_key` ON `storedfiles` (`key`);--> statement-breakpoint
CREATE INDEX `storedfiles_entity_type` ON `storedfiles` (`entityType`);--> statement-breakpoint
CREATE INDEX `storedfiles_entity_id` ON `storedfiles` (`entityId`);--> statement-breakpoint
CREATE TABLE `systemjobs` (
	`_id` text PRIMARY KEY NOT NULL,
	`lastRunAt` integer,
	`lockedUntil` integer,
	`lastResult` text
);
--> statement-breakpoint
CREATE TABLE `attendances` (
	`_id` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`date` text NOT NULL,
	`checkIn` integer,
	`checkOut` integer,
	`breaks` text NOT NULL,
	`breakMinutes` integer DEFAULT 0 NOT NULL,
	`workMinutes` integer DEFAULT 0 NOT NULL,
	`movementMinutes` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'present' NOT NULL,
	`late` integer DEFAULT false NOT NULL,
	`lateMinutes` integer DEFAULT 0 NOT NULL,
	`earlyDeparture` integer DEFAULT false NOT NULL,
	`earlyMinutes` integer DEFAULT 0 NOT NULL,
	`missingCheckout` integer DEFAULT false NOT NULL,
	`source` text DEFAULT 'self' NOT NULL,
	`remarks` text,
	`locked` integer DEFAULT false NOT NULL,
	`history` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendances_user_date` ON `attendances` (`user`,`date`);--> statement-breakpoint
CREATE INDEX `attendances_date_status` ON `attendances` (`date`,`status`);--> statement-breakpoint
CREATE TABLE `attendancecorrections` (
	`_id` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`date` text NOT NULL,
	`attendance` text,
	`requestedCheckIn` integer,
	`requestedCheckOut` integer,
	`original` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewer` text,
	`reviewerName` text,
	`reviewedAt` integer,
	`reviewNote` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attendancecorrections_user` ON `attendancecorrections` (`user`);--> statement-breakpoint
CREATE INDEX `attendancecorrections_status` ON `attendancecorrections` (`status`);--> statement-breakpoint
CREATE TABLE `movements` (
	`_id` text PRIMARY KEY NOT NULL,
	`movementNo` text NOT NULL,
	`user` text NOT NULL,
	`date` text NOT NULL,
	`outTime` integer,
	`expectedReturn` integer,
	`inTime` integer,
	`durationMinutes` integer,
	`category` text NOT NULL,
	`categoryLabel` text NOT NULL,
	`official` integer DEFAULT true NOT NULL,
	`purpose` text NOT NULL,
	`destination` text,
	`project` text,
	`client` text,
	`remarks` text,
	`status` text DEFAULT 'out' NOT NULL,
	`approvalStatus` text DEFAULT 'not_required' NOT NULL,
	`approver` text,
	`approvedBy` text,
	`approvedByName` text,
	`approvedAt` integer,
	`approvalNote` text,
	`entryMode` text DEFAULT 'live' NOT NULL,
	`enteredBy` text,
	`enteredByName` text,
	`alternativeReason` text,
	`resolvedBy` text,
	`resolvedByName` text,
	`resolutionNote` text,
	`overdueNotifiedAt` integer,
	`corrections` text NOT NULL,
	`history` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `movements_movement_no` ON `movements` (`movementNo`);--> statement-breakpoint
CREATE INDEX `movements_user_date` ON `movements` (`user`,`date`);--> statement-breakpoint
CREATE INDEX `movements_date` ON `movements` (`date`);--> statement-breakpoint
CREATE INDEX `movements_status_expected_return` ON `movements` (`status`,`expectedReturn`);--> statement-breakpoint
CREATE INDEX `movements_approval_status` ON `movements` (`approvalStatus`);--> statement-breakpoint
CREATE TABLE `leavebalances` (
	`_id` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`leaveType` text NOT NULL,
	`year` integer NOT NULL,
	`carriedForward` real DEFAULT 0 NOT NULL,
	`adjustment` real DEFAULT 0 NOT NULL,
	`quotaOverride` real,
	`notes` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leavebalances_user_type_year` ON `leavebalances` (`user`,`leaveType`,`year`);--> statement-breakpoint
CREATE TABLE `leaverequests` (
	`_id` text PRIMARY KEY NOT NULL,
	`requestNo` text NOT NULL,
	`user` text NOT NULL,
	`leaveType` text NOT NULL,
	`leaveTypeName` text,
	`startDate` text NOT NULL,
	`endDate` text NOT NULL,
	`halfDay` integer DEFAULT false NOT NULL,
	`halfDaySession` text,
	`days` real NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending_manager' NOT NULL,
	`manager` text,
	`approvals` text NOT NULL,
	`attachments` text NOT NULL,
	`cancelledAt` integer,
	`cancelReason` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leaverequests_request_no` ON `leaverequests` (`requestNo`);--> statement-breakpoint
CREATE INDEX `leaverequests_user` ON `leaverequests` (`user`);--> statement-breakpoint
CREATE INDEX `leaverequests_start_date` ON `leaverequests` (`startDate`);--> statement-breakpoint
CREATE INDEX `leaverequests_end_date` ON `leaverequests` (`endDate`);--> statement-breakpoint
CREATE INDEX `leaverequests_status` ON `leaverequests` (`status`);--> statement-breakpoint
CREATE INDEX `leaverequests_manager` ON `leaverequests` (`manager`);--> statement-breakpoint
CREATE TABLE `leavetypes` (
	`_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`color` text,
	`annualQuota` real DEFAULT 0 NOT NULL,
	`accrual` text DEFAULT 'upfront' NOT NULL,
	`carryForward` integer DEFAULT false NOT NULL,
	`maxCarryForward` real DEFAULT 0 NOT NULL,
	`paid` integer DEFAULT true NOT NULL,
	`allowHalfDay` integer DEFAULT true NOT NULL,
	`requiresHrApproval` integer DEFAULT false NOT NULL,
	`requiresAttachmentAfterDays` real,
	`applicableTo` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leavetypes_code` ON `leavetypes` (`code`);--> statement-breakpoint
CREATE TABLE `payrollruns` (
	`_id` text PRIMARY KEY NOT NULL,
	`runNo` text NOT NULL,
	`period` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`workingDays` real DEFAULT 0 NOT NULL,
	`notes` text,
	`totals` text NOT NULL,
	`activeKey` text,
	`preparedBy` text,
	`preparedByName` text,
	`verifiedBy` text,
	`verifiedByName` text,
	`verifiedAt` integer,
	`approvedBy` text,
	`approvedByName` text,
	`approvedAt` integer,
	`paidAt` integer,
	`editors` text NOT NULL,
	`history` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payrollruns_run_no` ON `payrollruns` (`runNo`);--> statement-breakpoint
CREATE UNIQUE INDEX `payrollruns_active_key` ON `payrollruns` (`activeKey`);--> statement-breakpoint
CREATE INDEX `payrollruns_period_kind` ON `payrollruns` (`period`,`kind`);--> statement-breakpoint
CREATE INDEX `payrollruns_status` ON `payrollruns` (`status`);--> statement-breakpoint
CREATE TABLE `payslips` (
	`_id` text PRIMARY KEY NOT NULL,
	`run` text NOT NULL,
	`user` text NOT NULL,
	`period` text NOT NULL,
	`kind` text NOT NULL,
	`snapshot` text NOT NULL,
	`workingDays` real DEFAULT 0 NOT NULL,
	`payableDays` real DEFAULT 0 NOT NULL,
	`lopDays` real DEFAULT 0 NOT NULL,
	`presentDays` real DEFAULT 0 NOT NULL,
	`leaveDays` real DEFAULT 0 NOT NULL,
	`basic` real DEFAULT 0 NOT NULL,
	`earnings` text NOT NULL,
	`deductions` text NOT NULL,
	`gross` real DEFAULT 0 NOT NULL,
	`totalDeductions` real DEFAULT 0 NOT NULL,
	`net` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`payment` text,
	`remarks` text,
	`advanceRecoveries` text NOT NULL,
	`reimbursedExpenses` text NOT NULL,
	`history` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payslips_run_user` ON `payslips` (`run`,`user`);--> statement-breakpoint
CREATE INDEX `payslips_run` ON `payslips` (`run`);--> statement-breakpoint
CREATE INDEX `payslips_user` ON `payslips` (`user`);--> statement-breakpoint
CREATE INDEX `payslips_period` ON `payslips` (`period`);--> statement-breakpoint
CREATE TABLE `salaryadvances` (
	`_id` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`amount` real NOT NULL,
	`date` text NOT NULL,
	`reason` text,
	`monthlyRecovery` real DEFAULT 0 NOT NULL,
	`recovered` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`recordedBy` text,
	`recordedByName` text,
	`recoveries` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `salaryadvances_user` ON `salaryadvances` (`user`);--> statement-breakpoint
CREATE TABLE `projects` (
	`_id` text PRIMARY KEY NOT NULL,
	`projectNo` text NOT NULL,
	`title` text NOT NULL,
	`client` text,
	`internal` integer DEFAULT false NOT NULL,
	`description` text,
	`scope` text,
	`deliverables` text NOT NULL,
	`manager` text,
	`team` text NOT NULL,
	`startDate` text,
	`targetDate` text,
	`completedDate` text,
	`budget` real DEFAULT 0 NOT NULL,
	`estimatedHours` real DEFAULT 0 NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`status` text NOT NULL,
	`proposal` text,
	`contract` text,
	`milestones` text NOT NULL,
	`tags` text NOT NULL,
	`attachments` text NOT NULL,
	`comments` text NOT NULL,
	`history` text NOT NULL,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_project_no` ON `projects` (`projectNo`);--> statement-breakpoint
CREATE INDEX `projects_client` ON `projects` (`client`);--> statement-breakpoint
CREATE INDEX `projects_manager` ON `projects` (`manager`);--> statement-breakpoint
CREATE INDEX `projects_status` ON `projects` (`status`);--> statement-breakpoint
CREATE TABLE `issues` (
	`_id` text PRIMARY KEY NOT NULL,
	`issueNo` text NOT NULL,
	`project` text NOT NULL,
	`task` text,
	`title` text NOT NULL,
	`description` text,
	`severity` text DEFAULT 'minor' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`stepsToReproduce` text,
	`environment` text,
	`attachments` text NOT NULL,
	`assignee` text,
	`team` text,
	`reporter` text NOT NULL,
	`reportedDate` text NOT NULL,
	`targetDate` text,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution` text,
	`resolvedAt` integer,
	`verifiedBy` text,
	`closedAt` integer,
	`reopenCount` integer DEFAULT 0 NOT NULL,
	`comments` text NOT NULL,
	`history` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issues_issue_no` ON `issues` (`issueNo`);--> statement-breakpoint
CREATE INDEX `issues_project` ON `issues` (`project`);--> statement-breakpoint
CREATE INDEX `issues_assignee` ON `issues` (`assignee`);--> statement-breakpoint
CREATE INDEX `issues_status` ON `issues` (`status`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`_id` text PRIMARY KEY NOT NULL,
	`taskNo` text NOT NULL,
	`project` text,
	`milestone` text,
	`parent` text,
	`title` text NOT NULL,
	`description` text,
	`assignees` text NOT NULL,
	`sharedWith` text NOT NULL,
	`reporter` text,
	`reviewer` text,
	`priority` text DEFAULT 'medium' NOT NULL,
	`status` text NOT NULL,
	`startDate` text,
	`dueDate` text,
	`completedAt` integer,
	`estimateHours` real DEFAULT 0 NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`dependencies` text NOT NULL,
	`blocker` text,
	`isLearning` integer DEFAULT false NOT NULL,
	`attachments` text NOT NULL,
	`comments` text NOT NULL,
	`submissions` text NOT NULL,
	`history` text NOT NULL,
	`deadlineNotifiedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_task_no` ON `tasks` (`taskNo`);--> statement-breakpoint
CREATE INDEX `tasks_project` ON `tasks` (`project`);--> statement-breakpoint
CREATE INDEX `tasks_parent` ON `tasks` (`parent`);--> statement-breakpoint
CREATE INDEX `tasks_status` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `tasks_due_date` ON `tasks` (`dueDate`);--> statement-breakpoint
CREATE TABLE `timesheetentries` (
	`_id` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`date` text NOT NULL,
	`weekStart` text NOT NULL,
	`project` text,
	`task` text,
	`minutes` integer NOT NULL,
	`description` text NOT NULL,
	`billable` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`submittedAt` integer,
	`reviewer` text,
	`reviewerName` text,
	`reviewedAt` integer,
	`reviewNote` text,
	`history` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `timesheetentries_project` ON `timesheetentries` (`project`);--> statement-breakpoint
CREATE INDEX `timesheetentries_task` ON `timesheetentries` (`task`);--> statement-breakpoint
CREATE INDEX `timesheetentries_status` ON `timesheetentries` (`status`);--> statement-breakpoint
CREATE INDEX `timesheetentries_user_week` ON `timesheetentries` (`user`,`weekStart`);--> statement-breakpoint
CREATE INDEX `timesheetentries_user_date` ON `timesheetentries` (`user`,`date`);--> statement-breakpoint
CREATE TABLE `activities` (
	`_id` text PRIMARY KEY NOT NULL,
	`client` text,
	`lead` text,
	`type` text NOT NULL,
	`subject` text NOT NULL,
	`notes` text,
	`at` integer NOT NULL,
	`dueAt` integer,
	`done` integer DEFAULT true NOT NULL,
	`doneAt` integer,
	`outcome` text,
	`attachments` text NOT NULL,
	`by` text NOT NULL,
	`byName` text,
	`assignedTo` text,
	`reminderSentAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activities_client` ON `activities` (`client`);--> statement-breakpoint
CREATE INDEX `activities_lead` ON `activities` (`lead`);--> statement-breakpoint
CREATE INDEX `activities_due_at` ON `activities` (`dueAt`);--> statement-breakpoint
CREATE INDEX `activities_assigned_to` ON `activities` (`assignedTo`);--> statement-breakpoint
CREATE TABLE `clients` (
	`_id` text PRIMARY KEY NOT NULL,
	`clientNo` text NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'company' NOT NULL,
	`contactPerson` text,
	`contactDesignation` text,
	`email` text,
	`phone` text,
	`altPhone` text,
	`website` text,
	`industry` text,
	`gstin` text,
	`address` text,
	`leadSource` text,
	`owner` text,
	`status` text DEFAULT 'prospect' NOT NULL,
	`confidential` integer DEFAULT false NOT NULL,
	`notes` text,
	`contacts` text NOT NULL,
	`attachments` text NOT NULL,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_client_no` ON `clients` (`clientNo`);--> statement-breakpoint
CREATE INDEX `clients_owner` ON `clients` (`owner`);--> statement-breakpoint
CREATE INDEX `clients_status` ON `clients` (`status`);--> statement-breakpoint
CREATE TABLE `leads` (
	`_id` text PRIMARY KEY NOT NULL,
	`leadNo` text NOT NULL,
	`title` text NOT NULL,
	`client` text,
	`companyName` text NOT NULL,
	`contactName` text,
	`email` text,
	`phone` text,
	`requirement` text,
	`budget` real,
	`expectedValue` real,
	`source` text,
	`assignedTo` text,
	`stage` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`lostReason` text,
	`nextFollowUp` integer,
	`expectedCloseDate` text,
	`proposal` text,
	`project` text,
	`convertedAt` integer,
	`closedAt` integer,
	`attachments` text NOT NULL,
	`history` text NOT NULL,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_lead_no` ON `leads` (`leadNo`);--> statement-breakpoint
CREATE INDEX `leads_client` ON `leads` (`client`);--> statement-breakpoint
CREATE INDEX `leads_assigned_to` ON `leads` (`assignedTo`);--> statement-breakpoint
CREATE INDEX `leads_stage` ON `leads` (`stage`);--> statement-breakpoint
CREATE INDEX `leads_status` ON `leads` (`status`);--> statement-breakpoint
CREATE INDEX `leads_next_follow_up` ON `leads` (`nextFollowUp`);--> statement-breakpoint
CREATE TABLE `contracts` (
	`_id` text PRIMARY KEY NOT NULL,
	`contractNo` text NOT NULL,
	`title` text NOT NULL,
	`client` text NOT NULL,
	`project` text,
	`proposal` text,
	`type` text,
	`startDate` text,
	`endDate` text,
	`value` real DEFAULT 0 NOT NULL,
	`signedOn` text,
	`status` text DEFAULT 'active' NOT NULL,
	`confidential` integer DEFAULT true NOT NULL,
	`renewalReminderDays` integer DEFAULT 30 NOT NULL,
	`autoRenew` integer DEFAULT false NOT NULL,
	`notes` text,
	`attachments` text NOT NULL,
	`renewedFrom` text,
	`reminderSentAt` integer,
	`history` text NOT NULL,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contracts_contract_no` ON `contracts` (`contractNo`);--> statement-breakpoint
CREATE INDEX `contracts_client` ON `contracts` (`client`);--> statement-breakpoint
CREATE INDEX `contracts_end_date` ON `contracts` (`endDate`);--> statement-breakpoint
CREATE INDEX `contracts_status` ON `contracts` (`status`);--> statement-breakpoint
CREATE TABLE `proposals` (
	`_id` text PRIMARY KEY NOT NULL,
	`proposalNo` text NOT NULL,
	`kind` text DEFAULT 'proposal' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`client` text NOT NULL,
	`lead` text,
	`title` text NOT NULL,
	`summary` text,
	`scope` text,
	`deliverables` text NOT NULL,
	`timeline` text,
	`startDate` text,
	`endDate` text,
	`items` text NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`taxTotal` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`paymentMilestones` text NOT NULL,
	`terms` text,
	`validUntil` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`sentAt` integer,
	`decidedAt` integer,
	`decisionNote` text,
	`approvedBy` text,
	`approvedByName` text,
	`project` text,
	`attachments` text NOT NULL,
	`revisions` text NOT NULL,
	`history` text NOT NULL,
	`owner` text,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proposals_proposal_no` ON `proposals` (`proposalNo`);--> statement-breakpoint
CREATE INDEX `proposals_client` ON `proposals` (`client`);--> statement-breakpoint
CREATE INDEX `proposals_status` ON `proposals` (`status`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`_id` text PRIMARY KEY NOT NULL,
	`expenseNo` text NOT NULL,
	`user` text NOT NULL,
	`date` text NOT NULL,
	`category` text NOT NULL,
	`department` text,
	`project` text,
	`client` text,
	`vendor` text,
	`amount` real NOT NULL,
	`taxAmount` real DEFAULT 0 NOT NULL,
	`description` text NOT NULL,
	`type` text DEFAULT 'reimbursable' NOT NULL,
	`paymentMode` text,
	`receipts` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`submittedAt` integer,
	`approver` text,
	`approverName` text,
	`decidedAt` integer,
	`decisionNote` text,
	`payment` text,
	`history` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expenses_expense_no` ON `expenses` (`expenseNo`);--> statement-breakpoint
CREATE INDEX `expenses_user` ON `expenses` (`user`);--> statement-breakpoint
CREATE INDEX `expenses_date` ON `expenses` (`date`);--> statement-breakpoint
CREATE INDEX `expenses_project` ON `expenses` (`project`);--> statement-breakpoint
CREATE INDEX `expenses_status` ON `expenses` (`status`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`_id` text PRIMARY KEY NOT NULL,
	`invoiceNo` text,
	`draftNo` text NOT NULL,
	`client` text NOT NULL,
	`project` text,
	`contract` text,
	`milestone` text,
	`issueDate` text NOT NULL,
	`dueDate` text NOT NULL,
	`paymentTermDays` integer DEFAULT 15 NOT NULL,
	`items` text NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`taxTotal` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`amountPaid` real DEFAULT 0 NOT NULL,
	`amountRefunded` real DEFAULT 0 NOT NULL,
	`adjustments` real DEFAULT 0 NOT NULL,
	`balance` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`notes` text,
	`terms` text,
	`placeOfSupply` text,
	`billingSnapshot` text,
	`issuedAt` integer,
	`cancelledAt` integer,
	`cancelReason` text,
	`overdueNotifiedAt` integer,
	`dueReminderSentAt` integer,
	`history` text NOT NULL,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_invoice_no` ON `invoices` (`invoiceNo`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_draft_no` ON `invoices` (`draftNo`);--> statement-breakpoint
CREATE INDEX `invoices_client` ON `invoices` (`client`);--> statement-breakpoint
CREATE INDEX `invoices_project` ON `invoices` (`project`);--> statement-breakpoint
CREATE INDEX `invoices_due_date` ON `invoices` (`dueDate`);--> statement-breakpoint
CREATE INDEX `invoices_status` ON `invoices` (`status`);--> statement-breakpoint
CREATE TABLE `payments` (
	`_id` text PRIMARY KEY NOT NULL,
	`paymentNo` text NOT NULL,
	`invoice` text NOT NULL,
	`client` text NOT NULL,
	`project` text,
	`type` text DEFAULT 'payment' NOT NULL,
	`date` text NOT NULL,
	`amount` real NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`note` text,
	`recordedBy` text NOT NULL,
	`recordedByName` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_payment_no` ON `payments` (`paymentNo`);--> statement-breakpoint
CREATE INDEX `payments_invoice` ON `payments` (`invoice`);--> statement-breakpoint
CREATE INDEX `payments_client` ON `payments` (`client`);--> statement-breakpoint
CREATE INDEX `payments_date` ON `payments` (`date`);--> statement-breakpoint
CREATE TABLE `announcements` (
	`_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`audience` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`publishedBy` text NOT NULL,
	`publishedByName` text,
	`expiresOn` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`_id` text PRIMARY KEY NOT NULL,
	`assetNo` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`brand` text,
	`model` text,
	`serialNo` text,
	`purchaseDate` text,
	`cost` real DEFAULT 0 NOT NULL,
	`vendor` text,
	`invoiceRef` text,
	`warrantyUntil` text,
	`serviceProvider` text,
	`nextServiceDate` text,
	`assignedTo` text,
	`department` text,
	`location` text,
	`condition` text DEFAULT 'good' NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`notes` text,
	`documents` text NOT NULL,
	`history` text NOT NULL,
	`reminderSentAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_asset_no` ON `assets` (`assetNo`);--> statement-breakpoint
CREATE INDEX `assets_warranty_until` ON `assets` (`warrantyUntil`);--> statement-breakpoint
CREATE INDEX `assets_next_service_date` ON `assets` (`nextServiceDate`);--> statement-breakpoint
CREATE INDEX `assets_assigned_to` ON `assets` (`assignedTo`);--> statement-breakpoint
CREATE INDEX `assets_status` ON `assets` (`status`);--> statement-breakpoint
CREATE TABLE `learningresources` (
	`_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`kind` text DEFAULT 'link' NOT NULL,
	`url` text,
	`attachments` text NOT NULL,
	`audience` text NOT NULL,
	`department` text,
	`assignedTo` text NOT NULL,
	`dueDate` text,
	`estimatedHours` real,
	`completions` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`createdBy` text NOT NULL,
	`createdByName` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`_id` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`link` text,
	`priority` text DEFAULT 'normal' NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`readAt` integer,
	`dedupeKey` text,
	`actionable` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notifications_user_read_created` ON `notifications` (`user`,`read`,`createdAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_user_dedupe_key` ON `notifications` (`user`,`dedupeKey`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`_id` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`reviewer` text NOT NULL,
	`reviewerName` text,
	`periodLabel` text NOT NULL,
	`date` text NOT NULL,
	`ratings` text NOT NULL,
	`overall` real,
	`strengths` text,
	`improvements` text,
	`actionItems` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`acknowledgedAt` integer,
	`internComment` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reviews_user` ON `reviews` (`user`);--> statement-breakpoint
CREATE TABLE `projectvaults` (
	`_id` text PRIMARY KEY NOT NULL,
	`project` text NOT NULL,
	`wrappedKey` text NOT NULL,
	`masterKeyId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projectvaults_project` ON `projectvaults` (`project`);--> statement-breakpoint
CREATE TABLE `vaultevents` (
	`_id` text PRIMARY KEY NOT NULL,
	`project` text NOT NULL,
	`item` text,
	`itemName` text NOT NULL,
	`field` text,
	`action` text NOT NULL,
	`user` text NOT NULL,
	`userName` text NOT NULL,
	`ip` text,
	`userAgent` text,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vaultevents_project` ON `vaultevents` (`project`);--> statement-breakpoint
CREATE INDEX `vaultevents_item` ON `vaultevents` (`item`);--> statement-breakpoint
CREATE INDEX `vaultevents_user` ON `vaultevents` (`user`);--> statement-breakpoint
CREATE INDEX `vaultevents_at` ON `vaultevents` (`at`);--> statement-breakpoint
CREATE TABLE `vaultitems` (
	`_id` text PRIMARY KEY NOT NULL,
	`project` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`environment` text,
	`ciphertext` text NOT NULL,
	`entryCount` integer DEFAULT 0 NOT NULL,
	`audience` text DEFAULT 'team' NOT NULL,
	`members` text NOT NULL,
	`notifyOnReveal` integer DEFAULT false NOT NULL,
	`rotateBy` text,
	`rotationAdvisedAt` integer,
	`rotationAdvisedReason` text,
	`version` integer DEFAULT 1 NOT NULL,
	`valuesUpdatedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`updatedBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vaultitems_project` ON `vaultitems` (`project`);--> statement-breakpoint
CREATE INDEX `vaultitems_project_kind_name` ON `vaultitems` (`project`,`kind`,`name`);