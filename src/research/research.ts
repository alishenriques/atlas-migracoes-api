import type { Artist, FuzzyDate, Place } from "../schemas/domain.js";
import { summarize, type GeminiConfig, type Summary } from "./summary.js";
import { periodContext, type PeriodContext, type States } from "./territories.js";
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
  /**
   * `birth_year`: the only person found born in the collection's birth year;
   * `name`: the only person with exactly that name (used when the collection
   * has no birth year); `reviewed`: a researcher confirmed this item in the
   * reviewed list of links (see links.ts), and no search was made.
   */
  basis: "birth_year" | "name" | "reviewed";
  /** The researcher's note on a reviewed link; null otherwise. */
  note: string | null;
};

/**
 * A researcher's decision on which Wikidata item is the artist, from the
 * reviewed list of links: the confirmed item is used without searching, and
 * rejected items are never matched nor offered as candidates.
 */
export type WikidataLink = { confirmed: string | null; rejected: string[]; note: string | null };

/**
 * Why a person Wikidata returned was not taken to be the artist:
 * - `birth_year_differs`: Wikidata gives another birth year than the collection.
 * - `no_birth_year`: Wikidata has no birth year to compare.
 * - `ambiguous`: more than one person fits the collection's birth year (or name).
 * - `shorter_name`: fits, but only turned up when searching a shorter form of the name.
 * - `name_differs`: the collection has no birth year and the name is not exactly the same.
 */
export type CandidateReason = "birth_year_differs" | "no_birth_year" | "ambiguous" | "shorter_name" | "name_differs";

/** A person Wikidata returned that was not linked to the artist: a lead for a researcher to check, never a finding. */
export type Candidate = {
  id: string;
  label: string;
  description: string | null;
  url: string;
  birthYear: number | null;
  /** The name that was searched when this person turned up. */
  foundBy: string;
  reason: CandidateReason;
};

export type Research = {
  /** The names searched on Wikidata: the collection's, then a shorter form when it has middle names. */
  searchedNames: string[];
  match: Match | null;
  /** Up to five people Wikidata returned but none certainly the artist; empty when there is a match. */
  candidates: Candidate[];
  findings: Finding[];
  sources: SourceStatus[];
  /** The map of Europe at the artist's birth, given to the model; null when unknown. */
  period: PeriodContext | null;
  /** The AI summary of the findings, with its prompt. */
  summary: Summary;
  retrievedAt: string;
};

/** Where the artist was born and died, as the collection records it. */
export type ArtistPlaces = { birth: Place | null; death: Place | null };

