CREATE TABLE `project_chat_reads` (
	`_id` text PRIMARY KEY NOT NULL,
	`project` text NOT NULL,
	`user` text NOT NULL,
	`lastReadAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_messages` (
	`_id` text PRIMARY KEY NOT NULL,
	`project` text NOT NULL,
	`user` text NOT NULL,
	`userName` text NOT NULL,
	`text` text,
	`mentions` text NOT NULL,
	`replyTo` text,
	`voice` text,
	`deletedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_messages_project_created` ON `project_messages` (`project`,`createdAt`);--> statement-breakpoint
CREATE INDEX `project_messages_project_updated` ON `project_messages` (`project`,`updatedAt`);--> statement-breakpoint
-- Invoice numbers are automatic now (INV0001 … taken when issued): drafts drop any number typed by hand earlier.
UPDATE `invoices` SET `invoiceNo` = NULL WHERE `status` = 'draft';--> statement-breakpoint
-- New standard invoice terms, in Configuration and on invoices that still carry the old standard text.
UPDATE `settings` SET `value` = json_set(`value`, '$.documents.invoiceTerms', 'Payment is due by the specified date. Please include the invoice number with your payment.') WHERE `_id` = 'global' AND json_extract(`value`, '$.documents.invoiceTerms') = 'Payment is due by the due date shown. Please quote the invoice number with your payment.';--> statement-breakpoint
UPDATE `invoices` SET `terms` = 'Payment is due by the specified date. Please include the invoice number with your payment.' WHERE `terms` = 'Payment is due by the due date shown. Please quote the invoice number with your payment.';--> statement-breakpoint
-- Passport size photo document category, first in a saved category list (a list that was never saved uses the code defaults).
UPDATE `settings` SET `value` = json_set(`value`, '$.documentCategories', (
  SELECT json_group_array(json(`cat`)) FROM (
    SELECT '{"key":"passport_photo","label":"Passport size photo","required":true,"appliesTo":["employee","trainee","intern"],"hasExpiry":false,"confidential":false}' AS `cat`, -1 AS `ord`
    UNION ALL
    SELECT `value`, `key` FROM json_each(`settings`.`value`, '$.documentCategories')
    ORDER BY `ord`
  )
)) WHERE `_id` = 'global' AND json_type(`value`, '$.documentCategories') = 'array' AND NOT EXISTS (
  SELECT 1 FROM json_each(`settings`.`value`, '$.documentCategories') WHERE json_extract(`value`, '$.key') = 'passport_photo'
);
