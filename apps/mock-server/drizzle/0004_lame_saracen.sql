CREATE TABLE `community_groups` (
	`code` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `community_group_memberships` (
	`user_id` text NOT NULL,
	`group_code` text NOT NULL,
	PRIMARY KEY(`user_id`, `group_code`),
	FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_code`) REFERENCES `community_groups`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `community_groups` (`code`, `display_name`) VALUES ('general', '通用');
--> statement-breakpoint
INSERT INTO `community_group_memberships` (`user_id`, `group_code`)
SELECT `id`, 'general' FROM `auth_users`;
