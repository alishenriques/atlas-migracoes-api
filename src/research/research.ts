import type { Artist, FuzzyDate } from "../schemas/domain.js";
import {
  claimsOf,
  descriptionOf,
  entityUrl,
  getEntities,
  getSummary,
  labelOf,
  searchItems,
  type ClaimValue,
  type Entity,
  type Fetcher,
} from "./wikimedia.js";

/** Wikidata properties read for an artist, in the order they are shown. */
export const PROPERTIES = [
  { id: "P569", key: "birthDate", place: false },
  { id: "P19", key: "birthPlace", place: true },
  { id: "P570", key: "deathDate", place: false },
  { id: "P20", key: "deathPlace", place: true },
  { id: "P27", key: "citizenship", place: true },
  { id: "P106", key: "occupation", place: false },
  { id: "P135", key: "movement", place: false },
  { id: "P69", key: "educatedAt", place: false },
  { id: "P463", key: "memberOf", place: false },
  { id: "P800", key: "notableWork", place: false },
] as const;

export type FindingProperty = (typeof PROPERTIES)[number]["key"] | "summary";

/**
 * Why a finding needs a researcher's eye before anyone relies on it:
 * - `present_day_name`: Wikidata names places and states as they are today,
 *   not as they were in the period (Vilnius, not Wilno).
 * - `conflicts_with_collection`: the date disagrees with the MAC USP record.
 */
export type Review = "present_day_name" | "conflicts_with_collection";

export type Finding = {
  source: "wikidata" | "wikipedia";
  /** The page the finding was read from, so anyone can check it. */
  sourceUrl: string;
  sourceTitle: string;
  property: FindingProperty;
  /** Wikidata property id (P569…); null for a Wikipedia summary. */
  propertyId: string | null;
  /** The value as the source gives it: a label, a text, or a date as precise as the source (YYYY, YYYY-MM or YYYY-MM-DD). */
  value: string;
  /** References Wikidata attaches to the statement. */
  references: number;
  /** Referenced statements are "documented"; unreferenced statements and encyclopedia text are "undetermined". */
  reliability: "documented" | "undetermined";
  reviews: Review[];
};

export type SourceStatus = {
  source: "wikidata" | "wikipedia";
  status: "ok" | "no_match" | "error";
  detail: string | null;
};

/** The Wikidata item taken to be the artist, and why. */
export type Match = {
  id: string;
  label: string;
  description: string | null;
  url: string;
  /** `birth_year`: the only person found born in the collection's birth year; `name`: the only person with exactly that name (used when the collection has no birth year). */
  basis: "birth_year" | "name";
};

export type Research = {
  match: Match | null;
  findings: Finding[];
  sources: SourceStatus[];
  retrievedAt: string;
};

const HUMAN = "Q5";

const normalize = (text: string) =>
  text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

const isHuman = (entity: Entity) =>
  claimsOf(entity, "P31").some(({ value }) => value.kind === "item" && value.id === HUMAN);

const yearOf = (entity: Entity, property: string) => {
  const value = claimsOf(entity, property)[0]?.value;
  return value?.kind === "time" ? value.year : null;
};

/** The years a collection date can mean; "circa" is read as two years either side. */
function yearSpan(date: FuzzyDate): [number, number] | null {
  if (date.year === null) return null;
  const slack = date.precision === "circa" ? 2 : 0;
  return [date.year - slack, (date.endYear ?? date.year) + slack];
}

/**
 * Picks the Wikidata person that is this artist, or null when it is not
 * certain: never a guess. With a birth year in the collection, the one person
 * found born in it; without one, the one person with exactly the same name.
 */
export function pickMatch(artist: Artist, candidates: Entity[]): { entity: Entity; basis: Match["basis"] } | null {
  const people = candidates.filter(isHuman);
  const span = yearSpan(artist.birthDate);
  if (span) {
    const born = people.filter((entity) => {
      const year = yearOf(entity, "P569");
      return year !== null && year >= span[0] && year <= span[1];
    });
    return born.length === 1 ? { entity: born[0] as Entity, basis: "birth_year" } : null;
  }
  const named = people.filter((entity) => normalize(labelOf(entity)) === normalize(artist.name));
  return named.length === 1 ? { entity: named[0] as Entity, basis: "name" } : null;
}

function conflicts(property: FindingProperty, value: ClaimValue, artist: Artist): boolean {
  if (value.kind !== "time") return false;
  const date = property === "birthDate" ? artist.birthDate : property === "deathDate" ? artist.deathDate : null;
  const span = date ? yearSpan(date) : null;
  return span !== null && (value.year < span[0] || value.year > span[1]);
}

