import { readFile } from "node:fs/promises";
import { z } from "zod";
import { slugify, type ParsedPlace } from "./parse.js";

/**
 * A place fix reviewed by a person, for errors in the MAC USP exports that no
 * rule can tell apart from a real name ("Budapeshta" for Budapeste). The file
 * names collection places, so it stays next to the spreadsheets, never in this
 * repository. `match` is the path as the importer reads it; `path` and
 * `currentName` replace it.
 */
export const placeCorrectionSchema = z
  .object({
    match: z.array(z.string().min(1)).min(1),
    path: z.array(z.string().min(1)).min(1).optional(),
    currentName: z.string().min(1).optional(),
  })
  .refine((entry) => entry.path || entry.currentName, { message: "informe path, currentName ou os dois" });

export const placeCorrectionsSchema = z.array(placeCorrectionSchema);

export type PlaceCorrection = z.infer<typeof placeCorrectionSchema>;

export async function readPlaceCorrections(file: string): Promise<PlaceCorrection[]> {
  return placeCorrectionsSchema.parse(JSON.parse(await readFile(file, "utf8")));
}

const key = (path: string[]) => path.join(" ➔ ");

/** Applies the reviewed corrections and remembers which ones matched. */
export function createPlaceCorrector(corrections: PlaceCorrection[]) {
  const byMatch = new Map(corrections.map((entry) => [key(entry.match), entry]));
  const used = new Set<string>();

  return {
    apply(place: ParsedPlace): ParsedPlace {
      const correction = byMatch.get(key(place.path));
      if (!correction) return place;
      used.add(key(correction.match));
      const path = correction.path ?? place.path;
      return {
        id: slugify(path.join(" -- ")),
        label: path.at(-1) ?? path[0],
        path,
        country: path[0],
        currentName: correction.currentName ?? place.currentName,
      };
    },
    unused(): PlaceCorrection[] {
      return corrections.filter((entry) => !used.has(key(entry.match)));
    },
  };
}
