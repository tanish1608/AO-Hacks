CREATE TABLE `workflow_publications` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked` integer DEFAULT 0 NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`max_uses` integer DEFAULT 10 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_publications_owner_chat` ON `workflow_publications` (`owner_id`,`chat_id`);