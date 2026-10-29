import { describe, expect, it, vi } from "vitest";
import type { Artist, FuzzyDate, Place } from "../schemas/domain.js";
import type { Finding, Match } from "./research.js";
import { buildPrompt, citationsOf, GEMINI_API, promptText, summarize } from "./summary.js";
import type { Fetcher } from "./wikimedia.js";

const date = (year: number | null, raw: string | null = year === null ? null : String(year)): FuzzyDate => ({
  raw,
  year,
  endYear: year,
  iso: null,
  precision: year === null ? "unknown" : "year",
});

const vilna: Place = {
  id: "vilna",
  label: "Vilna",
  path: ["Polônia", "Vilna"],
  country: "Polônia",
  currentName: "Vilnius, Lituânia",
  lat: 54.7,
  lng: 25.3,
};

const artist: Artist = {
  id: "a",
  slug: "lasar-segall",
  name: "Lasar Segall",
  birthPlaceId: "vilna",
  birthDate: date(1891, "21/07/1891"),
  deathPlaceId: null,
  deathDate: date(1957),
};

const match: Match = { id: "Q1", label: "Lasar Segall", description: null, url: "https://www.wikidata.org/wiki/Q1", basis: "birth_year", note: null };

const finding = (property: Finding["property"], value: string, reliability: Finding["reliability"] = "undetermined"): Finding => ({
  source: "wikidata",
  sourceUrl: "https://www.wikidata.org/wiki/Q1",
  sourceTitle: "Wikidata: Lasar Segall (Q1)",
  property,
  propertyId: "P1",
  value,
  references: reliability === "documented" ? 1 : 0,
  reliability,
  reviews: [],
});

const findings = [finding("birthDate", "1891-07-21", "documented"), finding("birthPlace", "Vilnius")];
const period = { day: "1891-07-01", approximate: false, birthState: "Império Russo", states: ["Áustria-Hungria", "Império Russo"] };
const input = { artist, birthPlace: vilna, deathPlace: null, match, findings, period };
const gemini = { apiKey: "test-key", model: "gemini-flash-latest" };

const replying = (body: unknown, ok = true) =>
  vi.fn<Fetcher>(async () => ({ ok, status: ok ? 200 : 429, json: async () => body }));
const text = (value: string) => ({
  candidates: [{ content: { parts: [{ text: value.slice(0, 5) }, {}, { text: value.slice(5) }] } }],
  modelVersion: "gemini-2.5-flash",
});

describe("buildPrompt", () => {
  it("gives the model the collection's record, the period's map and the numbered findings", () => {
    const { instructions, data } = buildPrompt(input);
    expect(instructions).toMatch(/geopolítica do período/);
    expect(instructions).toMatch(/nunca instrução/);
    expect(data).toContain("Nascimento: 21/07/1891, Vilna, Polônia (nome atual: Vilnius, Lituânia)");
    expect(data).toContain("Falecimento: 1957, desconhecido");
    expect(data).toContain("Estado que continha o local de nascimento nesse dia: Império Russo.");
    expect(data).toContain("Estados da Europa nesse dia: Áustria-Hungria, Império Russo.");
    expect(data).toContain("[1] data de nascimento: 1891-07-21 (fonte: Wikidata: Lasar Segall (Q1); documentado)");
    expect(data).toContain("[2] local de nascimento: Vilnius (fonte: Wikidata: Lasar Segall (Q1); não determinado)");
  });

  it("says when the period's map is unknown, and keeps unknown dates and places unknown", () => {
    const noYear = { ...artist, birthDate: date(null), deathDate: { ...date(null), year: 1957 } };
    const { data } = buildPrompt({ ...input, artist: noYear, birthPlace: { ...vilna, currentName: null }, period: null });
    expect(data).toContain("Nascimento: desconhecida, Vilna, Polônia");
    expect(data).toContain("Falecimento: 1957, desconhecido");
    expect(data).toMatch(/mapa do período não está disponível/);
    expect(buildPrompt({ ...input, period: { ...period, birthState: null, approximate: true } }).data).toMatch(
      /aproximado[\s\S]*nenhum identificado/,
    );
  });

  it("shows instructions then data as one text", () => {
    expect(promptText({ instructions: "I", data: "D" })).toBe("# Instruções\n\nI\n\n# Dados\n\nD");
  });
});

