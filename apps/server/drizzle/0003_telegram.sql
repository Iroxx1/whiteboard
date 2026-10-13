CREATE TABLE `telegram_link_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `telegram_links` (
	`user_id` text PRIMARY KEY NOT NULL,
	`telegram_user_id` integer NOT NULL,
	`username` text,
	`linked_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_links_telegram_user_id_unique` ON `telegram_links` (`telegram_user_id`);--> statement-breakpoint
CREATE TABLE `telegram_messages` (
	`chat_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`kind` text DEFAULT 'reply' NOT NULL,
	`item_ids` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_messages_unique` ON `telegram_messages` (`chat_id`,`message_id`);