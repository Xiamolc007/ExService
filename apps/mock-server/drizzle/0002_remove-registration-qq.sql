DROP INDEX `auth_users_qq_unique`;--> statement-breakpoint
ALTER TABLE `auth_users` DROP COLUMN `qq`;--> statement-breakpoint
ALTER TABLE `auth_registrations` DROP COLUMN `qq`;