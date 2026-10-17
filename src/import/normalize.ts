import type { Artist, Dataset, Exhibition, Place, Publication, Work } from "../schemas/domain.js";
import { cleanText, parseFuzzyDate, parsePlace, slugify, splitIds, splitTitleAndDate } from "./parse.js";
import type { Sheet } from "./workbook.js";

export type NormalizeResult = {
  dataset: Dataset;
  unresolvedExhibitionRefs: { workId: string; exhibitionId: string }[];
  unresolvedPublicationRefs: { workId: string; publicationId: string }[];
  warnings: string[];
};

/**
 * Turns the three MAC USP exports into one consistent dataset. Nothing is
 * invented: missing values stay null, approximate dates keep their precision,
 * and references that point at records not in the exports are reported
 * rather than dropped silently.
 */
export function normalizeSheets(sheets: Sheet[]): NormalizeResult {
  const places = new Map<string, Place>();
  const artists = new Map<string, Artist>();
  const works = new Map<string, Work>();
  const exhibitions = new Map<string, Exhibition>();
  const publications = new Map<string, Publication>();
  const warnings: string[] = [];

  function placeId(value: unknown): string | null {
    const parsed = parsePlace(value, (raw) =>
      warnings.push(`Lugar com endereço colado no nome, corrigido: "${raw}".`),
    );
    if (!parsed) return null;
    if (!places.has(parsed.id)) places.set(parsed.id, { ...parsed, lat: null, lng: null });
    return parsed.id;
  }

  for (const sheet of sheets.filter((s) => s.kind === "exhibitions")) {
    sheet.rows.forEach((row, index) => {
      const id = cleanText(row["identificador"]);
      const title = cleanText(row["titulo-da-exposicao"]);
      if (!id || !title) {
        warnings.push(`${sheet.source}, linha ${index + 2}: exposição sem identificador ou título, ignorada.`);
        return;
      }
      exhibitions.set(id, {
        id,
        title,
        startDate: parseFuzzyDate(row["data-de-inicio"]),
        endDate: parseFuzzyDate(row["data-de-encerramento"]),
        institution: cleanText(row["instituicao-responsavel"]),
        venue: cleanText(row["local-da-exposicao"]),
        placeId: placeId(row["pais-estado-municipio"]),
      });
    });
  }

  for (const sheet of sheets.filter((s) => s.kind === "publications")) {
    sheet.rows.forEach((row, index) => {
      const id = cleanText(row["identificador"]);
      const title = cleanText(row["titulo-da-publicacao"]);
      if (!id || !title) {
        warnings.push(`${sheet.source}, linha ${index + 2}: publicação sem identificador ou título, ignorada.`);
        return;
      }
      publications.set(id, {
        id,
        authors: cleanText(row["autoria"]),
        title,
        city: cleanText(row["cidade-da-publicacao"]),
        publisher: cleanText(row["editora"]),
        date: parseFuzzyDate(row["data-da-edicao"]),
        category: cleanText(row["categoria-da-publicacao"]),
        periodical: cleanText(row["periodico"]),
        volume: cleanText(row["volume"]),
        isbn: cleanText(row["isbn"]),
        relatedExhibitionTitle: cleanText(row["exposicao-relacionada"]),
      });
    });
  }

  const unresolvedExhibitionRefs: NormalizeResult["unresolvedExhibitionRefs"] = [];
  const unresolvedPublicationRefs: NormalizeResult["unresolvedPublicationRefs"] = [];

  for (const sheet of sheets.filter((s) => s.kind === "works")) {
    sheet.rows.forEach((row, index) => {
      const id = cleanText(row["tombo"]);
      const name = cleanText(row["artista"]);
      if (!id || !name) {
        warnings.push(`${sheet.source}, linha ${index + 2}: obra sem tombo ou artista, ignorada.`);
        return;
      }

      const slug = slugify(name);
      // The works export repeats the artist on every row; the first row wins.
      if (!artists.has(slug)) {
        artists.set(slug, {
          id: slug,
          slug,
          name,
          birthPlaceId: placeId(row["local-de-nascimento"]),
          birthDate: parseFuzzyDate(row["data-nascimento"]),
          deathPlaceId: placeId(row["local-de-morte"]),
          deathDate: parseFuzzyDate(row["data-morte"]),
        });
      }

      const { title, date } = splitTitleAndDate(row["titulo-data"]);
      const exhibitionIds = splitIds(row["exposicoes-relacionadas"]);
      const publicationIds = splitIds(row["publicacoes-relacionadas"]);
      if (works.has(id)) warnings.push(`${sheet.source}, linha ${index + 2}: tombo ${id} repetido, a última linha vale.`);
      works.set(id, {
        id,
        artistId: slug,
        title: title || "Sem título",
        date,
        technique: cleanText(row["tecnica"]),
        dimensions: cleanText(row["dimensoes"]),
        acquisition: cleanText(row["incorporacao"]),
        acquisitionDate: parseFuzzyDate(row["data-da-incorporacao"]),
        history: cleanText(row["historico"]),
        exhibitionIds: exhibitionIds.filter((ref) => {
          if (exhibitions.has(ref)) return true;
          unresolvedExhibitionRefs.push({ workId: id, exhibitionId: ref });
          return false;
        }),
        publicationIds: publicationIds.filter((ref) => {
          if (publications.has(ref)) return true;
          unresolvedPublicationRefs.push({ workId: id, publicationId: ref });
          return false;
        }),
      });
    });
  }

  return {
    dataset: {
      places: [...places.values()],
      artists: [...artists.values()],
      works: [...works.values()],
      exhibitions: [...exhibitions.values()],
      publications: [...publications.values()],
    },
    unresolvedExhibitionRefs,
    unresolvedPublicationRefs,
    warnings,
  };
}
