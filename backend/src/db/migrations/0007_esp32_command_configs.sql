-- Add pilot_name to existing esp32_devices table
ALTER TABLE "esp32_devices" ADD COLUMN "pilot_name" text DEFAULT '' NOT NULL;--> statement-breakpoint

-- New table for per-device command configurations
CREATE TABLE "esp32_command_configs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"command_type" text NOT NULL,
	"command_text" text DEFAULT '' NOT NULL,
	"interval_ms" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "esp32_command_configs" ADD CONSTRAINT "esp32_command_configs_device_id_esp32_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."esp32_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "esp32_cmd_configs_device_idx" ON "esp32_command_configs" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "esp32_cmd_configs_device_type_idx" ON "esp32_command_configs" USING btree ("device_id", "command_type");--> statement-breakpoint

-- Event log per InLapBox device
CREATE TABLE "esp32_device_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid,
	"org_id" uuid NOT NULL,
	"event" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "esp32_device_logs" ADD CONSTRAINT "esp32_device_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "esp32_logs_device_idx" ON "esp32_device_logs" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "esp32_logs_org_idx" ON "esp32_device_logs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "esp32_logs_created_idx" ON "esp32_device_logs" USING btree ("created_at");
