CREATE TABLE "auth_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"revoked_at" bigint
);
--> statement-breakpoint
CREATE TABLE "auth_sso_requests" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"status" text NOT NULL,
	"user_id" text,
	"completed_at" bigint,
	CONSTRAINT "auth_sso_requests_status_check" CHECK ("auth_sso_requests"."status" in ('pending', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"nickname" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" bigint NOT NULL,
	"qq" text,
	"fivem_id" text,
	"avatar_key" text,
	CONSTRAINT "auth_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "community_group_memberships" (
	"user_id" text NOT NULL,
	"group_code" text NOT NULL,
	CONSTRAINT "community_group_memberships_user_id_group_code_pk" PRIMARY KEY("user_id","group_code")
);
--> statement-breakpoint
CREATE TABLE "community_groups" (
	"code" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "join_application_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"original_name" text NOT NULL,
	"extension" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_length" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	CONSTRAINT "join_application_attachments_ordinal_check" CHECK ("join_application_attachments"."ordinal" between 0 and 4),
	CONSTRAINT "join_application_attachments_length_check" CHECK ("join_application_attachments"."byte_length" between 1 and 10485760 and "join_application_attachments"."byte_length" = octet_length("join_application_attachments"."bytes")),
	CONSTRAINT "join_application_attachments_sha256_check" CHECK ("join_application_attachments"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "join_application_email_registry" (
	"email" text PRIMARY KEY NOT NULL,
	"canonical_application_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "join_application_forms" (
	"application_id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"application_type" text NOT NULL,
	"form_json" text NOT NULL,
	CONSTRAINT "join_application_forms_version_check" CHECK ("join_application_forms"."version" = 1),
	CONSTRAINT "join_application_forms_type_check" CHECK ("join_application_forms"."application_type" in ('new', 'experienced'))
);
--> statement-breakpoint
CREATE TABLE "join_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"nickname" text NOT NULL,
	"qq" text NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"reviewed_at" bigint,
	"reviewed_by_user_id" text,
	"form_version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "join_applications_form_version_check" CHECK ("join_applications"."form_version" in (0, 1)),
	CONSTRAINT "join_applications_status_check" CHECK ("join_applications"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "join_applications_review_check" CHECK (("join_applications"."status" = 'pending' and "join_applications"."reviewed_at" is null) or ("join_applications"."status" <> 'pending' and "join_applications"."reviewed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "join_delivery_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"invitation_id" text NOT NULL,
	"code_version" integer NOT NULL,
	"started_at" bigint NOT NULL,
	"finished_at" bigint,
	"status" text NOT NULL,
	CONSTRAINT "join_delivery_attempts_status_check" CHECK ("join_delivery_attempts"."status" in ('pending', 'sent', 'failed')),
	CONSTRAINT "join_delivery_attempts_finished_check" CHECK (("join_delivery_attempts"."status" = 'pending' and "join_delivery_attempts"."finished_at" is null) or ("join_delivery_attempts"."status" <> 'pending' and "join_delivery_attempts"."finished_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "join_email_controls" (
	"email" text PRIMARY KEY NOT NULL,
	"next_send_at" bigint NOT NULL,
	"failure_window_started_at" bigint,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "join_email_controls_failures_check" CHECK ("join_email_controls"."failed_attempts" between 0 and 5)
);
--> statement-breakpoint
CREATE TABLE "join_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"status" text NOT NULL,
	"issued_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"code_version" integer NOT NULL,
	"code_digest" text,
	"code_expires_at" bigint,
	"completion_token_hash" text,
	"completion_expires_at" bigint,
	"completed_user_id" text,
	"completed_at" bigint,
	CONSTRAINT "join_invitations_status_check" CHECK ("join_invitations"."status" in ('active', 'expired', 'completed')),
	CONSTRAINT "join_invitations_version_check" CHECK ("join_invitations"."code_version" >= 1),
	CONSTRAINT "join_invitations_completion_check" CHECK (("join_invitations"."status" = 'completed' and "join_invitations"."completed_user_id" is not null and "join_invitations"."completed_at" is not null) or ("join_invitations"."status" <> 'completed' and "join_invitations"."completed_user_id" is null and "join_invitations"."completed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sso_requests" ADD CONSTRAINT "auth_sso_requests_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_group_memberships" ADD CONSTRAINT "community_group_memberships_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_group_memberships" ADD CONSTRAINT "community_group_memberships_group_code_community_groups_code_fk" FOREIGN KEY ("group_code") REFERENCES "community_groups"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_application_attachments" ADD CONSTRAINT "join_application_attachments_application_id_join_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "join_applications"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "join_applications_id_email_unique" ON "join_applications" USING btree ("id","email");--> statement-breakpoint
ALTER TABLE "join_application_email_registry" ADD CONSTRAINT "join_application_email_registry_application_email_fk" FOREIGN KEY ("canonical_application_id","email") REFERENCES "join_applications"("id","email") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "join_application_forms" ADD CONSTRAINT "join_application_forms_application_id_join_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "join_applications"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "join_applications" ADD CONSTRAINT "join_applications_reviewed_by_user_id_auth_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_delivery_attempts" ADD CONSTRAINT "join_delivery_attempts_invitation_id_join_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "join_invitations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_invitations" ADD CONSTRAINT "join_invitations_application_id_join_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "join_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_invitations" ADD CONSTRAINT "join_invitations_completed_user_id_auth_users_id_fk" FOREIGN KEY ("completed_user_id") REFERENCES "auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_sso_requests_expires_at_idx" ON "auth_sso_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_users_avatar_key_unique" ON "auth_users" USING btree ("avatar_key");--> statement-breakpoint
CREATE UNIQUE INDEX "join_application_attachments_ordinal_unique" ON "join_application_attachments" USING btree ("application_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "join_applications_open_email_unique" ON "join_applications" USING btree ("email") WHERE "join_applications"."status" in ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "join_applications_list_idx" ON "join_applications" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "join_applications_email_history_idx" ON "join_applications" USING btree ("email","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "join_delivery_attempts_version_unique" ON "join_delivery_attempts" USING btree ("invitation_id","code_version");--> statement-breakpoint
CREATE UNIQUE INDEX "join_invitations_active_application_unique" ON "join_invitations" USING btree ("application_id") WHERE "join_invitations"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "join_invitations_completion_token_unique" ON "join_invitations" USING btree ("completion_token_hash");--> statement-breakpoint
CREATE INDEX "join_invitations_application_idx" ON "join_invitations" USING btree ("application_id","issued_at","id");--> statement-breakpoint
CREATE INDEX "join_invitations_expires_idx" ON "join_invitations" USING btree ("expires_at");
--> statement-breakpoint
INSERT INTO "community_groups" ("code", "display_name") VALUES ('admin', '管理员');
