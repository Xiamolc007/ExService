ALTER TABLE `auth_users` ADD `qq` text;--> statement-breakpoint
ALTER TABLE `auth_users` ADD `fivem_id` text;--> statement-breakpoint
ALTER TABLE `auth_users` ADD `avatar_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `auth_users_avatar_key_unique` ON `auth_users` (`avatar_key`);