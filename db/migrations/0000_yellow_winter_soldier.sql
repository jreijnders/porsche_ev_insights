CREATE TYPE "public"."place_kind" AS ENUM('home', 'business', 'other');--> statement-breakpoint
CREATE TYPE "public"."sync_health" AS ENUM('healthy', 'degraded', 'broken', 'reauth_required');--> statement-breakpoint
CREATE TYPE "public"."trip_purpose" AS ENUM('business', 'private');--> statement-breakpoint
CREATE TYPE "public"."trip_source" AS ENUM('api', 'manual');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('provisional', 'closed');--> statement-breakpoint
CREATE TABLE "mileage_rate" (
	"year" integer PRIMARY KEY NOT NULL,
	"eur_per_km" numeric(5, 3) NOT NULL,
	CONSTRAINT "mileage_rate_nonneg" CHECK ("mileage_rate"."eur_per_km" >= 0)
);
--> statement-breakpoint
CREATE TABLE "odometer_reading" (
	"id" serial PRIMARY KEY NOT NULL,
	"vin" text NOT NULL,
	"event_at" timestamp with time zone,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mileage_km" numeric(9, 1) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "place" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"kind" "place_kind" NOT NULL,
	"lat" numeric(9, 6) NOT NULL,
	"lon" numeric(9, 6) NOT NULL,
	"match_radius_m" integer DEFAULT 100 NOT NULL,
	"google_place_id" text,
	"address" text,
	"address_source" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_radius_positive" CHECK ("place"."match_radius_m" > 0)
);
--> statement-breakpoint
CREATE TABLE "porsche_session" (
	"account_email" text PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sample" (
	"id" serial PRIMARY KEY NOT NULL,
	"vin" text NOT NULL,
	"event_at" timestamp with time zone,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_at_estimated" boolean DEFAULT false NOT NULL,
	"lat" numeric(9, 6) NOT NULL,
	"lon" numeric(9, 6) NOT NULL,
	"direction" integer,
	"mileage_km" numeric(9, 1),
	"battery_pct" integer,
	"charging" boolean,
	CONSTRAINT "sample_estimated_implies_no_event" CHECK (not "sample"."event_at_estimated" or "sample"."event_at" is null)
);
--> statement-breakpoint
CREATE TABLE "segment" (
	"id" serial PRIMARY KEY NOT NULL,
	"vin" text NOT NULL,
	"api_end_at" timestamp with time zone NOT NULL,
	"driving_minutes" integer,
	"distance_km" numeric(8, 2) NOT NULL,
	"avg_consumption_kwh_100km" numeric(5, 1),
	"avg_speed_kmh" numeric(5, 1),
	"raw" jsonb NOT NULL,
	"trip_id" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"vin" text PRIMARY KEY NOT NULL,
	"trip_watermark" timestamp with time zone,
	"last_poll_at" timestamp with time zone,
	"last_poll_ok" boolean,
	"health" "sync_health" DEFAULT 'healthy' NOT NULL,
	"health_detail" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip" (
	"id" serial PRIMARY KEY NOT NULL,
	"vin" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"started_at_derived" boolean DEFAULT false NOT NULL,
	"start_place_id" integer,
	"end_place_id" integer,
	"distance_km" numeric(8, 2) NOT NULL,
	"driving_minutes" integer,
	"avg_consumption_kwh_100km" numeric(5, 1),
	"avg_speed_kmh" numeric(5, 1),
	"purpose" "trip_purpose",
	"invoice_monthly" boolean DEFAULT false NOT NULL,
	"checked_at" timestamp with time zone,
	"status" "trip_status" DEFAULT 'provisional' NOT NULL,
	"source" "trip_source" NOT NULL,
	"api_fingerprint" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_time_order" CHECK ("trip"."ended_at" >= "trip"."started_at"),
	CONSTRAINT "trip_distance_nonneg" CHECK ("trip"."distance_km" >= 0),
	CONSTRAINT "trip_no_checked_while_provisional" CHECK ("trip"."checked_at" is null or "trip"."status" <> 'provisional'),
	CONSTRAINT "trip_fingerprint_matches_source" CHECK (("trip"."source" = 'api') = ("trip"."api_fingerprint" is not null))
);
--> statement-breakpoint
CREATE TABLE "vehicle" (
	"vin" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"model_id" text,
	"acquired_on" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "odometer_reading" ADD CONSTRAINT "odometer_reading_vin_vehicle_vin_fk" FOREIGN KEY ("vin") REFERENCES "public"."vehicle"("vin") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample" ADD CONSTRAINT "sample_vin_vehicle_vin_fk" FOREIGN KEY ("vin") REFERENCES "public"."vehicle"("vin") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment" ADD CONSTRAINT "segment_vin_vehicle_vin_fk" FOREIGN KEY ("vin") REFERENCES "public"."vehicle"("vin") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment" ADD CONSTRAINT "segment_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_vin_vehicle_vin_fk" FOREIGN KEY ("vin") REFERENCES "public"."vehicle"("vin") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_vin_vehicle_vin_fk" FOREIGN KEY ("vin") REFERENCES "public"."vehicle"("vin") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_start_place_id_place_id_fk" FOREIGN KEY ("start_place_id") REFERENCES "public"."place"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_end_place_id_place_id_fk" FOREIGN KEY ("end_place_id") REFERENCES "public"."place"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "odometer_vin_mileage_uq" ON "odometer_reading" USING btree ("vin","mileage_km");--> statement-breakpoint
CREATE INDEX "odometer_vin_observed_idx" ON "odometer_reading" USING btree ("vin","observed_at");--> statement-breakpoint
CREATE INDEX "place_coords_idx" ON "place" USING btree ("lat","lon");--> statement-breakpoint
CREATE UNIQUE INDEX "sample_vin_event_uq" ON "sample" USING btree ("vin","event_at") WHERE "sample"."event_at" is not null;--> statement-breakpoint
CREATE INDEX "sample_vin_observed_idx" ON "sample" USING btree ("vin","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "segment_vin_end_uq" ON "segment" USING btree ("vin","api_end_at");--> statement-breakpoint
CREATE INDEX "segment_ingested_idx" ON "segment" USING btree ("ingested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_api_fingerprint_uq" ON "trip" USING btree ("vin","api_fingerprint") WHERE "trip"."api_fingerprint" is not null;--> statement-breakpoint
CREATE INDEX "trip_vin_started_idx" ON "trip" USING btree ("vin","started_at");--> statement-breakpoint
CREATE INDEX "trip_unchecked_idx" ON "trip" USING btree ("vin","started_at") WHERE "trip"."checked_at" is null;