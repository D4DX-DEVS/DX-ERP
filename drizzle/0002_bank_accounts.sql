CREATE TABLE `bank_accounts` (
	`_id` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`accountHolder` text NOT NULL,
	`bankName` text NOT NULL,
	`branch` text,
	`accountNumber` text NOT NULL,
	`ifsc` text NOT NULL,
	`accountType` text DEFAULT 'savings' NOT NULL,
	`isPrimary` integer DEFAULT false NOT NULL,
	`documents` text NOT NULL,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bank_accounts_user` ON `bank_accounts` (`user`);--> statement-breakpoint
-- Existing single bank record (users.bank) becomes each person's primary (salary) account. Ids keep the ObjectId layout.
INSERT INTO `bank_accounts` (`_id`, `user`, `accountHolder`, `bankName`, `accountNumber`, `ifsc`, `accountType`, `isPrimary`, `documents`, `createdAt`, `updatedAt`)
SELECT
	printf('%08x', CAST(strftime('%s', 'now') AS INTEGER)) || lower(hex(randomblob(8))),
	`_id`,
	coalesce(nullif(trim(json_extract(`bank`, '$.accountName')), ''), `name`),
	coalesce(trim(json_extract(`bank`, '$.bankName')), ''),
	replace(replace(trim(json_extract(`bank`, '$.accountNumber')), ' ', ''), '-', ''),
	upper(coalesce(trim(json_extract(`bank`, '$.ifsc')), '')),
	'savings',
	1,
	'[]',
	CAST(strftime('%s', 'now') AS INTEGER) * 1000,
	CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `users`
WHERE json_valid(`bank`) AND trim(coalesce(json_extract(`bank`, '$.accountNumber'), '')) != '';
