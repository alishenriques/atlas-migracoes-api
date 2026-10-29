import { GraphQLError } from "graphql";
import { createSchema } from "graphql-yoga";
import type { AppContext } from "../context.js";
import type { DatasetIndex } from "../db/dataset.js";
import { slugify } from "../import/parse.js";
import type { Artist, Exhibition, Place, Publication, Work } from "../schemas/domain.js";

export const typeDefs = /* GraphQL */ `
  "Where the data comes from. 'demo' means simulated records: the app must label them as such."
  enum DataSource {
    database
    demo
  }

  "How exact a date is. Never show an approximate date as an exact one."
  enum DatePrecision {
    day
    month
    year
    circa
    range
    unknown
  }

  type FuzzyDate {
    "The text exactly as written in the source."
    raw: String
    year: Int
    "Last year covered; equals year unless precision is range."
    endYear: Int
    "YYYY-MM-DD when precision is day, YYYY-MM when it is month; otherwise null."
    iso: String
    precision: DatePrecision!
  }

  type Place {
    id: ID!
    "Most specific name, as written in the source (historical names kept)."
    label: String!
    "Country to city, as written in the source."
    path: [String!]!
    country: String!
    "Present-day name noted by the source, e.g. 'Sebastopol, Ucrânia'."
    currentName: String
    "Null until geocoded."
    lat: Float
    lng: Float
  }

  type Artist {
    id: ID!
    slug: String!
    name: String!
    birthPlace: Place
    birthDate: FuzzyDate!
    deathPlace: Place
    deathDate: FuzzyDate!
    works: [Work!]!
    "Exhibitions where any of this artist's works in the collection were shown, oldest first."
    exhibitions: [Exhibition!]!
    publications: [Publication!]!
    "The artist's photo; null while the base has none."
    photo: ArtistPhoto
  }

  type ArtistPhoto {
    "Absolute URL of the image. It changes whenever the photo does, so it can be cached for good."
    url: String!
    "Who holds the photo or where it was published; null while unknown."
    credit: String
    sourceUrl: String
  }

  type Work {
    "MAC USP accession number (tombo)."
    id: ID!
    title: String!
    date: FuzzyDate!
    technique: String
    dimensions: String
    acquisition: String
    acquisitionDate: FuzzyDate!
    history: String
    artist: Artist!
    exhibitions: [Exhibition!]!
    publications: [Publication!]!
  }

  type Exhibition {
    id: ID!
    title: String!
    startDate: FuzzyDate!
    endDate: FuzzyDate!
    institution: String
    venue: String
    place: Place
    works: [Work!]!
  }

  type Publication {
    id: ID!
    authors: String
    title: String!
    city: String
    publisher: String
    date: FuzzyDate!
    category: String
    periodical: String
    volume: String
    isbn: String
    "The source links publications to exhibitions by title, not by id."
    relatedExhibitionTitle: String
    works: [Work!]!
  }

  type Stats {
    artists: Int!
    works: Int!
    exhibitions: Int!
    publications: Int!
    places: Int!
    "Distinct countries of birth among the artists."
    originCountries: Int!
  }

  type Meta {
    source: DataSource!
  }

  input ArtistFilter {
    "Country of birth, as written in the source (e.g. 'Polônia')."
    originCountry: String
    "Case- and accent-insensitive match on the name."
    search: String
  }

  "Where an open-source finding was read."
  enum ResearchSource {
    wikidata
    wikipedia
  }

  enum ResearchStatus {
    ok
    "The source has nothing that is certainly this artist."
    no_match
    error
  }

  "Referenced Wikidata statements are documented; unreferenced statements and encyclopedia text are undetermined."
  enum FindingReliability {
    documented
    undetermined
  }

  enum FindingReview {
    "Wikidata names places and states as they are today, not as they were in the period."
    present_day_name
    "The date disagrees with the MAC USP record."
    conflicts_with_collection
  }

  enum FindingProperty {
    birthDate
    birthPlace
    deathDate
    deathPlace
    citizenship
    occupation
    movement
    educatedAt
    memberOf
    notableWork
    summary
  }

  enum MatchBasis {
    "The only person found born in the collection's birth year."
    birth_year
    "The only person with exactly this name (the collection has no birth year)."
    name
    "A researcher confirmed this item in the reviewed list of links; no search was made."
    reviewed
  }

  type ResearchMatch {
    "Wikidata item id, e.g. Q1340566."
    id: ID!
    label: String!
    description: String
    url: String!
    basis: MatchBasis!
    "The researcher's note on a reviewed link; null otherwise."
    note: String
  }

  "Why a person Wikidata returned was not taken to be the artist."
  enum CandidateReason {
    "Wikidata gives another birth year than the collection."
    birth_year_differs
    "Wikidata has no birth year to compare."
    no_birth_year
    "More than one person fits the collection's birth year (or name)."
    ambiguous
    "Fits, but only turned up when searching a shorter form of the name."
    shorter_name
    "The collection has no birth year and the name is not exactly the same."
    name_differs
  }

  "A person Wikidata returned that was not linked to the artist: a lead for a researcher to check, never a finding."
  type ResearchCandidate {
    "Wikidata item id."
    id: ID!
    label: String!
    description: String
    url: String!
    birthYear: Int
    "The name that was searched when this person turned up."
    foundBy: String!
    reason: CandidateReason!
  }

  type Finding {
    source: ResearchSource!
    "The page the finding was read from."
    sourceUrl: String!
    sourceTitle: String!
    property: FindingProperty!
    "Wikidata property id (P569…); null for a Wikipedia summary."
    propertyId: String
    "As the source gives it: a label, a text, or a date as precise as the source (YYYY, YYYY-MM or YYYY-MM-DD)."
    value: String!
    "References Wikidata attaches to the statement."
    references: Int!
    reliability: FindingReliability!
    reviews: [FindingReview!]!
  }

  type SourceStatus {
    source: ResearchSource!
    status: ResearchStatus!
    detail: String
  }

  enum SummaryStatus {
    ok
    "No Gemini key is configured; the prompt is still returned."
    not_configured
    "No certain match or no findings, so nothing to summarise."
    no_findings
    "The answer cited no finding, or one that does not exist, so its text is withheld."
    rejected
    error
  }

  "The AI summary of the findings. Every claim cites a finding as [n], n counting from 1 in Research.findings."
  type ResearchSummary {
    status: SummaryStatus!
    text: String
    "Finding numbers the text cites, in order of first mention."
    citations: [Int!]!
    "Exactly what is (or would be) sent to the model: instructions, then data."
    prompt: String
    "Model version that answered."
    model: String
    detail: String
  }

  "The map of Europe on the artist's birth (CShapes 2.0), given to the model so it reasons with that period's states."
  type ResearchPeriod {
    "Day the map is read on: 1 July of the birth year."
    day: String!
    "Whether the birth year is approximate in the collection."
    approximate: Boolean!
    "State that held the birthplace that day, if any."
    birthState: String
    states: [String!]!
  }

  "Open-source research on an artist. Findings are never written to the collection."
  type Research {
    artist: Artist!
    "Names searched on Wikidata: the collection's, then first and last name when it has middle names."
    searchedNames: [String!]!
    "Null when no Wikidata person is certainly this artist; then there are no findings."
    match: ResearchMatch
    "Up to five people Wikidata returned when none is certainly the artist, each with why it was not linked."
    candidates: [ResearchCandidate!]!
    findings: [Finding!]!
    sources: [SourceStatus!]!
    "Null when the birth year is unknown, outside 1886–2019, or the borders could not be loaded."
    period: ResearchPeriod
    summary: ResearchSummary!
    "ISO time the sources were read (answers are cached for a day)."
    retrievedAt: String!
  }

  type Query {
    health: String!
    meta: Meta!
    stats: Stats!
    "Alphabetical by name."
    artists(filter: ArtistFilter): [Artist!]!
    artist(slug: String!): Artist
    places: [Place!]!
    "Oldest first."
    exhibitions(placeId: ID): [Exhibition!]!
    work(id: ID!): Work
    "Looks the artist up in open sources (Wikidata, Wikipedia). Null for an unknown slug."
    research(slug: String!): Research
  }
`;

