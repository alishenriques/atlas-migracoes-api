import { inArray, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Database } from "../db/client.js";
import {
  artists,
  exhibitions,
  importBatches,
  places,
  publications,
  type ImportReport,
  workExhibitions,
  workPublications,
  works,
} from "../db/schema.js";
import type { Work } from "../schemas/domain.js";
import type { NormalizeResult } from "./normalize.js";

const CHUNK = 200;

function withoutLinks(work: Work): Omit<Work, "exhibitionIds" | "publicationIds"> {
  const { exhibitionIds, publicationIds, ...row } = work;
  void exhibitionIds;
  void publicationIds;
  return row;
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

/** `set` clause that overwrites every listed column with the incoming row. */
function excludedSet(table: PgTable, columns: string[]) {
  const config = table as unknown as Record<string, { name: string }>;
  return Object.fromEntries(columns.map((key) => [key, sql.raw(`excluded."${config[key].name}"`)]));
}

/**
 * Upserts a normalized import. Re-running the same spreadsheets is safe: rows
 * are updated in place, and place coordinates (filled in by geocoding or by
 * hand) are never overwritten by an import.
 */
export async function persistImport(db: Database, result: NormalizeResult, files: string[]): Promise<ImportReport> {
  const { dataset } = result;

  for (const batch of chunks(dataset.places)) {
    await db
      .insert(places)
      .values(batch)
      .onConflictDoUpdate({ target: places.id, set: excludedSet(places, ["label", "path", "country", "currentName"]) });
  }
  for (const batch of chunks(dataset.artists)) {
    await db
      .insert(artists)
      .values(batch)
      .onConflictDoUpdate({
        target: artists.id,
        set: excludedSet(artists, ["slug", "name", "birthPlaceId", "birthDate", "deathPlaceId", "deathDate"]),
      });
  }
  for (const batch of chunks(dataset.exhibitions)) {
    await db
      .insert(exhibitions)
      .values(batch)
      .onConflictDoUpdate({
        target: exhibitions.id,
        set: excludedSet(exhibitions, ["title", "startDate", "endDate", "institution", "venue", "placeId"]),
      });
  }
  for (const batch of chunks(dataset.publications)) {
    await db
      .insert(publications)
      .values(batch)
      .onConflictDoUpdate({
        target: publications.id,
        set: excludedSet(publications, [
          "authors",
          "title",
          "city",
          "publisher",
          "date",
          "category",
          "periodical",
          "volume",
          "isbn",
          "relatedExhibitionTitle",
        ]),
      });
  }
  for (const batch of chunks(dataset.works)) {
    await db
      .insert(works)
      .values(batch.map(withoutLinks))
      .onConflictDoUpdate({
        target: works.id,
        set: excludedSet(works, [
          "artistId",
          "title",
          "date",
          "technique",
          "dimensions",
          "acquisition",
          "acquisitionDate",
          "history",
        ]),
      });
  }

  // Links of the imported works are replaced as a whole, so a reference removed
  // from the spreadsheet also disappears from the platform.
  for (const batch of chunks(dataset.works.map((work) => work.id))) {
    await db.delete(workExhibitions).where(inArray(workExhibitions.workId, batch));
    await db.delete(workPublications).where(inArray(workPublications.workId, batch));
  }
  const exhibitionLinks = dataset.works.flatMap((work) =>
    work.exhibitionIds.map((exhibitionId) => ({ workId: work.id, exhibitionId })),
  );
  const publicationLinks = dataset.works.flatMap((work) =>
    work.publicationIds.map((publicationId) => ({ workId: work.id, publicationId })),
  );
  for (const batch of chunks(exhibitionLinks)) await db.insert(workExhibitions).values(batch);
  for (const batch of chunks(publicationLinks)) await db.insert(workPublications).values(batch);

  const report = buildReport(result);
  await db.insert(importBatches).values({ files, report });
  return report;
}

export function buildReport(result: NormalizeResult): ImportReport {
  const { dataset } = result;
  return {
    counts: {
      places: dataset.places.length,
      artists: dataset.artists.length,
      works: dataset.works.length,
      exhibitions: dataset.exhibitions.length,
      publications: dataset.publications.length,
    },
    unresolvedExhibitionRefs: result.unresolvedExhibitionRefs,
    unresolvedPublicationRefs: result.unresolvedPublicationRefs,
    warnings: result.warnings,
  };
}
