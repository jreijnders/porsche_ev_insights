CREATE TYPE "public"."auth_health" AS ENUM('healthy', 'degraded', 'reauth_required');--> statement-breakpoint
ALTER TABLE "porsche_session" ADD COLUMN "health" "auth_health" DEFAULT 'healthy' NOT NULL;--> statement-breakpoint
ALTER TABLE "porsche_session" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "porsche_session" ADD COLUMN "last_refresh_at" timestamp with time zone;