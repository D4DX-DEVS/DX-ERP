CREATE TABLE `compoffclaims` (
	`_id` text PRIMARY KEY NOT NULL,
	`claimNo` text NOT NULL,
	`user` text NOT NULL,
	`leaveType` text NOT NULL,
	`workDate` text NOT NULL,
	`days` real NOT NULL,
	`workMinutes` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`manager` text,
	`creditYear` integer NOT NULL,
	`decidedBy` text,
	`decidedByName` text,
	`decidedAt` integer,
	`decisionNote` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compoffclaims_claim_no` ON `compoffclaims` (`claimNo`);--> statement-breakpoint
CREATE INDEX `compoffclaims_user` ON `compoffclaims` (`user`);--> statement-breakpoint
CREATE INDEX `compoffclaims_status` ON `compoffclaims` (`status`);--> statement-breakpoint
CREATE INDEX `compoffclaims_manager` ON `compoffclaims` (`manager`);--> statement-breakpoint
ALTER TABLE `leavetypes` ADD `kind` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
-- The seeded compensatory leave type is earned through comp-off claims.
UPDATE `leavetypes` SET `kind` = 'comp_off' WHERE `code` = 'CO';--> statement-breakpoint
-- Optional holidays: 2 per leave year, taken only on the admin's optional holiday dates. Ids keep the ObjectId layout.
INSERT INTO `leavetypes` (`_id`, `name`, `code`, `color`, `annualQuota`, `accrual`, `kind`, `carryForward`, `maxCarryForward`, `paid`, `allowHalfDay`, `requiresHrApproval`, `applicableTo`, `active`, `order`, `createdAt`, `updatedAt`)
SELECT
	printf('%08x', CAST(strftime('%s', 'now') AS INTEGER)) || lower(hex(randomblob(8))),
	'Optional holiday', 'OH', '#0E7490', 2, 'upfront', 'optional_holiday', 0, 0, 1, 0, 0, '["employee","trainee","intern"]', 1,
	coalesce((SELECT max(`order`) FROM `leavetypes`), 0) + 1,
	CAST(strftime('%s', 'now') AS INTEGER) * 1000,
	CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM `leavetypes` WHERE `code` = 'OH' OR `kind` = 'optional_holiday');
