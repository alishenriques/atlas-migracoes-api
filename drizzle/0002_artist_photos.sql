CREATE TABLE "artist_photos" (
	"artist_id" text PRIMARY KEY NOT NULL,
	"mime" text NOT NULL,
	"data" text NOT NULL,
	"hash" text NOT NULL,
	"credit" text,
	"source_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artist_photos" ADD CONSTRAINT "artist_photos_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The public API reads the base with the atlas_api_readonly role (it exists only on Neon).
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_api_readonly') THEN GRANT SELECT ON "artist_photos" TO atlas_api_readonly; END IF; END $$;
