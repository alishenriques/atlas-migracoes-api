import type { FuzzyDate } from "../schemas/domain.js";

const CONTINENTS = new Set(["América", "Europa", "Ásia", "África", "Oceania"]);
const UNKNOWN_DATE = /^(s\.?\s?d\.?|sem data|desconhecid[ao]|n\.?\s?d\.?)$/i;

/**
 * Turns a raw cell value into trimmed text, or null when empty. Multi-line
 * cells (the CollectiveAccess export pads them with tabs and newlines) become
 * one line, with the original lines joined by " · ".
 */
export function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" · ");
  return text === "" ? null : text;
}

export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function unknownDate(raw: string | null): FuzzyDate {
  return { raw, year: null, endYear: null, iso: null, precision: "unknown" };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Reads the date formats found in the MAC USP export without ever inventing precision. */
export function parseFuzzyDate(value: unknown): FuzzyDate {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
    return { raw: iso, year: value.getUTCFullYear(), endYear: value.getUTCFullYear(), iso, precision: "day" };
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return { raw: String(value), year: value, endYear: value, iso: null, precision: "year" };
  }

  const raw = cleanText(value);
  if (raw === null || UNKNOWN_DATE.test(raw)) return unknownDate(raw);

  // Publications append notes after a semicolon ("2005; 2ª edição revista").
  // The date is read from the first part; raw keeps the whole cell.
  const semicolon = raw.indexOf(";");
  if (semicolon > 0) return { ...parseFuzzyDate(raw.slice(0, semicolon)), raw };

  const day = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (day) {
    const [d, m, y] = [Number(day[1]), Number(day[2]), Number(day[3])];
    if (m < 1 || m > 12 || d < 1 || d > 31) return unknownDate(raw);
    return { raw, year: y, endYear: y, iso: `${y}-${pad(m)}-${pad(d)}`, precision: "day" };
  }

  const month = raw.match(/^(\d{1,2})\/(\d{4})$/);
  if (month) {
    const [m, y] = [Number(month[1]), Number(month[2])];
    if (m < 1 || m > 12) return unknownDate(raw);
    return { raw, year: y, endYear: y, iso: `${y}-${pad(m)}`, precision: "month" };
  }

  const year = raw.match(/^(\d{4})$/);
  if (year) {
    const y = Number(year[1]);
    return { raw, year: y, endYear: y, iso: null, precision: "year" };
  }

  const circa = raw.match(/^(?:c\.|ca\.|circa)\s*(\d{4})$/i);
  if (circa) {
    const y = Number(circa[1]);
    return { raw, year: y, endYear: y, iso: null, precision: "circa" };
  }

  const range = raw.match(/^(\d{4})\s*[-–/]\s*(\d{2,4})$/);
  if (range) {
    const start = Number(range[1]);
    // "1940-45" means 1940 to 1945.
    const end = range[2].length === 2 ? Number(range[1].slice(0, 2) + range[2]) : Number(range[2]);
    if (end < start) return unknownDate(raw);
    return { raw, year: start, endYear: end, iso: null, precision: "range" };
  }

  const decade = raw.match(/^d[ée]cada de (\d{3})0$/i);
  if (decade) {
    const start = Number(`${decade[1]}0`);
    return { raw, year: start, endYear: start + 9, iso: null, precision: "range" };
  }

  return unknownDate(raw);
}

/**
 * The export puts title and date in one cell ("Sem título, c. 1949"). The date
 * is whatever follows the last comma, but only if it reads as a date (or as
 * "s.d."); otherwise the comma belongs to the title.
 */
export function splitTitleAndDate(value: unknown): { title: string; date: FuzzyDate } {
  const text = cleanText(value) ?? "";
  const cut = text.lastIndexOf(",");
  if (cut > 0) {
    const tail = text.slice(cut + 1).trim();
    const date = parseFuzzyDate(tail);
    if (date.precision !== "unknown" || UNKNOWN_DATE.test(tail)) {
      return { title: text.slice(0, cut).trim(), date };
    }
  }
  return { title: text, date: unknownDate(null) };
}

export type ParsedPlace = {
  id: string;
  label: string;
  path: string[];
  country: string;
  currentName: string | null;
};

/**
 * Reads "Rússia➔Sebastopol [atual Sebastopol, Ucrânia]" or
 * "América➔Brasil➔São Paulo➔São Paulo". The continent prefix is dropped;
 * historical names are kept as written, with the present-day name aside.
 */
export function parsePlace(value: unknown, onRepair?: (raw: string) => void): ParsedPlace | null {
  const text = cleanText(value);
  if (text === null) return null;

  const note = text.match(/\[\s*atual\s+([^\]]+)\]/i);
  const currentName = note ? note[1].trim() : null;
  const withoutNote = text.replace(/\[[^\]]*\]/g, "").trim();

  const segments = withoutNote
    .split("➔")
    .map((segment) => segment.trim())
    .filter(Boolean);
  while (segments.length > 1 && CONTINENTS.has(segments[0])) segments.shift();
  if (segments.length === 0) return null;

  // Place names never contain digits. When they do, the export glued the
  // venue's street address onto the place ("Rua Piauí8441º andarBrasil",
  // "Santa Maria3960"): keep the name and drop the address.
  const repaired = segments.map((segment, index) => {
    if (!/\d/.test(segment)) return segment;
    const name = index === 0 ? (segment.match(/(?:\d|\p{Ll}|º)(\p{Lu}[^\d]*)$/u)?.[1] ?? segment) : segment;
    return name.replace(/\d+$/, "").trim();
  });
  if (repaired.some((segment, index) => segment !== segments[index])) {
    onRepair?.(text);
    segments.splice(0, segments.length, ...repaired.filter(Boolean));
  }

  return {
    id: slugify(segments.join(" -- ")),
    label: segments.at(-1) ?? segments[0],
    path: segments,
    country: segments[0],
    currentName,
  };
}

/** "EM.2013.12.03;EX.2000.12.01" → ["EM.2013.12.03", "EX.2000.12.01"]. */
export function splitIds(value: unknown): string[] {
  const text = cleanText(value);
  if (text === null) return [];
  return [...new Set(text.split(/[;,]/).map((id) => id.trim()).filter(Boolean))];
}
