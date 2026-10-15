CREATE TABLE "esp32_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"uuid" text NOT NULL,
	"org_id" uuid NOT NULL,
	"device_name" text DEFAULT '' NOT NULL,
	"approved" boolean DEFAULT true NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_connection_at" timestamp with time zone,
	CONSTRAINT "esp32_devices_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "device_password_hash" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "device_password_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "esp32_devices" ADD CONSTRAINT "esp32_devices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "esp32_devices_org_idx" ON "esp32_devices" USING btree ("org_id");