/** Every statement of the properties the Atlas reads, as findings traced to the item's page. */
export function wikidataFindings(entity: Entity, artist: Artist, labels: Map<string, string>): Finding[] {
  return PROPERTIES.flatMap(({ id, key, place }) =>
    claimsOf(entity, id).map(({ value, references }) => {
      const reviews: Review[] = [];
      if (place) reviews.push("present_day_name");
      if (conflicts(key, value, artist)) reviews.push("conflicts_with_collection");
      return {
        source: "wikidata" as const,
        sourceUrl: entityUrl(entity.id),
        sourceTitle: `Wikidata: ${labelOf(entity)} (${entity.id})`,
        property: key,
        propertyId: id,
        value: value.kind === "time" ? value.iso : value.kind === "item" ? (labels.get(value.id) ?? value.id) : value.text,
        references,
        reliability: references > 0 ? ("documented" as const) : ("undetermined" as const),
        reviews,
      };
    }),
  );
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Looks the artist up in open sources: the matching Wikidata item, its
 * statements on the artist's life and career, and the lead of the Wikipedia
 * article Wikidata links to (Portuguese, else English). Every finding keeps
 * its source page; nothing found here is written to the collection.
 */
export async function researchArtist(artist: Artist, fetcher: Fetcher, now = new Date()): Promise<Research> {
  const retrievedAt = now.toISOString();
  let match: { entity: Entity; basis: Match["basis"] } | null;
  try {
    const ids = await searchItems(fetcher, artist.name);
    match = pickMatch(artist, ids.length ? await getEntities(fetcher, ids) : []);
  } catch (error) {
    return {
      match: null,
      findings: [],
      sources: [{ source: "wikidata", status: "error", detail: message(error) }],
      retrievedAt,
    };
  }
  if (!match) {
    return {
      match: null,
      findings: [],
      sources: [{ source: "wikidata", status: "no_match", detail: null }],
      retrievedAt,
    };
  }

  const { entity, basis } = match;
  const sources: SourceStatus[] = [];
  const valueIds = [
    ...new Set(
      PROPERTIES.flatMap(({ id }) => claimsOf(entity, id)).flatMap(({ value }) => (value.kind === "item" ? [value.id] : [])),
    ),
  ];
  let labels = new Map<string, string>();
  try {
    labels = new Map((await getEntities(fetcher, valueIds, "labels")).map((item) => [item.id, labelOf(item)]));
    sources.push({ source: "wikidata", status: "ok", detail: null });
  } catch (error) {
    // The statements still stand; their values show as item ids until the labels load.
    sources.push({ source: "wikidata", status: "error", detail: `labels: ${message(error)}` });
  }
  const findings = wikidataFindings(entity, artist, labels);

  const article = entity.sitelinks.ptwiki
    ? { lang: "pt" as const, title: entity.sitelinks.ptwiki.title }
    : entity.sitelinks.enwiki
      ? { lang: "en" as const, title: entity.sitelinks.enwiki.title }
      : null;
  if (!article) {
    sources.push({ source: "wikipedia", status: "no_match", detail: null });
  } else {
    try {
      const summary = await getSummary(fetcher, article.lang, article.title);
      findings.push({
        source: "wikipedia",
        sourceUrl: summary.url,
        sourceTitle: `Wikipedia (${summary.lang}): ${summary.title}`,
        property: "summary",
        propertyId: null,
        value: summary.extract,
        references: 0,
        reliability: "undetermined",
        reviews: [],
      });
      sources.push({ source: "wikipedia", status: "ok", detail: null });
    } catch (error) {
      sources.push({ source: "wikipedia", status: "error", detail: message(error) });
    }
  }

  return {
    match: { id: entity.id, label: labelOf(entity), description: descriptionOf(entity), url: entityUrl(entity.id), basis },
    findings,
    sources,
    retrievedAt,
  };
}

/**
 * Keeps each artist's research for `ttlMs` (a day by default) in the running
 * instance, so the open sources are asked once per artist and not on every
 * view. A failed lookup is not kept, so the next view tries again.
 */
export function createResearchCache(fetcher: Fetcher, ttlMs = 24 * 60 * 60 * 1000, clock = () => new Date()) {
  const entries = new Map<string, { at: number; research: Promise<Research> }>();
  return (artist: Artist): Promise<Research> => {
    const now = clock();
    const cached = entries.get(artist.id);
    if (cached && now.getTime() - cached.at < ttlMs) return cached.research;
    const research = researchArtist(artist, fetcher, now).then((result) => {
      if (result.sources.some((source) => source.status === "error")) entries.delete(artist.id);
      return result;
    });
    entries.set(artist.id, { at: now.getTime(), research });
    return research;
  };
}
