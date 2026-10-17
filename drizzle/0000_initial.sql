CREATE TABLE "artists" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"birth_place_id" text,
	"birth_date" jsonb NOT NULL,
	"death_place_id" text,
	"death_date" jsonb NOT NULL,
	CONSTRAINT "artists_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "exhibitions" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"start_date" jsonb NOT NULL,
	"end_date" jsonb NOT NULL,
	"institution" text,
	"venue" text,
	"place_id" text
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"files" text[] NOT NULL,
	"report" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"path" text[] NOT NULL,
	"country" text NOT NULL,
	"current_name" text,
	"lat" double precision,
	"lng" double precision
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" text PRIMARY KEY NOT NULL,
	"authors" text,
	"title" text NOT NULL,
	"city" text,
	"publisher" text,
	"date" jsonb NOT NULL,
	"category" text,
	"periodical" text,
	"volume" text,
	"isbn" text,
	"related_exhibition_title" text
);
--> statement-breakpoint
CREATE TABLE "work_exhibitions" (
	"work_id" text NOT NULL,
	"exhibition_id" text NOT NULL,
	CONSTRAINT "work_exhibitions_work_id_exhibition_id_pk" PRIMARY KEY("work_id","exhibition_id")
);
--> statement-breakpoint
CREATE TABLE "work_publications" (
	"work_id" text NOT NULL,
	"publication_id" text NOT NULL,
	CONSTRAINT "work_publications_work_id_publication_id_pk" PRIMARY KEY("work_id","publication_id")
);
--> statement-breakpoint
CREATE TABLE "works" (
	"id" text PRIMARY KEY NOT NULL,
	"artist_id" text NOT NULL,
	"title" text NOT NULL,
	"date" jsonb NOT NULL,
	"technique" text,
	"dimensions" text,
	"acquisition" text,
	"acquisition_date" jsonb NOT NULL,
	"history" text
);
--> statement-breakpoint
ALTER TABLE "artists" ADD CONSTRAINT "artists_birth_place_id_places_id_fk" FOREIGN KEY ("birth_place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artists" ADD CONSTRAINT "artists_death_place_id_places_id_fk" FOREIGN KEY ("death_place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibitions" ADD CONSTRAINT "exhibitions_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_exhibitions" ADD CONSTRAINT "work_exhibitions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_exhibitions" ADD CONSTRAINT "work_exhibitions_exhibition_id_exhibitions_id_fk" FOREIGN KEY ("exhibition_id") REFERENCES "public"."exhibitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_publications" ADD CONSTRAINT "work_publications_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_publications" ADD CONSTRAINT "work_publications_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;