import { isDeepStrictEqual } from "node:util";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import type { DatasetIndex } from "../db/dataset.js";
import { researchResults } from "../db/schema.js";
import type { Artist } from "../schemas/domain.js";
import { hasFailure, researchArtist, type ArtistPlaces, type Research, type ResearchDeps } from "./research.js";
import { periodContext } from "./territories.js";

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
  /**
   * Ask again only for stored results whose period's map is no longer the one
   * the borders and state names give today (and for artists with no result).
   * Repeating the run after a 429 picks up where it stopped.
   */
  stalePeriod?: boolean;
  /**
   * Most calls to Gemini in this run, retries included; the artists left are
   * reported as skipped. Unlimited when absent.
   */
  limit?: number;
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
  outcome: "stored" | "kept" | "failed" | "skipped";
  /** The summary's status, or the failing source, so the run can be reviewed. */
  detail: string;
};

/**
 * True when Gemini refused for its daily quota (429); trying again the same day
 * only spends requests. A 429 for the per-minute quota is not: it passes after a wait.
 */
export function quotaExhausted(research: Research): boolean {
  const detail = research.summary.detail ?? "";
  return research.summary.status === "error" && detail.includes("429") && !detail.includes("PerMinute");
}

/** Whether this research asked Gemini (any answer, or an error from it). */
const askedGemini = (research: Research) => ["ok", "rejected", "error"].includes(research.summary.status);

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
  const { slugs = [], force = false, stalePeriod = false, limit = Infinity, delayMs = 6000, retries = 2, retryDelayMs = 30_000, clock = () => new Date() } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const read = storedResearch(db);
  const artists = data.dataset.artists.filter((artist) => slugs.length === 0 || slugs.includes(artist.slug));
  const outcomes: GenerateOutcome[] = [];
  const states = stalePeriod ? await deps.states() : null;
  if (stalePeriod && !states) throw new Error("the period's map could not be loaded, so stale results cannot be told apart");

  let calls = 0;
  let stop: string | null = null;

  for (const artist of artists) {
    if (stop === null && calls >= limit) stop = `limit of ${limit} Gemini calls reached`;
    if (stop !== null) {
      outcomes.push({ slug: artist.slug, outcome: "skipped", detail: stop });
      continue;
    }
    const stored = force ? null : await read(artist);
    const stale =
      stored !== null &&
      states !== null &&
      !isDeepStrictEqual(stored.period ?? null, periodContext(states, artist, placesOf(artist, data).birth));
    if (stored && !stale) {
      outcomes.push({ slug: artist.slug, outcome: "kept", detail: stalePeriod ? "period unchanged" : "already stored" });
      continue;
    }
    if (outcomes.some((outcome) => outcome.outcome !== "kept")) await sleep(delayMs);

    let now = clock();
    let research = await researchArtist(artist, placesOf(artist, data), deps, now);
    if (askedGemini(research)) calls++;
    for (let attempt = 0; attempt < retries && hasFailure(research) && !quotaExhausted(research) && calls < limit; attempt++) {
      await sleep(retryDelayMs * 2 ** attempt);
      now = clock();
      research = await researchArtist(artist, placesOf(artist, data), deps, now);
      if (askedGemini(research)) calls++;
    }
    // With the daily quota spent, every further call is one more refused request.
    if (quotaExhausted(research)) stop = "Gemini's daily quota is spent";
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
