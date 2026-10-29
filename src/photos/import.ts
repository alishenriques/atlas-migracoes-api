import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { artistPhotos, artists } from "../db/schema.js";

export type PhotoFile = { slug: string; mime: string; bytes: Buffer; credit: string | null; sourceUrl: string | null };

/** Optional `photos.json` beside the images: who holds each photo or where it was published. */
const creditsSchema = z.record(
  z.string(),
  z.object({ credit: z.string().min(1).nullable().default(null), sourceUrl: z.url().nullable().default(null) }),
);

const MIME_BY_EXTENSION: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

/** Checks the file's first bytes, so a renamed file is not served under the wrong type. */
export function sniffMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * Reads a folder of photos named by artist slug (`anatol-wladyslaw.webp`) and
 * the optional `photos.json` with their credits. Files that are not images, or
 * whose content does not match their extension, are reported and skipped.
 */
export async function readPhotoDir(dir: string): Promise<{ files: PhotoFile[]; skipped: string[] }> {
  const names = await readdir(dir);
  const credits = names.includes("photos.json")
    ? creditsSchema.parse(JSON.parse(await readFile(join(dir, "photos.json"), "utf8")))
    : {};
  const files: PhotoFile[] = [];
  const skipped: string[] = [];

  for (const name of names.sort()) {
    if (name === "photos.json") continue;
    const extension = extname(name).toLowerCase();
    const mime = MIME_BY_EXTENSION[extension];
    const bytes = mime ? await readFile(join(dir, name)) : null;
    if (!mime || !bytes || sniffMime(bytes) !== mime) {
      skipped.push(name);
      continue;
    }
    const slug = name.slice(0, -extension.length);
    files.push({ slug, mime, bytes, credit: credits[slug]?.credit ?? null, sourceUrl: credits[slug]?.sourceUrl ?? null });
  }
  return { files, skipped };
}

/** Stores each photo on its artist, replacing the one before. Slugs with no artist are reported, never stored. */
export async function importPhotos(db: Database, files: PhotoFile[]): Promise<{ imported: string[]; unknown: string[] }> {
  const ids = new Map((await db.select({ id: artists.id, slug: artists.slug }).from(artists)).map((a) => [a.slug, a.id]));
  const imported: string[] = [];
  const unknown: string[] = [];

  for (const file of files) {
    const artistId = ids.get(file.slug);
    if (!artistId) {
      unknown.push(file.slug);
      continue;
    }
    const row = {
      artistId,
      mime: file.mime,
      data: file.bytes.toString("base64"),
      hash: createHash("sha256").update(file.bytes).digest("hex").slice(0, 16),
      credit: file.credit,
      sourceUrl: file.sourceUrl,
      updatedAt: new Date(),
    };
    await db.insert(artistPhotos).values(row).onConflictDoUpdate({ target: artistPhotos.artistId, set: row });
    imported.push(file.slug);
  }
  return { imported, unknown };
}
