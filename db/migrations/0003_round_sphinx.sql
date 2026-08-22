CREATE TYPE "public"."place_confidence" AS ENUM('high', 'low', 'none');--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "start_place_confidence" "place_confidence";--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "end_place_confidence" "place_confidence";--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "end_fix_delta_minutes" integer;