export type ResearchDeps = {
  fetcher: Fetcher;
  /** Null when no Gemini key is configured. */
  gemini: GeminiConfig | null;
  /** The period's borders; null when they could not be loaded. */
  states: () => Promise<States | null>;
  /** The reviewed link for an artist, when there is one (generation only; the API itself does not read the list). */
  links?: (artist: Artist) => WikidataLink | null;
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

/** The collection's name, then first and last name only when it has middle names ("Maciej Antoni Babinski" → "Maciej Babinski"). */
export function searchNames(name: string): string[] {
  const parts = name.trim().split(/\s+/);
  return parts.length > 2 ? [name, `${parts[0]} ${parts.at(-1)}`] : [name];
}

/**
 * The people returned for the artist's names, each with why it was not
 * linked. Only called when there is no match, so a person that fits was
 * either one of several or found under a shorter name.
 */
export function candidatesOf(artist: Artist, entities: Entity[], foundBy: Map<string, string>): Candidate[] {
  const span = yearSpan(artist.birthDate);
  const fits = (entity: Entity) => {
    if (!span) return normalize(labelOf(entity)) === normalize(artist.name);
    const year = yearOf(entity, "P569");
    return year !== null && year >= span[0] && year <= span[1];
  };
  return entities
    .filter(isHuman)
    .slice(0, 5)
    .map((entity) => {
      const birthYear = yearOf(entity, "P569");
      const by = foundBy.get(entity.id) ?? artist.name;
      const reason: CandidateReason = fits(entity)
        ? by === artist.name
          ? "ambiguous"
          : "shorter_name"
        : !span
          ? "name_differs"
          : birthYear === null
            ? "no_birth_year"
            : "birth_year_differs";
      return { id: entity.id, label: labelOf(entity), description: descriptionOf(entity), url: entityUrl(entity.id), birthYear, foundBy: by, reason };
    });
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
 * The matching Wikidata item, its statements on the artist's life and career,
 * and the lead of the Wikipedia article Wikidata links to (Portuguese, else
 * English). Every finding keeps its source page.
 */
async function lookUp(
  artist: Artist,
  fetcher: Fetcher,
  link: WikidataLink | null,
): Promise<Pick<Research, "searchedNames" | "match" | "candidates" | "findings" | "sources">> {
  // A confirmed link replaces the search, so no name is searched.
  const searchedNames = link?.confirmed ? [] : searchNames(artist.name);
  const none = { searchedNames, match: null, candidates: [], findings: [] };
  let match: { entity: Entity; basis: Match["basis"] } | null;
  let candidates: Candidate[] = [];
  try {
    if (link?.confirmed) {
      const [entity] = await getEntities(fetcher, [link.confirmed]);
      if (!entity) throw new Error(`reviewed item ${link.confirmed} not found`);
      match = { entity, basis: "reviewed" };
    } else {
      // Each id remembers the first name that found it; only the collection's own name can give a match.
      const rejected = new Set(link?.rejected ?? []);
      const foundBy = new Map<string, string>();
      for (const name of searchedNames) {
        for (const id of await searchItems(fetcher, name)) if (!foundBy.has(id) && !rejected.has(id)) foundBy.set(id, name);
      }
      const entities = foundBy.size ? await getEntities(fetcher, [...foundBy.keys()]) : [];
      match = pickMatch(artist, entities.filter((entity) => foundBy.get(entity.id) === artist.name));
      if (!match) candidates = candidatesOf(artist, entities, foundBy);
    }
  } catch (error) {
    return { ...none, sources: [{ source: "wikidata", status: "error", detail: message(error) }] };
  }
  if (!match) {
    return { ...none, candidates, sources: [{ source: "wikidata", status: "no_match", detail: null }] };
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
    searchedNames,
    match: {
      id: entity.id,
      label: labelOf(entity),
      description: descriptionOf(entity),
      url: entityUrl(entity.id),
      basis,
      note: basis === "reviewed" ? (link?.note ?? null) : null,
    },
    candidates: [],
    findings,
    sources,
  };
}

/**
 * Looks the artist up in open sources (see `lookUp`), reads the map of Europe
 * at their birth, and asks the model to summarise the findings within that
 * period's geopolitics. Nothing found here is written to the collection.
 */
export async function researchArtist(
  artist: Artist,
  places: ArtistPlaces,
  deps: ResearchDeps,
  now = new Date(),
): Promise<Research> {
  const [found, states] = await Promise.all([lookUp(artist, deps.fetcher, deps.links?.(artist) ?? null), deps.states()]);
  const period = states ? periodContext(states, artist, places.birth) : null;
  const summary = await summarize(deps.fetcher, deps.gemini, {
    artist,
    birthPlace: places.birth,
    deathPlace: places.death,
    match: found.match,
    findings: found.findings,
    period,
  });
  return { ...found, period, summary, retrievedAt: now.toISOString() };
}

/** True when a source or the summary failed, so the result is incomplete. */
export function hasFailure(research: Research): boolean {
  return research.sources.some((source) => source.status === "error") || research.summary.status === "error";
}

/**
 * Keeps each artist's research for `ttlMs` (a day by default) in the running
 * instance, so the open sources and the model are asked once per artist and
 * not on every view. A result generated ahead of time (`stored`, see
 * stored.ts) is used first; only artists without one are researched live.
 * A failed lookup or summary is kept only for `retryMs` (five minutes by
 * default): long enough that a burst of views, or someone hammering the API
 * after Gemini answered 429, does not ask again on every request, short
 * enough that the next visitor gets a fresh try.
 */
export function createResearchCache(
  deps: ResearchDeps & { stored?: (artist: Artist) => Promise<Research | null> },
  ttlMs = 24 * 60 * 60 * 1000,
  clock = () => new Date(),
  retryMs = 5 * 60 * 1000,
) {
  const entries = new Map<string, { at: number; ttl: number; research: Promise<Research> }>();
  const fromStore = (artist: Artist) => (deps.stored ? deps.stored(artist).catch(() => null) : Promise.resolve(null));
  return (artist: Artist, places: ArtistPlaces): Promise<Research> => {
    const now = clock();
    const cached = entries.get(artist.id);
    if (cached && now.getTime() - cached.at < cached.ttl) return cached.research;
    const timing = { at: now.getTime(), ttl: ttlMs };
    const research = fromStore(artist).then(async (stored) => {
      if (stored) return stored;
      const result = await researchArtist(artist, places, deps, now);
      if (hasFailure(result)) timing.ttl = Math.min(ttlMs, retryMs);
      return result;
    });
    entries.set(artist.id, Object.assign(timing, { research }));
    return research;
  };
}
