CREATE TABLE "race_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"race_session_id" uuid NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"elapsed_ms" integer,
	"kart" text,
	"position" integer,
	"gap_lider_ms" integer,
	"virtual_position" integer,
	"laps" integer,
	"stint_laps" integer,
	"driver_id" text,
	"driver_name" text,
	"avg_pace_ms" integer,
	"delta_to_target_ms" integer,
	"traffic" boolean,
	"rival_ahead_delta_ms" integer,
	"rival_behind_delta_ms" integer,
	"next_stop_reason" text,
	"laps_until_next_stop" integer,
	"stops_done" integer,
	"payload" jsonb
);
--> statement-breakpoint
ALTER TABLE "race_laps" ADD COLUMN "driver_id" text;--> statement-breakpoint
ALTER TABLE "race_laps" ADD COLUMN "position" integer;--> statement-breakpoint
ALTER TABLE "race_laps" ADD COLUMN "gap_lider_ms" integer;--> statement-breakpoint
ALTER TABLE "race_snapshots" ADD CONSTRAINT "race_snapshots_race_session_id_race_sessions_id_fk" FOREIGN KEY ("race_session_id") REFERENCES "public"."race_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "race_snapshots_session_timestamp_idx" ON "race_snapshots" USING btree ("race_session_id","timestamp");