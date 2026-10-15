DELETE FROM "support_feedback_attachments";--> statement-breakpoint
DELETE FROM "support_feedback_submissions";--> statement-breakpoint
ALTER TABLE "support_feedback_submissions" DROP CONSTRAINT "support_feedback_form_check";--> statement-breakpoint
ALTER TABLE "support_feedback_submissions" ADD COLUMN "task_payload_json" text NOT NULL;--> statement-breakpoint
ALTER TABLE "support_feedback_submissions" ADD COLUMN "task_payload_sha256" text NOT NULL;--> statement-breakpoint
ALTER TABLE "support_feedback_submissions" ADD CONSTRAINT "support_feedback_task_payload_digest_check" CHECK ("support_feedback_submissions"."task_payload_sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "support_feedback_submissions" ADD CONSTRAINT "support_feedback_form_check" CHECK ("support_feedback_submissions"."form_kind" in ('bug','feature','asset','request','content','campaign') and "support_feedback_submissions"."form_version"=2 and "support_feedback_submissions"."content_rule_version"=1);
