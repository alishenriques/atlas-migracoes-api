import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { artistPhotos, artists } from "../db/schema.js";

const PHOTO_PATH = /^\/photos\/([a-z0-9-]+)$/;

/** The artist slug in a `/photos/<slug>` path, or null for any other path. */
export function photoSlug(pathname: string): string | null {
  return PHOTO_PATH.exec(pathname)?.[1] ?? null;
}

/**
 * Answers `GET /photos/<slug>` with the artist's photo from the base. The URLs
 * the API hands out carry the photo's hash (`?v=`), so a response can be
 * cached for a year: a new photo comes with a new URL.
 */
export async function servePhoto(db: Database | null, slug: string, method = "GET"): Promise<Response> {
  if (method !== "GET" && method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const [row] = db
    ? await db
        .select({ mime: artistPhotos.mime, data: artistPhotos.data, hash: artistPhotos.hash })
        .from(artistPhotos)
        .innerJoin(artists, eq(artists.id, artistPhotos.artistId))
        .where(eq(artists.slug, slug))
    : [];
  if (!row) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const body = Buffer.from(row.data, "base64");
  return new Response(method === "HEAD" ? null : body, {
    headers: {
      "Content-Type": row.mime,
      "Content-Length": String(body.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${row.hash}"`,
    },
  });
}
