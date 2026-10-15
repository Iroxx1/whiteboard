ALTER TABLE `boards` ADD `tags_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `boards` ADD `thumb_at` integer;