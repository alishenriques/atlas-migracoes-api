import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import type { DatasetIndex } from "../db/dataset.js";
import { researchResults } from "../db/schema.js";
import type { Artist } from "../schemas/domain.js";
import { hasFailure, researchArtist, type ArtistPlaces, type Research, type ResearchDeps } from "./research.js";

/** Reads an artist's stored research; null when there is none. */
export type StoredResearch = (artist: Artist) => Promise<Research | null>;

export function storedResearch(db: Database): StoredResearch {
  return async (artist) => {
    const [row] = await db
      .select({ research: researchResults.research })
      .from(researchResults)
      .where(eq(researchResults.artistId, artist.id));
    if (!row) return null;
    // Results stored before searched names and candidates were recorded lack them.
    const { searchedNames = [], candidates = [] }: Partial<Research> = row.research;
    return { ...row.research, searchedNames, candidates };
  };
}

export function placesOf(artist: Artist, data: DatasetIndex): ArtistPlaces {
  const place = (id: string | null) => (id ? (data.place.get(id) ?? null) : null);
  return { birth: place(artist.birthPlaceId), death: place(artist.deathPlaceId) };
}

export type GenerateOptions = {
  /** Only these artists (by slug); all of them when empty. */
  slugs?: string[];
  /** Ask again for artists that already have a stored result. */
  force?: boolean;
  /** Pause between artists, to stay inside the Gemini free tier's requests per minute. */
  delayMs?: number;
  /**
   * Further tries for an artist whose research failed (a 503 from an
   * overloaded Gemini, a timeout), each after a longer wait: retryDelayMs,
   * then twice that, and so on. A 429 is not tried again: the free tier's
   * daily quota is spent, and waiting a minute does not bring it back.
   */
  retries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => Date;
};

export type GenerateOutcome = {
  slug: string;
  outcome: "stored" | "kept" | "failed";
  /** The summary's status, or the failing source, so the run can be reviewed. */
  detail: string;
};

/** True when Gemini refused for quota (429); trying again the same day only spends the run's time. */
export function quotaExhausted(research: Research): boolean {
  return research.summary.status === "error" && (research.summary.detail ?? "").includes("429");
}

/**
 * Researches each artist live and stores the complete results. Run from the
 * machine that owns the database (`yarn research:generate`); the API itself
 * only reads them. An incomplete result is reported and not stored, so the
 * API keeps asking live for that artist and the run can be repeated later.
 */
export async function generateResearch(
  db: Database,
  data: DatasetIndex,
  deps: ResearchDeps,
  options: GenerateOptions = {},
): Promise<GenerateOutcome[]> {
  const { slugs = [], force = false, delayMs = 6000, retries = 2, retryDelayMs = 30_000, clock = () => new Date() } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const read = storedResearch(db);
  const artists = data.dataset.artists.filter((artist) => slugs.length === 0 || slugs.includes(artist.slug));
  const outcomes: GenerateOutcome[] = [];

  for (const artist of artists) {
    if (!force && (await read(artist))) {
      outcomes.push({ slug: artist.slug, outcome: "kept", detail: "already stored" });
      continue;
    }
    if (outcomes.some((outcome) => outcome.outcome !== "kept")) await sleep(delayMs);

    let now = clock();
    let research = await researchArtist(artist, placesOf(artist, data), deps, now);
    for (let attempt = 0; attempt < retries && hasFailure(research) && !quotaExhausted(research); attempt++) {
      await sleep(retryDelayMs * 2 ** attempt);
      now = clock();
      research = await researchArtist(artist, placesOf(artist, data), deps, now);
    }
    if (hasFailure(research)) {
      const failed = research.sources.find((source) => source.status === "error");
      outcomes.push({
        slug: artist.slug,
        outcome: "failed",
        detail: failed ? `${failed.source}: ${failed.detail ?? "error"}` : `summary: ${research.summary.detail ?? "error"}`,
      });
      continue;
    }
    await db
      .insert(researchResults)
      .values({ artistId: artist.id, research, generatedAt: now })
      .onConflictDoUpdate({ target: researchResults.artistId, set: { research, generatedAt: now } });
    outcomes.push({ slug: artist.slug, outcome: "stored", detail: `summary: ${research.summary.status}` });
  }
  return outcomes;
}
