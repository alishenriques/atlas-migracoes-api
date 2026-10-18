import { z } from "zod";

// Wikimedia asks every client to identify itself and to keep request rates
// low; answers are cached per artist (see research.ts), never fetched per view.
// https://meta.wikimedia.org/wiki/User-Agent_policy
export const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
export const USER_AGENT = "atlas-migracoes-research/0.1 (+https://github.com/alishenriques/atlas-migracoes-api)";
export const TIMEOUT_MS = 8000;

export type Fetcher = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

async function getJson(fetcher: Fetcher, url: string): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return response.json();
}

const searchSchema = z.object({
  search: z.array(z.object({ id: z.string() })),
});

/** Wikidata items whose label or alias matches the name, best first. */
export async function searchItems(fetcher: Fetcher, name: string, limit = 5): Promise<string[]> {
  const params = new URLSearchParams({
    action: "wbsearchentities",
    search: name,
    language: "pt",
    uselang: "pt",
    type: "item",
    limit: String(limit),
    format: "json",
  });
  const body = searchSchema.parse(await getJson(fetcher, `${WIKIDATA_API}?${params}`));
  return body.search.map((item) => item.id);
}

const textSchema = z.object({ value: z.string() });

const timeValueSchema = z.object({ time: z.string(), precision: z.number().int() });
const itemValueSchema = z.object({ id: z.string() });

const snakSchema = z.object({
  snaktype: z.string(),
  datavalue: z.object({ type: z.string(), value: z.unknown() }).optional(),
});

const claimSchema = z.object({
  mainsnak: snakSchema,
  rank: z.string().optional(),
  references: z.array(z.unknown()).optional(),
});

const entitySchema = z.object({
  id: z.string(),
  labels: z.record(z.string(), textSchema).default({}),
  descriptions: z.record(z.string(), textSchema).default({}),
  claims: z.record(z.string(), z.array(claimSchema)).default({}),
  sitelinks: z.record(z.string(), z.object({ title: z.string() })).default({}),
});

const entitiesSchema = z.object({
  // A missing id comes back as {id, missing: ""}, so that shape is tried first.
  entities: z.record(z.string(), z.union([z.object({ missing: z.string() }), entitySchema])),
});

export type Entity = z.infer<typeof entitySchema>;

/** A statement's value, kept as precise as Wikidata gives it. */
export type ClaimValue =
  | { kind: "time"; year: number; iso: string; precision: "year" | "month" | "day" | "coarser" }
  | { kind: "item"; id: string }
  | { kind: "text"; text: string };

/** A statement and how many references back it on Wikidata. */
export type Claim = { value: ClaimValue; references: number };

/** Fetches entities by id (at most 50 per call, Wikidata's limit). Missing ids are left out. */
export async function getEntities(
  fetcher: Fetcher,
  ids: string[],
  props = "labels|descriptions|claims|sitelinks",
): Promise<Entity[]> {
  const entities: Entity[] = [];
  for (let start = 0; start < ids.length; start += 50) {
    const params = new URLSearchParams({
      action: "wbgetentities",
      ids: ids.slice(start, start + 50).join("|"),
      props,
      languages: "pt|en",
      format: "json",
    });
    const body = entitiesSchema.parse(await getJson(fetcher, `${WIKIDATA_API}?${params}`));
    for (const entity of Object.values(body.entities)) if (!("missing" in entity)) entities.push(entity);
  }
  return entities;
}

const PRECISIONS: Record<number, "year" | "month" | "day"> = { 9: "year", 10: "month", 11: "day" };

/** Reads a statement's value; returns null for "no value", "unknown value" and types the Atlas does not use. */
export function readValue(snak: z.infer<typeof snakSchema>): ClaimValue | null {
  if (snak.snaktype !== "value" || !snak.datavalue) return null;
  const { type, value } = snak.datavalue;
  if (type === "time") {
    const time = timeValueSchema.safeParse(value);
    const match = time.success ? /^([+-])(\d+)-(\d\d)-(\d\d)/.exec(time.data.time) : null;
    if (!time.success || !match) return null;
    const [, sign, year, month, day] = match as unknown as [string, string, string, string, string];
    const precision = PRECISIONS[time.data.precision] ?? "coarser";
    const iso = precision === "day" ? `${year}-${month}-${day}` : precision === "month" ? `${year}-${month}` : year;
    return { kind: "time", year: Number(sign === "-" ? `-${year}` : year), iso, precision };
  }
  if (type === "wikibase-entityid") {
    const item = itemValueSchema.safeParse(value);
    return item.success ? { kind: "item", id: item.data.id } : null;
  }
  if (type === "string") return typeof value === "string" ? { kind: "text", text: value } : null;
  return null;
}

/** The statements of a property, preferred ones first, deprecated ones dropped. */
export function claimsOf(entity: Entity, property: string): Claim[] {
  const claims = entity.claims[property] ?? [];
  const preferred = claims.some((claim) => claim.rank === "preferred");
  return claims
    .filter((claim) => claim.rank !== "deprecated" && (!preferred || claim.rank === "preferred"))
    .flatMap((claim) => {
      const value = readValue(claim.mainsnak);
      return value ? [{ value, references: claim.references?.length ?? 0 }] : [];
    });
}

/** The entity's label in Portuguese, else English, else its id. */
export const labelOf = (entity: Pick<Entity, "id" | "labels">) =>
  entity.labels.pt?.value ?? entity.labels.en?.value ?? entity.id;

export const descriptionOf = (entity: Entity) => entity.descriptions.pt?.value ?? entity.descriptions.en?.value ?? null;

export const entityUrl = (id: string) => `https://www.wikidata.org/wiki/${id}`;

const summarySchema = z.object({
  title: z.string(),
  extract: z.string(),
  content_urls: z.object({ desktop: z.object({ page: z.string() }) }),
});

export type WikipediaSummary = { lang: "pt" | "en"; title: string; extract: string; url: string };

/** The lead section of a Wikipedia article, by the exact title Wikidata links to. */
export async function getSummary(fetcher: Fetcher, lang: "pt" | "en", title: string): Promise<WikipediaSummary> {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replaceAll(" ", "_"))}`;
  const body = summarySchema.parse(await getJson(fetcher, url));
  return { lang, title: body.title, extract: body.extract, url: body.content_urls.desktop.page };
}
