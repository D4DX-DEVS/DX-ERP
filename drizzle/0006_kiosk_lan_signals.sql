CREATE TABLE `kiosk_lan_signals` (
	`_id` text PRIMARY KEY NOT NULL,
	`kiosk` text NOT NULL,
	`user` text NOT NULL,
	`offer` text NOT NULL,
	`answer` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `kiosk_lan_signals_kiosk` ON `kiosk_lan_signals` (`kiosk`,`createdAt`);--> statement-breakpoint
CREATE INDEX `kiosk_lan_signals_user` ON `kiosk_lan_signals` (`user`);