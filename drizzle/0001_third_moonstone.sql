CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_agent_runs_chat` ON `agent_runs` (`owner_id`,`chat_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`lease_token` text,
	`lease_until` integer
);
--> statement-breakpoint
CREATE INDEX `idx_chats_owner_updated` ON `chats` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `integration_sessions` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tool_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`run_id` text NOT NULL,
	`state` text NOT NULL,
	`payload` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tool_receipts_chat` ON `tool_receipts` (`owner_id`,`chat_id`);