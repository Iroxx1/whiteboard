CREATE TABLE `share_requests` (
	`client_share_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`item_ids` text DEFAULT '{}' NOT NULL,
	`group_id` text NOT NULL,
	`note` text,
	`title` text,
	`target_board_id` text,
	`file_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
