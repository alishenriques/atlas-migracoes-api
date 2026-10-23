import { z } from "zod";
import type { Artist, Place } from "../schemas/domain.js";
import { USER_AGENT, type Fetcher } from "./wikimedia.js";

// The app publishes Europe's state borders by period (CShapes 2.0, see the app's
// public/cartography/README.md) and, beside them, the name each state had on
// each day (state-names.json): CShapes gives a state one English name for its
// whole existence. The IA Relacional reads the same files, so the model is told
// the states of the artist's time, by their names then, and never infers them.

/** Days CShapes covers. */
export const COVERAGE = { start: "1886-01-01", end: "2019-12-31" } as const;

type Position = [number, number];
type Ring = Position[];

const ringSchema = z.array(z.tuple([z.number(), z.number()]));
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const bordersSchema = z.object({
  features: z.array(
    z.object({
      properties: z.object({ name: z.string(), start: isoDay, end: isoDay }),
      geometry: z.union([
        z.object({ type: z.literal("Polygon"), coordinates: z.array(ringSchema) }),
        z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(ringSchema)) }),
      ]),
    }),
  ),
});

/**
 * Per CShapes name, the state's names in order, each valid through `until`
 * (inclusive) and the last one open-ended. Only the Portuguese one goes to the model.
 */
const namesSchema = z.record(
  z.string(),
  z
    .array(z.object({ until: isoDay.optional(), pt: z.string().min(1) }))
    .min(1)
    .refine(
      (periods) =>
        periods.every(({ until }, index) => {
          const next = periods[index + 1];
          if (!next) return until === undefined;
          return until !== undefined && (next.until === undefined || until < next.until);
        }),
      "periods must be in order, every one but the last with an `until`",
    ),
);

/** The borders and the names of the states by period. */
export type States = z.infer<typeof bordersSchema> & { names: z.infer<typeof namesSchema> };

/** The names file, published beside the borders file. */
export const namesUrl = (bordersUrl: string) => new URL("state-names.json", bordersUrl).toString();

async function getJson(fetcher: Fetcher, url: string, accept: string): Promise<unknown> {
  const response = await fetcher(url, { headers: { "User-Agent": USER_AGENT, Accept: accept } });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return response.json();
}

/** Downloads and validates the borders file and the names beside it. */
export async function loadStates(fetcher: Fetcher, url: string): Promise<States> {
  const [borders, names] = await Promise.all([
    getJson(fetcher, url, "application/geo+json"),
    getJson(fetcher, namesUrl(url), "application/json"),
  ]);
  return { ...bordersSchema.parse(borders), names: namesSchema.parse(names) };
}

/** The state's name on a day, or the source's name when the table does not know the state. */
export function periodName(states: States, source: string, day: string): string {
  return states.names[source]?.find(({ until }) => until === undefined || day <= until)?.pt ?? source;
}

/** Even-odd ray casting: whether the point is inside the ring. */
function inRing([x, y]: Position, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i] as Position;
    const [xj, yj] = ring[j] as Position;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring and outside every hole. */
const inPolygon = (point: Position, [outer, ...holes]: Ring[]) =>
  outer !== undefined && inRing(point, outer) && !holes.some((hole) => inRing(point, hole));

const inForce = (states: States, day: string) =>
  states.features.filter(({ properties }) => properties.start <= day && day <= properties.end);

/** Names of the states in force on a day, as they were called that day, alphabetical. */
export function statesOn(states: States, day: string): string[] {
  const names = inForce(states, day).map((feature) => periodName(states, feature.properties.name, day));
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, "pt"));
}

/** The state that held a point on a day, by its name that day, or null (sea, no state's territory, or outside the map). */
export function stateAt(states: States, day: string, lng: number, lat: number): string | null {
  const feature = inForce(states, day).find(({ geometry }) =>
    geometry.type === "Polygon"
      ? inPolygon([lng, lat], geometry.coordinates)
      : geometry.coordinates.some((polygon) => inPolygon([lng, lat], polygon)),
  );
  return feature ? periodName(states, feature.properties.name, day) : null;
}

/** The map of the artist's birth: the states of Europe then, and the one that held the birthplace. */
export type PeriodContext = {
  /** The day the map is read on: 1 July of the birth year, as on the Camada Histórica. */
  day: string;
  /** Whether the birth year is approximate ("c.") or a range in the collection. */
  approximate: boolean;
  /** The state that held the birthplace that day; null when it has no coordinates or no state held it. */
  birthState: string | null;
  states: string[];
};

/** Null when the birth year is unknown or outside the period the borders cover. */
export function periodContext(states: States, artist: Artist, birthPlace: Place | null): PeriodContext | null {
  const { year, precision } = artist.birthDate;
  if (year === null) return null;
  const day = `${String(year).padStart(4, "0")}-07-01`;
  if (day < COVERAGE.start || day > COVERAGE.end) return null;
  const birthState =
    birthPlace && birthPlace.lat !== null && birthPlace.lng !== null
      ? stateAt(states, day, birthPlace.lng, birthPlace.lat)
      : null;
  return { day, approximate: precision === "circa" || precision === "range", birthState, states: statesOn(states, day) };
}

/**
 * Loads the borders and names once per instance and keeps them; a failed load is not
 * kept, so the next research tries again. Resolves to null on failure, since the
 * research goes on without the period's map.
 */
export function createStatesLoader(fetcher: Fetcher, url: string): () => Promise<States | null> {
  let pending: Promise<States> | undefined;
  return async () => {
    pending ??= loadStates(fetcher, url);
    try {
      return await pending;
    } catch {
      pending = undefined;
      return null;
    }
  };
}
