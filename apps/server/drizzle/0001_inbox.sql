CREATE TABLE `item_placements` (
	`item_id` text NOT NULL,
	`board_id` text NOT NULL,
	`element_id` text NOT NULL,
	`placed_at` integer NOT NULL,
	`placed_by` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`placed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_placements_unique` ON `item_placements` (`board_id`,`element_id`);--> statement-breakpoint
CREATE INDEX `item_placements_item_idx` ON `item_placements` (`item_id`);--> statement-breakpoint
CREATE TABLE `item_texts` (
	`item_id` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_texts_unique` ON `item_texts` (`item_id`,`kind`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'inbox' NOT NULL,
	`title` text,
	`note` text,
	`url` text,
	`url_normalized` text,
	`group_id` text,
	`target_board_id` text,
	`lease_owner` text,
	`lease_until` integer,
	`processing` text DEFAULT 'pending' NOT NULL,
	`processing_error` text,
	`meta_json` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL,
	`trashed_at` integer,
	`status_before_trash` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `items_status_idx` ON `items` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `items_url_idx` ON `items` (`url_normalized`);--> statement-breakpoint
CREATE INDEX `items_group_idx` ON `items` (`group_id`);--> statement-breakpoint
CREATE INDEX `items_target_idx` ON `items` (`target_board_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`run_after` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE INDEX `assets_item_idx` ON `assets` (`item_id`);