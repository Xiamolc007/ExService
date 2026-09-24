INSERT OR IGNORE INTO `community_groups` (`code`, `display_name`) VALUES ('admin', '管理员');
--> statement-breakpoint
DELETE FROM `community_group_memberships` WHERE `group_code` = 'general';
--> statement-breakpoint
DELETE FROM `community_groups` WHERE `code` = 'general';
