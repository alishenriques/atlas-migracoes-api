import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { artists } from "../db/schema.js";
import type { FuzzyDate } from "../schemas/domain.js";
import { createTestApp, createTestDatabase, testEnv } from "../test/helpers.js";
import { importPhotos, readPhotoDir, sniffMime, type PhotoFile } from "./import.js";
import { photoSlug, servePhoto } from "./serve.js";

const unknownDate: FuzzyDate = { raw: null, year: null, endYear: null, iso: null, precision: "unknown" };
// Smallest headers each format is recognised by; the bytes after them do not matter here.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);

const photo = (slug: string, bytes = WEBP): PhotoFile => ({
  slug,
  mime: "image/webp",
  bytes,
  credit: null,
  sourceUrl: null,
});

async function seeded() {
  const db = await createTestDatabase();
  await db.insert(artists).values({
    id: "id-anatol",
    slug: "anatol-wladyslaw",
    name: "Anatol Wladyslaw",
    birthPlaceId: null,
    birthDate: unknownDate,
    deathPlaceId: null,
    deathDate: unknownDate,
  });
  return db;
}

describe("sniffMime", () => {
  it("recognises JPEG, PNG and WebP by their first bytes", () => {
    expect(sniffMime(JPEG)).toBe("image/jpeg");
    expect(sniffMime(PNG)).toBe("image/png");
    expect(sniffMime(WEBP)).toBe("image/webp");
    expect(sniffMime(Buffer.from("GIF89a"))).toBeNull();
  });
});

describe("readPhotoDir", () => {
  it("reads photos named by slug with their credits, and skips the rest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "photos-"));
    await writeFile(join(dir, "anatol-wladyslaw.webp"), WEBP);
    await writeFile(join(dir, "lasar-segall.JPG"), JPEG);
    await writeFile(join(dir, "fingido.png"), JPEG);
    await writeFile(join(dir, "notas.txt"), "texto");
    await writeFile(
      join(dir, "photos.json"),
      JSON.stringify({ "anatol-wladyslaw": { credit: "Acervo da família", sourceUrl: "https://example.org/foto" } }),
    );

    const { files, skipped } = await readPhotoDir(dir);
    expect(files).toEqual([
      { slug: "anatol-wladyslaw", mime: "image/webp", bytes: WEBP, credit: "Acervo da família", sourceUrl: "https://example.org/foto" },
      { slug: "lasar-segall", mime: "image/jpeg", bytes: JPEG, credit: null, sourceUrl: null },
    ]);
    expect(skipped).toEqual(["fingido.png", "notas.txt"]);
  });

  it("works without a photos.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "photos-"));
    await writeFile(join(dir, "anatol-wladyslaw.png"), PNG);
    expect((await readPhotoDir(dir)).files).toEqual([
      { slug: "anatol-wladyslaw", mime: "image/png", bytes: PNG, credit: null, sourceUrl: null },
    ]);
  });
});

describe("photos in the base", () => {
  it("stores a photo on its artist, replaces it, and reports unknown slugs", async () => {
    const db = await seeded();
    expect(await importPhotos(db, [photo("anatol-wladyslaw"), photo("ninguem")])).toEqual({
      imported: ["anatol-wladyslaw"],
      unknown: ["ninguem"],
    });
    const first = await servePhoto(db, "anatol-wladyslaw");
    await importPhotos(db, [{ ...photo("anatol-wladyslaw", JPEG), mime: "image/jpeg" }]);
    const second = await servePhoto(db, "anatol-wladyslaw");
    expect(second.headers.get("content-type")).toBe("image/jpeg");
    expect(second.headers.get("etag")).not.toBe(first.headers.get("etag"));
  });

  it("serves the image with a long cache, and nothing for an artist without one", async () => {
    const db = await seeded();
    await importPhotos(db, [photo("anatol-wladyslaw")]);

    const response = await servePhoto(db, "anatol-wladyslaw");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(WEBP);

    const head = await servePhoto(db, "anatol-wladyslaw", "HEAD");
    expect(head.headers.get("content-length")).toBe(String(WEBP.length));
    expect(await head.text()).toBe("");

    expect((await servePhoto(db, "ninguem")).status).toBe(404);
    expect((await servePhoto(null, "anatol-wladyslaw")).status).toBe(404);
    expect((await servePhoto(db, "anatol-wladyslaw", "POST")).status).toBe(405);
  });

  it("answers /photos/<slug> and gives the artist's photo URL in GraphQL", async () => {
    const db = await seeded();
    await importPhotos(db, [{ ...photo("anatol-wladyslaw"), credit: "Acervo da família" }]);
    const { gql } = createTestApp(db);

    const result = await gql<{ artist: { photo: { url: string; credit: string; sourceUrl: null } } }>(
      `{ artist(slug: "anatol-wladyslaw") { photo { url credit sourceUrl } } }`,
    );
    const url = result.data?.artist.photo.url ?? "";
    expect(url).toMatch(/^http:\/\/localhost\/photos\/anatol-wladyslaw\?v=[0-9a-f]{16}$/);
    expect(result.data?.artist.photo).toMatchObject({ credit: "Acervo da família", sourceUrl: null });

    const app = createApp(testEnv, { db });
    const image = await app.fetch(url);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/webp");
  });

  it("gives null for an artist without a photo, and the demo has none", async () => {
    const db = await seeded();
    const { gql } = createTestApp(db);
    expect((await gql(`{ artist(slug: "anatol-wladyslaw") { photo { url } } }`)).data).toEqual({
      artist: { photo: null },
    });
    const demo = createTestApp(null);
    expect((await demo.gql(`{ artist(slug: "artista-demo-a") { photo { url } } }`)).data).toEqual({
      artist: { photo: null },
    });
  });
});

describe("photoSlug", () => {
  it("takes the slug from a photo path only", () => {
    expect(photoSlug("/photos/anatol-wladyslaw")).toBe("anatol-wladyslaw");
    expect(photoSlug("/photos/../graphql")).toBeNull();
    expect(photoSlug("/graphql")).toBeNull();
  });
});
