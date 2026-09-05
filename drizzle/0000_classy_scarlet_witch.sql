CREATE TABLE `experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`lease_token` text,
	`lease_until` integer
);
--> statement-breakpoint
CREATE INDEX `idx_experiments_owner_created` ON `experiments` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `releases` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`experiment_id` text NOT NULL,
	`architecture_digest` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_releases_owner_created` ON `releases` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_releases_owner_experiment` ON `releases` (`owner_id`,`experiment_id`);