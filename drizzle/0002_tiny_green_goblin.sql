CREATE TABLE `agent_run_metrics` (
	`run_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`experiment_id` text,
	`arm` integer,
	`use_memory` integer NOT NULL,
	`status` text NOT NULL,
	`attempts` integer NOT NULL,
	`passed` integer NOT NULL,
	`score` real,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cost_usd` real,
	`duration_ms` integer NOT NULL,
	`tool_calls` integer NOT NULL,
	`tool_errors` integer NOT NULL,
	`search_calls` integer NOT NULL,
	`search_cached` integer NOT NULL,
	`graph_digest` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_agent_run_metrics_chat` ON `agent_run_metrics` (`owner_id`,`chat_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `tool_knowledge` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`toolkit` text NOT NULL,
	`slug` text NOT NULL,
	`kind` text NOT NULL,
	`claim` text NOT NULL,
	`detail` text NOT NULL,
	`status` text NOT NULL,
	`observations` integer DEFAULT 1 NOT NULL,
	`successes` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`applied_runs` integer DEFAULT 0 NOT NULL,
	`first_run` text NOT NULL,
	`last_run` text NOT NULL,
	`confirmed_run` text,
	`evidence` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tool_knowledge_owner_toolkit` ON `tool_knowledge` (`owner_id`,`toolkit`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_tool_knowledge_owner_status` ON `tool_knowledge` (`owner_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `tool_schema_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`toolkits` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tool_schema_cache_owner` ON `tool_schema_cache` (`owner_id`,`expires_at`);