CREATE TABLE `attendance_kiosks` (
	`_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tokenHash` text NOT NULL,
	`codeSalt` text NOT NULL,
	`deviceId` text,
	`boundAt` integer,
	`lastSeenAt` integer,
	`networks` text NOT NULL,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_kiosks_token` ON `attendance_kiosks` (`tokenHash`);