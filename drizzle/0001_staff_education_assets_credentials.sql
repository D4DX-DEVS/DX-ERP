CREATE TABLE `education` (
	`_id` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`level` text NOT NULL,
	`qualification` text NOT NULL,
	`institution` text,
	`board` text,
	`startYear` integer,
	`endYear` integer,
	`score` text,
	`status` text DEFAULT 'completed' NOT NULL,
	`certificates` text NOT NULL,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `education_user` ON `education` (`user`);--> statement-breakpoint
CREATE TABLE `credentials` (
	`_id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`url` text,
	`ciphertext` text NOT NULL,
	`createdBy` text,
	`updatedBy` text,
	`valuesUpdatedAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `credentials_platform` ON `credentials` (`platform`);--> statement-breakpoint
ALTER TABLE `users` ADD `whatsapp` text;--> statement-breakpoint
ALTER TABLE `users` ADD `contractStart` text;--> statement-breakpoint
ALTER TABLE `users` ADD `contractEnd` text;--> statement-breakpoint
ALTER TABLE `users` ADD `documentUploadOpen` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `users_contract_end` ON `users` (`contractEnd`);--> statement-breakpoint
ALTER TABLE `assets` ADD `kind` text DEFAULT 'staff' NOT NULL;--> statement-breakpoint
CREATE INDEX `assets_kind` ON `assets` (`kind`);--> statement-breakpoint
-- Gender is male / female only: normalise case, clear any other stored value.
UPDATE `users` SET `gender` = lower(trim(`gender`)) WHERE `gender` IS NOT NULL;--> statement-breakpoint
UPDATE `users` SET `gender` = NULL WHERE `gender` IS NOT NULL AND `gender` NOT IN ('male', 'female');
