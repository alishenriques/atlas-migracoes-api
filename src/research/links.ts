import { z } from "zod";
import type { Artist } from "../schemas/domain.js";
import type { WikidataLink } from "./research.js";

const qid = z.string().regex(/^Q[1-9]\d*$/, "a Wikidata item id, like Q123");

/**
 * The reviewed list of links, kept on the machine that runs the generation
 * (like the place corrections), never in the repository: each artist's slug
 * with the Wikidata item a researcher confirmed, the items they rejected, and
 * a note on why.
 *
 *   { "artista-a": { "confirmed": "Q123", "note": "…" },
 *     "artista-b": { "rejected": ["Q456"], "note": "…" } }
 */
export const linksFileSchema = z.record(
  z.string(),
  z
    .object({
      confirmed: qid.optional(),
      rejected: z.array(qid).default([]),
      note: z.string().trim().min(1).optional(),
    })
    .strict()
    .refine((entry) => entry.confirmed !== undefined || entry.rejected.length > 0, "confirm one item or reject at least one")
    .refine((entry) => !entry.confirmed || !entry.rejected.includes(entry.confirmed), "an item cannot be confirmed and rejected"),
);

/** Reads the list for the artists in the base; a slug that is not one of them is an error, not ignored. */
export function parseLinks(input: unknown, artists: Artist[]): (artist: Artist) => WikidataLink | null {
  const file = linksFileSchema.parse(input);
  const slugs = new Set(artists.map((artist) => artist.slug));
  const unknown = Object.keys(file).filter((slug) => !slugs.has(slug));
  if (unknown.length > 0) throw new Error(`unknown artists in the links file: ${unknown.join(", ")}`);
  const links = new Map(
    Object.entries(file).map(([slug, entry]) => [
      slug,
      { confirmed: entry.confirmed ?? null, rejected: entry.rejected, note: entry.note ?? null },
    ]),
  );
  return (artist) => links.get(artist.slug) ?? null;
}
