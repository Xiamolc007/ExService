-- Refuse to silently normalize or discard existing historical records.
CREATE TEMP TABLE `join_application_migration_guard` (
  `valid` integer NOT NULL,
  CONSTRAINT "join_history_normalization_required" CHECK (`valid` = 1)
);
--> statement-breakpoint
INSERT INTO `join_application_migration_guard` (`valid`)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM join_applications WHERE email <> lower(email)
    OR email <> trim(email, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))
) OR EXISTS (SELECT 1 FROM pragma_foreign_key_check) THEN 0 ELSE 1 END;
--> statement-breakpoint
DROP TABLE `join_application_migration_guard`;
--> statement-breakpoint
ALTER TABLE `join_applications` ADD COLUMN `form_version` integer NOT NULL DEFAULT 0 CONSTRAINT "join_applications_form_version_check" CHECK (`form_version` IN (0, 1));
--> statement-breakpoint
CREATE TABLE `join_application_attachments` (
  `id` text PRIMARY KEY NOT NULL, `application_id` text NOT NULL, `ordinal` integer NOT NULL,
  `original_name` text NOT NULL, `extension` text NOT NULL, `sha256` text NOT NULL,
  `byte_length` integer NOT NULL, `bytes` blob NOT NULL,
  FOREIGN KEY (`application_id`) REFERENCES `join_applications`(`id`) ON UPDATE restrict ON DELETE restrict,
  CONSTRAINT "join_application_attachments_ordinal_check" CHECK(`ordinal` between 0 and 4),
  CONSTRAINT "join_application_attachments_length_check" CHECK(`byte_length` between 1 and 10485760 and `byte_length` = length(`bytes`)),
  CONSTRAINT "join_application_attachments_sha256_check" CHECK(length(`sha256`) = 64 and `sha256` not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `join_application_attachments_ordinal_unique` ON `join_application_attachments` (`application_id`,`ordinal`);
--> statement-breakpoint
CREATE TABLE `join_application_email_registry` (
  `email` text PRIMARY KEY NOT NULL, `canonical_application_id` text NOT NULL,
  FOREIGN KEY (`canonical_application_id`) REFERENCES `join_applications`(`id`) ON UPDATE restrict ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `join_application_forms` (
  `application_id` text PRIMARY KEY NOT NULL, `version` integer NOT NULL,
  `application_type` text NOT NULL, `form_json` text NOT NULL,
  FOREIGN KEY (`application_id`) REFERENCES `join_applications`(`id`) ON UPDATE restrict ON DELETE restrict,
  CONSTRAINT "join_application_forms_version_check" CHECK(`version` = 1),
  CONSTRAINT "join_application_forms_type_check" CHECK(`application_type` in ('new', 'experienced'))
);
--> statement-breakpoint
CREATE INDEX `join_applications_email_history_idx` ON `join_applications` (`email`,`created_at`,`id`);
--> statement-breakpoint
INSERT INTO `join_application_email_registry` (`email`, `canonical_application_id`)
SELECT a.email, a.id FROM join_applications a
WHERE NOT EXISTS (
  SELECT 1 FROM join_applications newer WHERE newer.email = a.email
    AND (newer.created_at > a.created_at OR (newer.created_at = a.created_at AND newer.id > a.id))
);
