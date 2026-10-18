import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import ExcelJS from "exceljs";
import { createApp } from "../app.js";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { loadEnv } from "../schemas/domain.js";
import type { Fetcher } from "../research/wikimedia.js";

export const testEnv = loadEnv({ NODE_ENV: "test" });

let sharedDb: Promise<Database> | undefined;

/** One migrated in-memory Postgres per test file; tables are emptied on every call. */
export async function createTestDatabase(): Promise<Database> {
  sharedDb ??= (async () => {
    const db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    return db;
  })();

  const db = await sharedDb;
  await db.execute(
    sql`truncate table work_exhibitions, work_publications, works, exhibitions, publications, artists, places, import_batches`,
  );
  return db;
}

/** Stands in for the network: tests never reach the open sources. */
const offline: Fetcher = async (url) => {
  throw new Error(`offline in tests: ${url}`);
};

export function createTestApp(db: Database | null, fetcher: Fetcher = offline) {
  const app = createApp(testEnv, { db, fetcher });

  async function gql<T = Record<string, unknown>>(query: string, variables?: Record<string, unknown>) {
    const response = await app.fetch("http://localhost/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    return (await response.json()) as { data: T | null; errors?: { message: string; extensions?: { code?: string } }[] };
  }

  return { gql };
}

/**
 * A small workbook shaped like the three MAC USP exports (same headers, same
 * quirks), with made-up records. The real spreadsheets are never committed.
 */
export async function buildFixtureWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  const works = workbook.addWorksheet("CollectiveAccess");
  works.addRow([
    "Artista", "Local de nascimento", "Data nascimento", "Local de morte", "Data morte", "Tombo", "Titulo, Data",
    "Técnica", "Dimensões", "Incorporação", "Data da incorporação", "Histórico", "Exposições relacionadas",
    "Publicações relacionadas",
  ]);
  works.addRow([
    "Ana Teste", "Europa➔Rússia➔Sebastopol [atual Sebastopol, Ucrânia]", 1901, "América➔Brasil➔São Paulo➔São Paulo",
    1986, "T.1", "Sem título, 1940-1945  ", "monotipia sobre papel", "\n\t72,2 cm x 53,5 cm \n\n\n\tMancha - 59 cm\n\n",
    "\n\tDoação\n\n", "08/04/1963", "Histórico de teste\n", "EX.1;EX.404", "PB.1",
  ]);
  works.addRow([
    "Ana Teste", "Europa➔Rússia➔Sebastopol [atual Sebastopol, Ucrânia]", 1901, "América➔Brasil➔São Paulo➔São Paulo",
    1986, "T.2", "Paisagem, com rio", "óleo sobre tela", null, null, "s.d.", null, "EX.1", null,
  ]);
  works.addRow([
    "Bruno Exemplo", "Áustria➔Viena", "c. 1912", null, "desconhecida", "T.3", "Retrato, c. 1950", null, null, null,
    null, null, null, "PB.999",
  ]);

  const exhibitions = workbook.addWorksheet("Exposições");
  exhibitions.addRow([
    "Identificador", "Título da exposição", "Data de início", "Data de encerramento", "Instituição responsável",
    "Local da exposição", "País ➔ Estado ➔ Município ",
  ]);
  exhibitions.addRow(["EX.1", "Mostra de teste", "22/06/1946", "desconhecida", "Instituto ", null, "Brasil➔São Paulo➔São Paulo"]);

  const publications = workbook.addWorksheet("Publicações selecionadas");
  publications.addRow([
    "Identificador", "Autoria", "Título da publicação", "Cidade da publicação", "Editora", "Data da edição",
    "Categoria da publicação", "Periódico", "Volume", "ISBN", "Exposição relacionada",
  ]);
  publications.addRow(["PB.1", "Fulano (Autor)", "Catálogo de teste", "São Paulo", null, 1994, "Catálogo", null, null, 8585298022, "Mostra de teste"]);

  workbook.addWorksheet("Notas").addRow(["uma aba qualquer"]);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
