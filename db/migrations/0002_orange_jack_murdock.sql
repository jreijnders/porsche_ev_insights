ALTER TABLE "sync_state" ALTER COLUMN "health" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "sync_state" ALTER COLUMN "health" SET DEFAULT 'healthy'::text;--> statement-breakpoint
DROP TYPE "public"."sync_health";--> statement-breakpoint
CREATE TYPE "public"."sync_health" AS ENUM('healthy', 'degraded', 'broken');--> statement-breakpoint
ALTER TABLE "sync_state" ALTER COLUMN "health" SET DEFAULT 'healthy'::"public"."sync_health";--> statement-breakpoint
ALTER TABLE "sync_state" ALTER COLUMN "health" SET DATA TYPE "public"."sync_health" USING "health"::"public"."sync_health";