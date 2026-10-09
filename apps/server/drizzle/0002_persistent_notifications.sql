CREATE TABLE "notification_clear_batch_items" (
	"batch_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"expected_clear_revision" integer NOT NULL,
	"applied_clear_revision" integer,
	CONSTRAINT "notification_clear_batch_items_batch_id_receipt_id_pk" PRIMARY KEY("batch_id","receipt_id"),
	CONSTRAINT "notification_clear_batch_items_expected_revision_check" CHECK ("notification_clear_batch_items"."expected_clear_revision" >= 0),
	CONSTRAINT "notification_clear_batch_items_applied_revision_check" CHECK ("notification_clear_batch_items"."applied_clear_revision" is null or "notification_clear_batch_items"."applied_clear_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notification_clear_batches" (
	"batch_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"upper_sequence" integer NOT NULL,
	"preview_expires_at" bigint NOT NULL,
	"status" text NOT NULL,
	"request_id" text,
	"item_count" integer NOT NULL,
	"affected_count" integer,
	"skipped_count" integer,
	"created_at" bigint NOT NULL,
	"applied_at" bigint,
	"restored_at" bigint,
	CONSTRAINT "notification_clear_batches_status_check" CHECK ("notification_clear_batches"."status" in ('preview', 'applied', 'restored')),
	CONSTRAINT "notification_clear_batches_upper_sequence_check" CHECK ("notification_clear_batches"."upper_sequence" >= 0),
	CONSTRAINT "notification_clear_batches_item_count_check" CHECK ("notification_clear_batches"."item_count" >= 0),
	CONSTRAINT "notification_clear_batches_applied_check" CHECK (("notification_clear_batches"."status" = 'preview' and "notification_clear_batches"."applied_at" is null)
      or ("notification_clear_batches"."status" <> 'preview' and "notification_clear_batches"."applied_at" is not null)),
	CONSTRAINT "notification_clear_batches_restored_check" CHECK (("notification_clear_batches"."status" = 'restored' and "notification_clear_batches"."restored_at" is not null)
      or ("notification_clear_batches"."status" <> 'restored' and "notification_clear_batches"."restored_at" is null)),
	CONSTRAINT "notification_clear_batches_counts_check" CHECK (("notification_clear_batches"."affected_count" is null and "notification_clear_batches"."skipped_count" is null and "notification_clear_batches"."request_id" is null)
      or ("notification_clear_batches"."affected_count" is not null and "notification_clear_batches"."skipped_count" is not null and "notification_clear_batches"."request_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "notification_contents" (
	"content_id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"format" text NOT NULL,
	"schema_version" integer NOT NULL,
	"policy_version" text NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"summary_text" text NOT NULL,
	"content_revision" integer NOT NULL,
	"template_id" text NOT NULL,
	"template_version" integer NOT NULL,
	"source_revision" integer NOT NULL,
	"scope" text NOT NULL,
	"category" text NOT NULL,
	"necessity" text NOT NULL,
	"actions_json" text NOT NULL,
	"available_at" bigint NOT NULL,
	"expires_at" bigint,
	"withdrawn_at" bigint,
	"actor_user_id" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "notification_contents_format_check" CHECK ("notification_contents"."format" = 'html'),
	CONSTRAINT "notification_contents_schema_version_check" CHECK ("notification_contents"."schema_version" = 1),
	CONSTRAINT "notification_contents_policy_version_check" CHECK ("notification_contents"."policy_version" = 'notification-html-v1'),
	CONSTRAINT "notification_contents_content_revision_check" CHECK ("notification_contents"."content_revision" = 1),
	CONSTRAINT "notification_contents_scope_check" CHECK ("notification_contents"."scope" in ('community', 'personal')),
	CONSTRAINT "notification_contents_category_check" CHECK ("notification_contents"."category" in ('announcement', 'personal_update', 'service_notice')),
	CONSTRAINT "notification_contents_necessity_check" CHECK ("notification_contents"."necessity" in ('optional', 'necessary')),
	CONSTRAINT "notification_contents_necessity_category_check" CHECK (("notification_contents"."necessity" = 'necessary' and "notification_contents"."category" = 'service_notice')
      or ("notification_contents"."necessity" = 'optional' and "notification_contents"."category" in ('announcement', 'personal_update'))),
	CONSTRAINT "notification_contents_template_version_check" CHECK ("notification_contents"."template_version" >= 1),
	CONSTRAINT "notification_contents_source_revision_check" CHECK ("notification_contents"."source_revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "notification_event_recipients" (
	"event_id" text NOT NULL,
	"user_id" text NOT NULL,
	"state" text NOT NULL,
	"decided_at" bigint,
	"receipt_id" text,
	CONSTRAINT "notification_event_recipients_event_id_user_id_pk" PRIMARY KEY("event_id","user_id"),
	CONSTRAINT "notification_event_recipients_state_check" CHECK ("notification_event_recipients"."state" in ('pending', 'delivered', 'suppressed_preference', 'skipped_disabled', 'expired', 'withdrawn')),
	CONSTRAINT "notification_event_recipients_terminal_check" CHECK (("notification_event_recipients"."state" = 'pending' and "notification_event_recipients"."decided_at" is null)
      or ("notification_event_recipients"."state" <> 'pending' and "notification_event_recipients"."decided_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "notification_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"event_version" integer NOT NULL,
	"occurred_at" bigint NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"source_revision" integer NOT NULL,
	"scope" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"digest" text NOT NULL,
	"actor_user_id" text,
	"data_json" text NOT NULL,
	"content_id" text,
	"projection_status" text NOT NULL,
	"projection_attempts" integer DEFAULT 0 NOT NULL,
	"projection_lease_owner" text,
	"projection_lease_expires_at" bigint,
	"projection_next_attempt_at" bigint NOT NULL,
	"projection_completed_at" bigint,
	"projection_error_code" text,
	CONSTRAINT "notification_events_event_version_check" CHECK ("notification_events"."event_version" = 1),
	CONSTRAINT "notification_events_type_check" CHECK ("notification_events"."event_type" in ('community.announcement.published', 'community.announcement.withdrawn', 'personal.notice.issued')),
	CONSTRAINT "notification_events_scope_check" CHECK ("notification_events"."scope" in ('community', 'personal')),
	CONSTRAINT "notification_events_status_check" CHECK ("notification_events"."projection_status" in ('pending', 'completed', 'failed')),
	CONSTRAINT "notification_events_attempts_check" CHECK ("notification_events"."projection_attempts" >= 0),
	CONSTRAINT "notification_events_source_revision_check" CHECK ("notification_events"."source_revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "notification_mutations" (
	"user_id" text NOT NULL,
	"request_id" text NOT NULL,
	"kind" text NOT NULL,
	"digest" text NOT NULL,
	"result_json" text NOT NULL,
	"clear_batch_id" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "notification_mutations_user_id_request_id_pk" PRIMARY KEY("user_id","request_id"),
	CONSTRAINT "notification_mutations_kind_check" CHECK ("notification_mutations"."kind" in ('read_through', 'clear', 'restore'))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"announcement_enabled" boolean NOT NULL,
	"personal_update_enabled" boolean NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "notification_preferences_revision_check" CHECK ("notification_preferences"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notification_receipts" (
	"receipt_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"content_id" text NOT NULL,
	"event_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"scope" text NOT NULL,
	"delivered_at" bigint NOT NULL,
	"read_at" bigint,
	"cleared_at" bigint,
	"clear_batch_id" text,
	"clear_revision" integer DEFAULT 0 NOT NULL,
	"state_revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "notification_receipts_scope_check" CHECK ("notification_receipts"."scope" in ('community', 'personal')),
	CONSTRAINT "notification_receipts_sequence_check" CHECK ("notification_receipts"."sequence" >= 1),
	CONSTRAINT "notification_receipts_clear_revision_check" CHECK ("notification_receipts"."clear_revision" >= 0),
	CONSTRAINT "notification_receipts_state_revision_check" CHECK ("notification_receipts"."state_revision" >= 0),
	CONSTRAINT "notification_receipts_clear_batch_check" CHECK (("notification_receipts"."cleared_at" is null and "notification_receipts"."clear_batch_id" is null)
      or ("notification_receipts"."cleared_at" is not null and "notification_receipts"."clear_batch_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "notification_user_streams" (
	"user_id" text PRIMARY KEY NOT NULL,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "notification_user_streams_last_sequence_check" CHECK ("notification_user_streams"."last_sequence" >= 0),
	CONSTRAINT "notification_user_streams_state_version_check" CHECK ("notification_user_streams"."state_version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "notification_clear_batch_items" ADD CONSTRAINT "notification_clear_batch_items_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "notification_clear_batches"("batch_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_clear_batch_items" ADD CONSTRAINT "notification_clear_batch_items_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "notification_receipts"("receipt_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_clear_batches" ADD CONSTRAINT "notification_clear_batches_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_contents" ADD CONSTRAINT "notification_contents_actor_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_event_recipients" ADD CONSTRAINT "notification_event_recipients_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "notification_events"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_event_recipients" ADD CONSTRAINT "notification_event_recipients_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_actor_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "notification_contents"("content_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_mutations" ADD CONSTRAINT "notification_mutations_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_receipts" ADD CONSTRAINT "notification_receipts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_receipts" ADD CONSTRAINT "notification_receipts_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "notification_contents"("content_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_receipts" ADD CONSTRAINT "notification_receipts_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "notification_events"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_user_streams" ADD CONSTRAINT "notification_user_streams_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_clear_batch_items_receipt_idx" ON "notification_clear_batch_items" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "notification_clear_batches_user_idx" ON "notification_clear_batches" USING btree ("user_id","created_at" DESC,"batch_id");--> statement-breakpoint
CREATE INDEX "notification_contents_active_idx" ON "notification_contents" USING btree ("available_at","content_id");--> statement-breakpoint
CREATE INDEX "notification_event_recipients_event_state_idx" ON "notification_event_recipients" USING btree ("event_id","state");--> statement-breakpoint
CREATE INDEX "notification_event_recipients_user_idx" ON "notification_event_recipients" USING btree ("user_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_events_dedupe_key_unique" ON "notification_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_events_due_idx" ON "notification_events" USING btree ("projection_status","projection_next_attempt_at");--> statement-breakpoint
CREATE INDEX "notification_mutations_user_kind_idx" ON "notification_mutations" USING btree ("user_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_receipts_content_user_unique" ON "notification_receipts" USING btree ("content_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_receipts_user_sequence_unique" ON "notification_receipts" USING btree ("user_id","sequence");--> statement-breakpoint
CREATE INDEX "notification_receipts_history_idx" ON "notification_receipts" USING btree ("user_id","sequence" DESC);--> statement-breakpoint
CREATE INDEX "notification_receipts_unread_idx" ON "notification_receipts" USING btree ("user_id","sequence" DESC) WHERE "notification_receipts"."cleared_at" is null and "notification_receipts"."read_at" is null;