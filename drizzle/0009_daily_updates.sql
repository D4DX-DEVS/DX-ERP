CREATE TABLE `dailyupdates` (
	`_id` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`date` text NOT NULL,
	`project` text NOT NULL,
	`points` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dailyupdates_user_date_project` ON `dailyupdates` (`user`,`date`,`project`);--> statement-breakpoint
CREATE INDEX `dailyupdates_date` ON `dailyupdates` (`date`);--> statement-breakpoint
CREATE INDEX `dailyupdates_project` ON `dailyupdates` (`project`);--> statement-breakpoint
-- New permission: management and HR see everyone's daily updates (roles saved before it existed don't list it yet).
UPDATE `roles` SET `permissions` = json_insert(`permissions`, '$[#]', 'daily_updates.view_all') WHERE `key` IN ('management', 'hr') AND NOT EXISTS (SELECT 1 FROM json_each(`roles`.`permissions`) WHERE `value` = 'daily_updates.view_all');
