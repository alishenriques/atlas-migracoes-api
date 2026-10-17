import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { places } from "../db/schema.js";
import type { ReviewEntry } from "./review.js";

export type ApplyResult = { updated: number; skipped: string[]; missing: string[] };

/** Writes reviewed coordinates into `places`. Entries without coordinates are skipped and listed. */
export async function applyCoordinates(db: Database, entries: ReviewEntry[]): Promise<ApplyResult> {
  const result: ApplyResult = { updated: 0, skipped: [], missing: [] };
  for (const entry of entries) {
    if (entry.lat === null || entry.lng === null) {
      result.skipped.push(entry.id);
      continue;
    }
    const rows = await db
      .update(places)
      .set({ lat: entry.lat, lng: entry.lng })
      .where(eq(places.id, entry.id))
      .returning({ id: places.id });
    if (rows.length === 0) result.missing.push(entry.id);
    else result.updated += 1;
  }
  return result;
}
