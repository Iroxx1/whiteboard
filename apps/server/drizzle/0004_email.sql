CREATE TABLE `inbound_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`received_at` integer NOT NULL,
	`user_id` text,
	`message_id` text,
	`path` text,
	`size` integer NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`item_ids` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `inbound_emails_message_idx` ON `inbound_emails` (`message_id`);--> statement-breakpoint
CREATE INDEX `inbound_emails_received_idx` ON `inbound_emails` (`received_at`);--> statement-breakpoint
CREATE TABLE `user_senders` (
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`email_normalized` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_senders_email_normalized_unique` ON `user_senders` (`email_normalized`);--> statement-breakpoint
CREATE INDEX `user_senders_user_idx` ON `user_senders` (`user_id`);