const byName = (a: Artist, b: Artist) => a.name.localeCompare(b.name, "pt-BR");
/** Oldest first: an exact date, else the year; undated exhibitions go last. */
export const byStart = (a: Pick<Exhibition, "startDate">, b: Pick<Exhibition, "startDate">) =>
  (a.startDate.iso ?? String(a.startDate.year ?? 9999)).localeCompare(b.startDate.iso ?? String(b.startDate.year ?? 9999));

function pick<T>(map: Map<string, T>, ids: string[]): T[] {
  return ids.flatMap((id) => {
    const item = map.get(id);
    return item ? [item] : [];
  });
}

function unique<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

type Resolver<Parent, Result> = (parent: Parent, args: unknown, context: AppContext) => Promise<Result>;

function withData<Parent, Result>(fn: (parent: Parent, data: DatasetIndex) => Result): Resolver<Parent, Result> {
  return async (parent, _args, context) => fn(parent, await context.data());
}

const placeOf = (id: string | null, data: DatasetIndex): Place | null => (id ? (data.place.get(id) ?? null) : null);

export const resolvers = {
  Query: {
    health: () => "ok",
    meta: (_: unknown, __: unknown, context: AppContext) => ({ source: context.source }),
    stats: async (_: unknown, __: unknown, context: AppContext) => {
      const { dataset, place } = await context.data();
      const origins = new Set(
        dataset.artists.flatMap((artist) => {
          const birth = artist.birthPlaceId ? place.get(artist.birthPlaceId) : undefined;
          return birth ? [birth.country] : [];
        }),
      );
      return {
        artists: dataset.artists.length,
        works: dataset.works.length,
        exhibitions: dataset.exhibitions.length,
        publications: dataset.publications.length,
        places: dataset.places.length,
        originCountries: origins.size,
      };
    },
    artists: async (
      _: unknown,
      args: { filter?: { originCountry?: string | null; search?: string | null } | null },
      context: AppContext,
    ) => {
      const data = await context.data();
      const search = args.filter?.search ? slugify(args.filter.search) : null;
      const country = args.filter?.originCountry ?? null;
      return data.dataset.artists
        .filter((artist) => !search || artist.slug.includes(search))
        .filter((artist) => !country || placeOf(artist.birthPlaceId, data)?.country === country)
        .sort(byName);
    },
    artist: async (_: unknown, args: { slug: string }, context: AppContext) => {
      if (args.slug.trim() === "") {
        throw new GraphQLError("slug must not be empty", { extensions: { code: "BAD_USER_INPUT" } });
      }
      return (await context.data()).artistBySlug.get(args.slug) ?? null;
    },
    places: async (_: unknown, __: unknown, context: AppContext) => (await context.data()).dataset.places,
    exhibitions: async (_: unknown, args: { placeId?: string | null }, context: AppContext) => {
      const { dataset } = await context.data();
      return dataset.exhibitions.filter((e) => !args.placeId || e.placeId === args.placeId).sort(byStart);
    },
    work: async (_: unknown, args: { id: string }, context: AppContext) =>
      (await context.data()).work.get(args.id) ?? null,
    research: async (_: unknown, args: { slug: string }, context: AppContext) => {
      const data = await context.data();
      const artist = data.artistBySlug.get(args.slug);
      if (!artist) return null;
      const places = { birth: placeOf(artist.birthPlaceId, data), death: placeOf(artist.deathPlaceId, data) };
      return { artist, ...(await context.research(artist, places)) };
    },
  },
  Artist: {
    photo: async (artist: Artist, _: unknown, context: AppContext) => {
      const photo = (await context.data()).photoByArtist.get(artist.id);
      return photo
        ? { url: `${context.origin}/photos/${artist.slug}?v=${photo.hash}`, credit: photo.credit, sourceUrl: photo.sourceUrl }
        : null;
    },
    birthPlace: withData((artist: Artist, data) => placeOf(artist.birthPlaceId, data)),
    deathPlace: withData((artist: Artist, data) => placeOf(artist.deathPlaceId, data)),
    works: withData((artist: Artist, data) => data.worksByArtist.get(artist.id) ?? []),
    exhibitions: withData((artist: Artist, data) =>
      unique((data.worksByArtist.get(artist.id) ?? []).flatMap((work) => pick(data.exhibition, work.exhibitionIds))).sort(
        byStart,
      ),
    ),
    publications: withData((artist: Artist, data) =>
      unique((data.worksByArtist.get(artist.id) ?? []).flatMap((work) => pick(data.publication, work.publicationIds))),
    ),
  },
  Work: {
    artist: withData((work: Work, data) => {
      const artist = data.artist.get(work.artistId);
      if (!artist) throw new GraphQLError(`Work ${work.id} points at a missing artist`);
      return artist;
    }),
    exhibitions: withData((work: Work, data) => pick(data.exhibition, work.exhibitionIds).sort(byStart)),
    publications: withData((work: Work, data) => pick(data.publication, work.publicationIds)),
  },
  Exhibition: {
    place: withData((exhibition: Exhibition, data) => placeOf(exhibition.placeId, data)),
    works: withData((exhibition: Exhibition, data) => data.worksByExhibition.get(exhibition.id) ?? []),
  },
  Publication: {
    works: withData((publication: Publication, data) => data.worksByPublication.get(publication.id) ?? []),
  },
};

export const schema = createSchema<AppContext>({ typeDefs, resolvers });
