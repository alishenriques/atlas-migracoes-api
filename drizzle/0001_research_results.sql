CREATE TABLE "research_results" (
	"artist_id" text PRIMARY KEY NOT NULL,
	"research" jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_results" ADD CONSTRAINT "research_results_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;