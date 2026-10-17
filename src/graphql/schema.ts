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
  }
`;

const byName = (a: Artist, b: Artist) => a.name.localeCompare(b.name, "pt-BR");
const byStart = (a: Exhibition, b: Exhibition) =>
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
  },
  Artist: {
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
