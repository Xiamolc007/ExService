CREATE TABLE `auth_email_delivery` (
	`email` text PRIMARY KEY NOT NULL,
	`next_send_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_registrations` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`nickname` text,
	`qq` text,
	`password_hash` text,
	`code_digest` text,
	`status` text NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`last_sent_at` integer NOT NULL,
	`code_expires_at` integer NOT NULL,
	`retain_until` integer NOT NULL,
	`completed_user_id` text,
	`completed_at` integer,
	FOREIGN KEY (`completed_user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "auth_registrations_status_check" CHECK("auth_registrations"."status" in ('pending', 'completed', 'cancelled', 'expired')),
	CONSTRAINT "auth_registrations_failed_attempts_check" CHECK("auth_registrations"."failed_attempts" between 0 and 5)
);
--> statement-breakpoint
CREATE INDEX `auth_registrations_email_idx` ON `auth_registrations` (`email`);--> statement-breakpoint
CREATE INDEX `auth_registrations_retain_until_idx` ON `auth_registrations` (`retain_until`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_id_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_sessions_expires_at_idx` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `auth_sso_requests` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`status` text NOT NULL,
	`user_id` text,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "auth_sso_requests_status_check" CHECK("auth_sso_requests"."status" in ('pending', 'completed'))
);
--> statement-breakpoint
CREATE INDEX `auth_sso_requests_expires_at_idx` ON `auth_sso_requests` (`expires_at`);--> statement-breakpoint
CREATE TABLE `auth_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`nickname` text NOT NULL,
	`qq` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_users_email_unique` ON `auth_users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_users_qq_unique` ON `auth_users` (`qq`);