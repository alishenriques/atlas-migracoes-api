import { z } from "zod";
import type { Place } from "../schemas/domain.js";

// Nominatim (OpenStreetMap) usage policy: at most one request per second, an
// identifying User-Agent, and results cached instead of looked up live. The
// map never calls it: coordinates are stored once in `places`, after review.
// https://operations.osmfoundation.org/policies/nominatim/
export const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
export const USER_AGENT = "atlas-migracoes-geocode/0.1 (+https://github.com/alishenriques/atlas-migracoes-api)";
export const MIN_INTERVAL_MS = 1100;

const resultSchema = z.object({
  lat: z.coerce.number(),
  lon: z.coerce.number(),
  display_name: z.string(),
  osm_type: z.string().optional(),
  osm_id: z.coerce.number().optional(),
  addresstype: z.string().optional(),
  importance: z.coerce.number().optional(),
});

export type GeocodeCandidate = {
  lat: number;
  lng: number;
  displayName: string;
  osm: string | null;
  kind: string | null;
};

/**
 * The text sent to Nominatim. A present-day name noted by the source wins
 * ("Sebastopol, Ucrânia"); otherwise the hierarchy from the most specific
 * name up, with repeated neighbours merged ("São Paulo, São Paulo, Brasil"
 * becomes "São Paulo, Brasil").
 */
export function buildQuery(place: Pick<Place, "path" | "currentName">): string {
  if (place.currentName) return place.currentName;
  const parts = [...place.path].reverse();
  return parts.filter((part, index) => part !== parts[index - 1]).join(", ");
}

export function parseCandidates(body: unknown): GeocodeCandidate[] {
  return z
    .array(resultSchema)
    .parse(body)
    .map((result) => ({
      lat: result.lat,
      lng: result.lon,
      displayName: result.display_name,
      osm: result.osm_type && result.osm_id ? `${result.osm_type}/${result.osm_id}` : null,
      kind: result.addresstype ?? null,
    }));
}

export type Fetcher = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function searchPlace(query: string, fetcher: Fetcher = fetch): Promise<GeocodeCandidate | null> {
  const url = `${NOMINATIM_URL}?${new URLSearchParams({ q: query, format: "jsonv2", limit: "1", "accept-language": "pt" })}`;
  const response = await fetcher(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`Nominatim respondeu ${response.status} para "${query}"`);
  return parseCandidates(await response.json())[0] ?? null;
}
