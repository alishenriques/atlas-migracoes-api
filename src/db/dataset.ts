import type { Artist, Dataset, Exhibition, Place, Publication, Work } from "../schemas/domain.js";
import type { Database } from "./client.js";
import { artists, exhibitions, places, publications, workExhibitions, workPublications, works } from "./schema.js";

/**
 * The whole collection is small (hundreds of rows), so it is loaded whole
 * (once every few minutes per instance, see context.ts) and resolved from memory. That keeps resolvers simple and avoids N+1
 * queries; revisit if the base grows past a few thousand records.
 */
export async function loadDataset(db: Database): Promise<Dataset> {
  const [placeRows, artistRows, workRows, exhibitionRows, publicationRows, exhibitionLinks, publicationLinks] =
    await Promise.all([
      db.select().from(places),
      db.select().from(artists),
      db.select().from(works),
      db.select().from(exhibitions),
      db.select().from(publications),
      db.select().from(workExhibitions),
      db.select().from(workPublications),
    ]);

  const exhibitionsByWork = group(exhibitionLinks, (link) => link.workId, (link) => link.exhibitionId);
  const publicationsByWork = group(publicationLinks, (link) => link.workId, (link) => link.publicationId);

  // A place whose name was corrected on re-import gets a new id and leaves its
  // old row behind with no artist or exhibition pointing at it. Rows are never
  // deleted automatically; serving only referenced places keeps them off the map.
  const usedPlaceIds = new Set(
    [
      ...artistRows.flatMap((artist) => [artist.birthPlaceId, artist.deathPlaceId]),
      ...exhibitionRows.map((exhibition) => exhibition.placeId),
    ].filter((id): id is string => id !== null),
  );

  return {
    places: placeRows.filter((place) => usedPlaceIds.has(place.id)),
    artists: artistRows,
    works: workRows.map((work) => ({
      ...work,
      exhibitionIds: exhibitionsByWork.get(work.id) ?? [],
      publicationIds: publicationsByWork.get(work.id) ?? [],
    })),
    exhibitions: exhibitionRows,
    publications: publicationRows,
  };
}

function group<T, V>(items: T[], key: (item: T) => string, value: (item: T) => V): Map<string, V[]> {
  const map = new Map<string, V[]>();
  for (const item of items) {
    const list = map.get(key(item));
    if (list) list.push(value(item));
    else map.set(key(item), [value(item)]);
  }
  return map;
}

/** Lookups the resolvers need, built once per dataset. */
export type DatasetIndex = {
  dataset: Dataset;
  place: Map<string, Place>;
  artist: Map<string, Artist>;
  artistBySlug: Map<string, Artist>;
  work: Map<string, Work>;
  exhibition: Map<string, Exhibition>;
  publication: Map<string, Publication>;
  worksByArtist: Map<string, Work[]>;
  worksByExhibition: Map<string, Work[]>;
  worksByPublication: Map<string, Work[]>;
};

export function indexDataset(dataset: Dataset): DatasetIndex {
  const byId = <T extends { id: string }>(items: T[]) => new Map(items.map((item) => [item.id, item]));
  const linked = (pick: (work: Work) => string[]) => {
    const map = new Map<string, Work[]>();
    for (const work of dataset.works) {
      for (const id of pick(work)) {
        const list = map.get(id);
        if (list) list.push(work);
        else map.set(id, [work]);
      }
    }
    return map;
  };

  return {
    dataset,
    place: byId(dataset.places),
    artist: byId(dataset.artists),
    artistBySlug: new Map(dataset.artists.map((artist) => [artist.slug, artist])),
    work: byId(dataset.works),
    exhibition: byId(dataset.exhibitions),
    publication: byId(dataset.publications),
    worksByArtist: group(dataset.works, (work) => work.artistId, (work) => work),
    worksByExhibition: linked((work) => work.exhibitionIds),
    worksByPublication: linked((work) => work.publicationIds),
  };
}
