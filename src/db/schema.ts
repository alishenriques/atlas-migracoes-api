import { doublePrecision, jsonb, pgTable, primaryKey, serial, text, timestamp } from "drizzle-orm/pg-core";
import type { Research } from "../research/research.js";
import type { FuzzyDate } from "../schemas/domain.js";

// Dates from the collection are fuzzy ("c. 1949", "1940-45", "s.d."), so they
// are stored whole as jsonb (see fuzzyDateSchema) instead of a lossy date column.
const fuzzyDate = (name: string) => jsonb(name).$type<FuzzyDate>().notNull();

export const places = pgTable("places", {
  /** Slug of the full path, e.g. "brasil-sao-paulo-sao-paulo". */
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  path: text("path").array().notNull(),
  country: text("country").notNull(),
  currentName: text("current_name"),
  // Null until geocoded; the map leaves ungeocoded places out instead of guessing.
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
});

export const artists = pgTable("artists", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  birthPlaceId: text("birth_place_id").references(() => places.id),
  birthDate: fuzzyDate("birth_date"),
  deathPlaceId: text("death_place_id").references(() => places.id),
  deathDate: fuzzyDate("death_date"),
});

export const works = pgTable("works", {
  /** MAC USP accession number (tombo). */
  id: text("id").primaryKey(),
  artistId: text("artist_id")
    .notNull()
    .references(() => artists.id),
  title: text("title").notNull(),
  date: fuzzyDate("date"),
  technique: text("technique"),
  dimensions: text("dimensions"),
  acquisition: text("acquisition"),
  acquisitionDate: fuzzyDate("acquisition_date"),
  history: text("history"),
});

export const exhibitions = pgTable("exhibitions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  startDate: fuzzyDate("start_date"),
  endDate: fuzzyDate("end_date"),
  institution: text("institution"),
  venue: text("venue"),
  placeId: text("place_id").references(() => places.id),
});

export const publications = pgTable("publications", {
  id: text("id").primaryKey(),
  authors: text("authors"),
  title: text("title").notNull(),
  city: text("city"),
  publisher: text("publisher"),
  date: fuzzyDate("date"),
  category: text("category"),
  periodical: text("periodical"),
  volume: text("volume"),
  isbn: text("isbn"),
  relatedExhibitionTitle: text("related_exhibition_title"),
});

// Only references that resolve are stored here; the rest go to the import report.
export const workExhibitions = pgTable(
  "work_exhibitions",
  {
    workId: text("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    exhibitionId: text("exhibition_id")
      .notNull()
      .references(() => exhibitions.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.workId, table.exhibitionId] })],
);

export const workPublications = pgTable(
  "work_publications",
  {
    workId: text("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.workId, table.publicationId] })],
);

/** One row per spreadsheet import, with what could not be resolved, for review. */
export const importBatches = pgTable("import_batches", {
  id: serial("id").primaryKey(),
  importedAt: timestamp("imported_at", { withTimezone: true }).defaultNow().notNull(),
  files: text("files").array().notNull(),
  report: jsonb("report").$type<ImportReport>().notNull(),
});

export type ImportReport = {
  counts: Record<"places" | "artists" | "works" | "exhibitions" | "publications", number>;
  unresolvedExhibitionRefs: { workId: string; exhibitionId: string }[];
  unresolvedPublicationRefs: { workId: string; publicationId: string }[];
  warnings: string[];
};

/**
 * Open-source research generated ahead of time (`yarn research:generate`), so
 * public traffic reads it here instead of calling Wikimedia and Gemini live.
 * Only complete results are stored; the API asks live for artists without one.
 */
export const researchResults = pgTable("research_results", {
  artistId: text("artist_id")
    .primaryKey()
    .references(() => artists.id, { onDelete: "cascade" }),
  research: jsonb("research").$type<Research>().notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
});

/**
 * Artists' photos (`yarn photos:import`), kept in the base rather than in this
 * public repository. `data` is the file in base64; `hash` changes with it, so
 * the photo's URL can be cached for good.
 */
export const artistPhotos = pgTable("artist_photos", {
  artistId: text("artist_id")
    .primaryKey()
    .references(() => artists.id, { onDelete: "cascade" }),
  mime: text("mime").notNull(),
  data: text("data").notNull(),
  hash: text("hash").notNull(),
  /** Who holds the photo or where it was published; null while unknown, never guessed. */
  credit: text("credit"),
  sourceUrl: text("source_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
