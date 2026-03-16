CREATE TABLE `clicks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`link_id` integer NOT NULL,
	`country` text,
	`city` text,
	`device` text,
	`browser` text,
	`os` text,
	`referer` text,
	`ip` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`link_id`) REFERENCES `links`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_clicks_link` ON `clicks` (`link_id`);--> statement-breakpoint
CREATE INDEX `idx_clicks_created` ON `clicks` (`created_at`);--> statement-breakpoint
CREATE TABLE `domains` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_domain_unique` ON `domains` (`domain`);--> statement-breakpoint
CREATE TABLE `links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`url` text NOT NULL,
	`domain_id` integer NOT NULL,
	`password` text,
	`expires_at` integer,
	`max_clicks` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_links_slug_domain` ON `links` (`slug`,`domain_id`);--> statement-breakpoint
CREATE INDEX `idx_links_domain` ON `links` (`domain_id`);