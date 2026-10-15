CREATE TABLE "support_feedback_attachments" (
	"submission_id" text NOT NULL,
	"id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_length" integer NOT NULL,
	"sha256" text NOT NULL,
	"bytes" "bytea",
	"status" text NOT NULL,
	"remote_attachment_id" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "support_feedback_attachments_submission_id_id_pk" PRIMARY KEY("submission_id","id"),
	CONSTRAINT "support_attachment_ordinal_check" CHECK ("support_feedback_attachments"."ordinal" between 0 and 4),
	CONSTRAINT "support_attachment_length_check" CHECK ("support_feedback_attachments"."byte_length" between 1 and 20971520),
	CONSTRAINT "support_attachment_sha_check" CHECK ("support_feedback_attachments"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "support_attachment_time_check" CHECK ("support_feedback_attachments"."created_at" between 0 and 9007199254740991 and "support_feedback_attachments"."updated_at" between "support_feedback_attachments"."created_at" and 9007199254740991),
	CONSTRAINT "support_attachment_metadata_check" CHECK (char_length("support_feedback_attachments"."original_name") between 1 and 255 and char_length("support_feedback_attachments"."content_type") between 1 and 127 and ("support_feedback_attachments"."remote_attachment_id" is null or char_length("support_feedback_attachments"."remote_attachment_id") between 1 and 256)),
	CONSTRAINT "support_attachment_bytes_check" CHECK ((
    "support_feedback_attachments"."status"='expected' and "support_feedback_attachments"."bytes" is null and "support_feedback_attachments"."remote_attachment_id" is null
  ) or (
    "support_feedback_attachments"."status" in ('received','uploading','failed','verification_required') and "support_feedback_attachments"."bytes" is not null and octet_length("support_feedback_attachments"."bytes")="support_feedback_attachments"."byte_length" and "support_feedback_attachments"."remote_attachment_id" is null
  ) or (
    "support_feedback_attachments"."status"='uploaded' and "support_feedback_attachments"."remote_attachment_id" is not null and "support_feedback_attachments"."bytes" is null
  ))
);
--> statement-breakpoint
CREATE TABLE "support_feedback_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"submission_key" text NOT NULL,
	"nickname_snapshot" text NOT NULL,
	"form_kind" text NOT NULL,
	"form_version" integer NOT NULL,
	"content_rule_version" integer NOT NULL,
	"form_json" text NOT NULL,
	"user_markdown" text NOT NULL,
	"final_markdown" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"revision" bigint NOT NULL,
	"status" text NOT NULL,
	"attachment_count" integer NOT NULL,
	"total_attachment_bytes" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"receive_expires_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"clickup_task_id" text,
	"target_list_id" text NOT NULL,
	"attempt_id" text,
	"attempt_kind" text,
	"attempt_attachment_id" text,
	"attempt_started_at" bigint,
	"attempt_expires_at" bigint,
	"attempt_owner_boot_id" text,
	"failure_code" text,
	"failure_phase" text,
	"failure_attachment_id" text,
	"retry_not_before" bigint,
	"maintenance_resolution_json" text,
	CONSTRAINT "support_feedback_form_check" CHECK ("support_feedback_submissions"."form_kind" in ('request','bug') and "support_feedback_submissions"."form_version"=1 and "support_feedback_submissions"."content_rule_version"=1),
	CONSTRAINT "support_feedback_status_check" CHECK ("support_feedback_submissions"."status" in ('receiving','ready','creating','uploading','failed','verification_required','completed')),
	CONSTRAINT "support_feedback_revision_check" CHECK ("support_feedback_submissions"."revision" between 0 and 9007199254740991),
	CONSTRAINT "support_feedback_count_check" CHECK ("support_feedback_submissions"."attachment_count" between 0 and 5 and "support_feedback_submissions"."total_attachment_bytes" between 0 and 104857600),
	CONSTRAINT "support_feedback_digest_check" CHECK ("support_feedback_submissions"."payload_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "support_feedback_time_check" CHECK ("support_feedback_submissions"."created_at" between 0 and 9007199168340991 and "support_feedback_submissions"."receive_expires_at"="support_feedback_submissions"."created_at"+86400000 and "support_feedback_submissions"."updated_at" between "support_feedback_submissions"."created_at" and 9007199254740991 and ("support_feedback_submissions"."retry_not_before" is null or "support_feedback_submissions"."retry_not_before" between 0 and 9007199254740991)),
	CONSTRAINT "support_feedback_content_check" CHECK (octet_length("support_feedback_submissions"."user_markdown") between 1 and 65536 and octet_length("support_feedback_submissions"."final_markdown") between 1 and 66560),
	CONSTRAINT "support_feedback_attempt_check" CHECK ((
    "support_feedback_submissions"."attempt_id" is null and "support_feedback_submissions"."attempt_kind" is null and "support_feedback_submissions"."attempt_attachment_id" is null and "support_feedback_submissions"."attempt_started_at" is null and "support_feedback_submissions"."attempt_expires_at" is null and "support_feedback_submissions"."attempt_owner_boot_id" is null
  ) or (
    "support_feedback_submissions"."attempt_id" is not null and "support_feedback_submissions"."attempt_kind" is not null and "support_feedback_submissions"."attempt_owner_boot_id" is not null and "support_feedback_submissions"."attempt_started_at" is not null and "support_feedback_submissions"."attempt_expires_at" is not null and "support_feedback_submissions"."attempt_started_at" between 0 and 9007199254740991 and "support_feedback_submissions"."attempt_expires_at" between "support_feedback_submissions"."attempt_started_at" and 9007199254740991 and
    (("support_feedback_submissions"."attempt_kind"='create_task' and "support_feedback_submissions"."attempt_attachment_id" is null) or ("support_feedback_submissions"."attempt_kind"='upload_attachment' and "support_feedback_submissions"."attempt_attachment_id" is not null and "support_feedback_submissions"."clickup_task_id" is not null))
  )),
	CONSTRAINT "support_feedback_failure_check" CHECK (("support_feedback_submissions"."failure_code" is null and "support_feedback_submissions"."failure_phase" is null and "support_feedback_submissions"."failure_attachment_id" is null and "support_feedback_submissions"."retry_not_before" is null) or (
    "support_feedback_submissions"."failure_code" is not null and "support_feedback_submissions"."failure_phase" is not null and "support_feedback_submissions"."failure_code" in ('UPSTREAM_REJECTED','UPSTREAM_RATE_LIMITED','UPSTREAM_CONFIGURATION','UPSTREAM_UNKNOWN') and
    (("support_feedback_submissions"."failure_phase"='create_task' and "support_feedback_submissions"."failure_attachment_id" is null) or ("support_feedback_submissions"."failure_phase"='upload_attachment' and "support_feedback_submissions"."failure_attachment_id" is not null and "support_feedback_submissions"."clickup_task_id" is not null))
  )),
	CONSTRAINT "support_feedback_task_check" CHECK ("support_feedback_submissions"."clickup_task_id" is null or "support_feedback_submissions"."clickup_task_id" ~ '^[A-Za-z0-9_-]{1,128}$'),
	CONSTRAINT "support_feedback_completed_check" CHECK ("support_feedback_submissions"."status"<>'completed' or ("support_feedback_submissions"."clickup_task_id" is not null and "support_feedback_submissions"."attempt_id" is null and "support_feedback_submissions"."failure_code" is null))
);
--> statement-breakpoint
ALTER TABLE "support_feedback_attachments" ADD CONSTRAINT "support_feedback_attachments_submission_id_support_feedback_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "support_feedback_submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_feedback_submissions" ADD CONSTRAINT "support_feedback_submissions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_attachment_ordinal_unique" ON "support_feedback_attachments" USING btree ("submission_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "support_attachment_remote_unique" ON "support_feedback_attachments" USING btree ("submission_id","remote_attachment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_feedback_key_unique" ON "support_feedback_submissions" USING btree ("user_id","submission_key");--> statement-breakpoint
CREATE UNIQUE INDEX "support_feedback_task_unique" ON "support_feedback_submissions" USING btree ("clickup_task_id");--> statement-breakpoint
CREATE INDEX "support_feedback_user_created_idx" ON "support_feedback_submissions" USING btree ("user_id","created_at");