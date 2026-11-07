ALTER TABLE `payments` ADD `receiptNo` text;--> statement-breakpoint
CREATE UNIQUE INDEX `payments_receipt_no` ON `payments` (`receiptNo`);