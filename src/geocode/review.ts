import { z } from "zod";
import type { Place } from "../schemas/domain.js";
import { buildQuery, MIN_INTERVAL_MS, searchPlace, type Fetcher } from "./nominatim.js";

/**
 * One line of the review file. `auto` came from Nominatim and still needs a
 * look; `reviewed` was checked (or typed in) by a person; `not_found` needs
 * coordinates by hand. Only `reviewed` and `auto` entries with coordinates are
 * applied to the database.
 */
export const reviewEntrySchema = z.object({
  id: z.string(),
  path: z.array(z.string()),
  currentName: z.string().nullable(),
  query: z.string(),
  status: z.enum(["auto", "reviewed", "not_found"]),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  displayName: z.string().nullable(),
  osm: z.string().nullable(),
  kind: z.string().nullable(),
});

export const reviewFileSchema = z.array(reviewEntrySchema);

export type ReviewEntry = z.infer<typeof reviewEntrySchema>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Geocodes the places not yet in `previous`, one request at a time. Entries
 * already in the file are kept untouched, so a person's review is never lost
 * and an interrupted run resumes where it stopped.
 */
export async function geocodePlaces(
  places: Place[],
  previous: ReviewEntry[],
  { fetcher, interval = MIN_INTERVAL_MS, onEntry }: { fetcher?: Fetcher; interval?: number; onEntry?: (entry: ReviewEntry) => void } = {},
): Promise<ReviewEntry[]> {
  const known = new Map(previous.map((entry) => [entry.id, entry]));
  const result: ReviewEntry[] = [];
  let first = true;

  for (const place of places) {
    const existing = known.get(place.id);
    if (existing) {
      result.push(existing);
      continue;
    }
    if (!first) await sleep(interval);
    first = false;

    const query = buildQuery(place);
    const candidate = await searchPlace(query, fetcher);
    const entry: ReviewEntry = {
      id: place.id,
      path: place.path,
      currentName: place.currentName,
      query,
      status: candidate ? "auto" : "not_found",
      lat: candidate?.lat ?? null,
      lng: candidate?.lng ?? null,
      displayName: candidate?.displayName ?? null,
      osm: candidate?.osm ?? null,
      kind: candidate?.kind ?? null,
    };
    onEntry?.(entry);
    result.push(entry);
  }
  return result;
}