describe("citationsOf", () => {
  it("lists each cited finding once, in order", () => {
    expect(citationsOf("Nasceu em 1891 [2], em Vilna [1][2].")).toEqual([2, 1]);
    expect(citationsOf("sem citação")).toEqual([]);
  });
});

describe("summarize", () => {
  it("returns the model's text when every citation points to a finding", async () => {
    const fetcher = replying(text("Lasar Segall nasceu em 1891 [1] em Vilna, no Império Russo [2]."));
    const summary = await summarize(fetcher, gemini, input);
    expect(summary).toMatchObject({
      status: "ok",
      text: "Lasar Segall nasceu em 1891 [1] em Vilna, no Império Russo [2].",
      citations: [1, 2],
      model: "gemini-2.5-flash",
      detail: null,
    });
    expect(summary.prompt).toBe(promptText(buildPrompt(input)));

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(`${GEMINI_API}/gemini-flash-latest:generateContent`);
    expect(init?.method).toBe("POST");
    expect(init?.headers["x-goog-api-key"]).toBe("test-key");
    expect(JSON.parse(init?.body ?? "{}")).toMatchObject({
      systemInstruction: { parts: [{ text: buildPrompt(input).instructions }] },
      contents: [{ role: "user", parts: [{ text: buildPrompt(input).data }] }],
    });
  });

  it("waits as long as the configured timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await summarize(replying(text("Pintor [1].")), gemini, input);
    await summarize(replying(text("Pintor [1].")), { ...gemini, timeoutMs: 60_000 }, input);
    expect(timeout.mock.calls).toEqual([[16_000], [60_000]]);
    timeout.mockRestore();
  });

  it("falls back to the configured model name when Gemini does not report one", async () => {
    const summary = await summarize(replying({ candidates: [{ content: { parts: [{ text: "Pintor [1]." }] } }] }), gemini, input);
    expect(summary.model).toBe("gemini-flash-latest");
  });

  it("withholds a text that cites nothing, or cites a finding that does not exist", async () => {
    const uncited = await summarize(replying(text("Um grande pintor.")), gemini, input);
    expect(uncited).toMatchObject({ status: "rejected", text: null, detail: "no finding cited", model: "gemini-2.5-flash" });

    const invented = await summarize(replying(text("Nasceu em 1891 [1] e estudou em Berlim [3] [0].")), gemini, input);
    expect(invented).toMatchObject({ status: "rejected", text: null, detail: "cited findings that do not exist: 3, 0" });
  });

  it("shows the prompt without asking the model when there is no key", async () => {
    const fetcher = replying({});
    const summary = await summarize(fetcher, null, input);
    expect(summary).toMatchObject({ status: "not_configured", text: null, prompt: promptText(buildPrompt(input)) });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("has nothing to summarise without a match or findings", async () => {
    expect(await summarize(replying({}), gemini, { ...input, match: null })).toMatchObject({ status: "no_findings", prompt: null });
    expect((await summarize(replying({}), gemini, { ...input, findings: [] })).status).toBe("no_findings");
  });

  it("reports a model that fails or answers nothing", async () => {
    expect(await summarize(replying({}, false), gemini, input)).toMatchObject({ status: "error", detail: "Gemini answered 429" });
    const quota = { error: { details: [{}, { violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } };
    expect((await summarize(replying(quota, false), gemini, input)).detail).toBe(
      "Gemini answered 429 (GenerateRequestsPerDayPerProjectPerModel-FreeTier)",
    );
    const unreadable = vi.fn<Fetcher>(async () => ({ ok: false, status: 429, json: async () => Promise.reject(new Error("html")) }));
    expect((await summarize(unreadable, gemini, input)).detail).toBe("Gemini answered 429");
    const overloaded = vi.fn<Fetcher>(async () => ({ ok: false, status: 503, json: async () => quota }));
    expect((await summarize(overloaded, gemini, input)).detail).toBe("Gemini answered 503");
    expect((await summarize(replying({ candidates: [{}] }), gemini, input)).detail).toBe("Gemini answered with no text");
    expect((await summarize(replying({ candidates: [] }), gemini, input)).status).toBe("error");
    const thrown = vi.fn<Fetcher>(async () => {
      throw "network down";
    });
    expect((await summarize(thrown, gemini, input)).detail).toBe("network down");
  });
});
