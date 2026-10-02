CREATE TABLE "auth_identity_outbox" (
	"event_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"session_id" text,
	"user_id" text NOT NULL,
	"target_bindings" text NOT NULL,
	"created_at" bigint NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" bigint NOT NULL,
	"delivered_targets" text NOT NULL,
	"completed_at" bigint,
	CONSTRAINT "auth_identity_outbox_kind_check" CHECK ("auth_identity_outbox"."kind" in ('session', 'user')),
	CONSTRAINT "auth_identity_outbox_attempts_check" CHECK ("auth_identity_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "auth_oidc_bindings" (
	"client_id" text NOT NULL,
	"hydra_sid" text NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"revoked_at" bigint,
	CONSTRAINT "auth_oidc_bindings_client_id_hydra_sid_pk" PRIMARY KEY("client_id","hydra_sid")
);
--> statement-breakpoint
CREATE TABLE "auth_oidc_flows" (
	"phase" text NOT NULL,
	"challenge_hash" text NOT NULL,
	"session_id" text NOT NULL,
	"client_id" text NOT NULL,
	"hydra_sid" text,
	"state" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"encrypted_redirect" text,
	CONSTRAINT "auth_oidc_flows_phase_challenge_hash_pk" PRIMARY KEY("phase","challenge_hash"),
	CONSTRAINT "auth_oidc_flows_phase_check" CHECK ("auth_oidc_flows"."phase" in ('login', 'consent')),
	CONSTRAINT "auth_oidc_flows_state_check" CHECK ("auth_oidc_flows"."state" in ('processing', 'completed', 'restart_required'))
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "id" text DEFAULT gen_random_uuid()::text NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN "disabled_at" bigint;--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN "profile_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_id_unique" ON "auth_sessions" USING btree ("id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_id_user_id_unique" ON "auth_sessions" USING btree ("id","user_id");--> statement-breakpoint
ALTER TABLE "auth_identity_outbox" ADD CONSTRAINT "auth_identity_outbox_session_id_auth_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_identity_outbox" ADD CONSTRAINT "auth_identity_outbox_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oidc_bindings" ADD CONSTRAINT "auth_oidc_bindings_session_owner_fk" FOREIGN KEY ("session_id","user_id") REFERENCES "auth_sessions"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oidc_flows" ADD CONSTRAINT "auth_oidc_flows_session_id_auth_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_identity_outbox_due_idx" ON "auth_identity_outbox" USING btree ("completed_at","next_attempt_at");--> statement-breakpoint
CREATE INDEX "auth_oidc_bindings_session_idx" ON "auth_oidc_bindings" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "auth_oidc_bindings_user_idx" ON "auth_oidc_bindings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_oidc_flows_expires_at_idx" ON "auth_oidc_flows" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "auth_users" ADD CONSTRAINT "auth_users_profile_version_check" CHECK ("auth_users"."profile_version" >= 0);
