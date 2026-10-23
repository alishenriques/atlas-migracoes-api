import { z } from "zod";

export const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(4000),
  /** One origin or a comma-separated list (e.g. the Vercel URL plus a custom domain). */
  CORS_ORIGIN: z
    .string()
    .default("http://localhost:3000")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().url()).min(1)),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Gemini API key (free tier). Without it the IA Relacional shows findings but no summary. */
  GEMINI_API_KEY: z.string().min(1).optional(),
  /**
   * Whether the API asks Gemini live for an artist with no stored research.
   * Off by default: the free tier's quota is per Google project, and visits
   * would spend what `yarn research:generate` needs. Stored summaries are
   * served either way.
   */
  GEMINI_LIVE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Gemini model; the "latest" alias follows Google's current free Flash model. */
  GEMINI_MODEL: z.string().min(1).default("gemini-flash-latest"),
  /** The period's state borders (CShapes 2.0), published by the app; read to give the AI the period's map. */
  CARTOGRAPHY_URL: z.string().url().default("https://atlas-migracoes.vercel.app/cartography/europe-states.geojson"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}

/**
 * How exact a date from the collection is. The spreadsheets mix full dates,
 * bare years, "c. 1949", ranges ("1940-1945") and "s.d."/"desconhecida", and
 * the platform must never present an approximate date as an exact one.
 */
export const datePrecisionSchema = z.enum(["day", "month", "year", "circa", "range", "unknown"]);

export const fuzzyDateSchema = z.object({
  /** The text exactly as it came from the source, kept for auditing. */
  raw: z.string().nullable(),
  /** First year covered; null when unknown. */
  year: z.number().int().nullable(),
  /** Last year covered (same as year unless it is a range). */
  endYear: z.number().int().nullable(),
  /** YYYY-MM-DD when the source gives a full day, YYYY-MM when it gives a month; otherwise null. */
  iso: z.string().nullable(),
  precision: datePrecisionSchema,
});

export const placeSchema = z.object({
  /** Stable slug of the full path, e.g. "brasil-sao-paulo-sao-paulo". */
  id: z.string(),
  /** Most specific name, as written in the source (historical names kept). */
  label: z.string(),
  /** Hierarchy from country to city, as written in the source. */
  path: z.array(z.string()).min(1),
  country: z.string(),
  /** Present-day name noted by the source, e.g. "Cluj-Napoca, Romênia". */
  currentName: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
});

export const artistSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string().min(1),
  birthPlaceId: z.string().nullable(),
  birthDate: fuzzyDateSchema,
  deathPlaceId: z.string().nullable(),
  deathDate: fuzzyDateSchema,
});

export const workSchema = z.object({
  /** MAC USP accession number (tombo), e.g. "1963.1.241". */
  id: z.string(),
  artistId: z.string(),
  title: z.string(),
  date: fuzzyDateSchema,
  technique: z.string().nullable(),
  dimensions: z.string().nullable(),
  acquisition: z.string().nullable(),
  acquisitionDate: fuzzyDateSchema,
  history: z.string().nullable(),
  exhibitionIds: z.array(z.string()),
  publicationIds: z.array(z.string()),
});

export const exhibitionSchema = z.object({
  /** Collection identifier, e.g. "EH.1946.06.01". */
  id: z.string(),
  title: z.string(),
  startDate: fuzzyDateSchema,
  endDate: fuzzyDateSchema,
  institution: z.string().nullable(),
  venue: z.string().nullable(),
  placeId: z.string().nullable(),
});

export const publicationSchema = z.object({
  /** Collection identifier, e.g. "PB.00002". */
  id: z.string(),
  authors: z.string().nullable(),
  title: z.string(),
  city: z.string().nullable(),
  publisher: z.string().nullable(),
  date: fuzzyDateSchema,
  category: z.string().nullable(),
  periodical: z.string().nullable(),
  volume: z.string().nullable(),
  isbn: z.string().nullable(),
  /** The source links publications to exhibitions by title, not by id. */
  relatedExhibitionTitle: z.string().nullable(),
});

export const datasetSchema = z.object({
  places: z.array(placeSchema),
  artists: z.array(artistSchema),
  works: z.array(workSchema),
  exhibitions: z.array(exhibitionSchema),
  publications: z.array(publicationSchema),
});

export type DatePrecision = z.infer<typeof datePrecisionSchema>;
export type FuzzyDate = z.infer<typeof fuzzyDateSchema>;
export type Place = z.infer<typeof placeSchema>;
export type Artist = z.infer<typeof artistSchema>;
export type Work = z.infer<typeof workSchema>;
export type Exhibition = z.infer<typeof exhibitionSchema>;
export type Publication = z.infer<typeof publicationSchema>;
export type Dataset = z.infer<typeof datasetSchema>;

/** Where the data served right now comes from. "demo" records are simulated and never historical. */
export type DataSource = "database" | "demo";
