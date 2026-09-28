ALTER TABLE `agent_runs` ADD `mode` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `error` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `pending_status` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `steps` integer DEFAULT 0 NOT NULL;