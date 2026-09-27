CREATE TABLE `join_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`nickname` text NOT NULL,
	`qq` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`reviewed_at` integer,
	`reviewed_by_user_id` text,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "join_applications_status_check" CHECK("join_applications"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "join_applications_review_check" CHECK(("join_applications"."status" = 'pending' and "join_applications"."reviewed_at" is null) or ("join_applications"."status" <> 'pending' and "join_applications"."reviewed_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `join_applications_open_email_unique` ON `join_applications` (`email`) WHERE "join_applications"."status" in ('pending', 'approved');--> statement-breakpoint
CREATE INDEX `join_applications_list_idx` ON `join_applications` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `join_delivery_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`invitation_id` text NOT NULL,
	`code_version` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	FOREIGN KEY (`invitation_id`) REFERENCES `join_invitations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "join_delivery_attempts_status_check" CHECK("join_delivery_attempts"."status" in ('pending', 'sent', 'failed')),
	CONSTRAINT "join_delivery_attempts_finished_check" CHECK(("join_delivery_attempts"."status" = 'pending' and "join_delivery_attempts"."finished_at" is null) or ("join_delivery_attempts"."status" <> 'pending' and "join_delivery_attempts"."finished_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `join_delivery_attempts_version_unique` ON `join_delivery_attempts` (`invitation_id`,`code_version`);--> statement-breakpoint
CREATE TABLE `join_email_controls` (
	`email` text PRIMARY KEY NOT NULL,
	`next_send_at` integer NOT NULL,
	`failure_window_started_at` integer,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "join_email_controls_failures_check" CHECK("join_email_controls"."failed_attempts" between 0 and 5)
);
--> statement-breakpoint
CREATE TABLE `join_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`status` text NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`code_version` integer NOT NULL,
	`code_digest` text,
	`code_expires_at` integer,
	`completion_token_hash` text,
	`completion_expires_at` integer,
	`completed_user_id` text,
	`completed_at` integer,
	FOREIGN KEY (`application_id`) REFERENCES `join_applications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`completed_user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "join_invitations_status_check" CHECK("join_invitations"."status" in ('active', 'expired', 'completed')),
	CONSTRAINT "join_invitations_version_check" CHECK("join_invitations"."code_version" >= 1),
	CONSTRAINT "join_invitations_completion_check" CHECK(("join_invitations"."status" = 'completed' and "join_invitations"."completed_user_id" is not null and "join_invitations"."completed_at" is not null) or ("join_invitations"."status" <> 'completed' and "join_invitations"."completed_user_id" is null and "join_invitations"."completed_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `join_invitations_active_application_unique` ON `join_invitations` (`application_id`) WHERE "join_invitations"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `join_invitations_completion_token_unique` ON `join_invitations` (`completion_token_hash`);--> statement-breakpoint
CREATE INDEX `join_invitations_application_idx` ON `join_invitations` (`application_id`,`issued_at`,`id`);--> statement-breakpoint
CREATE INDEX `join_invitations_expires_idx` ON `join_invitations` (`expires_at`);--> statement-breakpoint
INSERT INTO `join_email_controls` (`email`, `next_send_at`, `failed_attempts`) SELECT `email`, `next_send_at`, 0 FROM `auth_email_delivery`;
--> statement-breakpoint
DROP TABLE `auth_email_delivery`;--> statement-breakpoint
DROP TABLE `auth_registrations`;