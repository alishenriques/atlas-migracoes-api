import type { Dataset, FuzzyDate } from "../schemas/domain.js";

// Served only when DATABASE_URL is not set (local dev, previews, tests), with
// meta.source = "demo" so the app can label it. Every person, work and event
// below is SIMULATED: the real MAC USP data enters the database through
// `yarn import:xlsx` and is never committed to this public repository. Only
// the cities and their coordinates are real, so the map has somewhere to draw.

const year = (y: number): FuzzyDate => ({ raw: String(y), year: y, endYear: y, iso: null, precision: "year" });
const circa = (y: number): FuzzyDate => ({ raw: `c. ${y}`, year: y, endYear: y, iso: null, precision: "circa" });
const unknown: FuzzyDate = { raw: "s.d.", year: null, endYear: null, iso: null, precision: "unknown" };

export const demoDataset: Dataset = {
  places: [
    { id: "polonia-varsovia", label: "Varsóvia", path: ["Polônia", "Varsóvia"], country: "Polônia", currentName: null, lat: 52.2297, lng: 21.0122 },
    { id: "austria-viena", label: "Viena", path: ["Áustria", "Viena"], country: "Áustria", currentName: null, lat: 48.2082, lng: 16.3738 },
    { id: "brasil-sao-paulo-sao-paulo", label: "São Paulo", path: ["Brasil", "São Paulo", "São Paulo"], country: "Brasil", currentName: null, lat: -23.5505, lng: -46.6333 },
    { id: "brasil-rio-de-janeiro-rio-de-janeiro", label: "Rio de Janeiro", path: ["Brasil", "Rio de Janeiro", "Rio de Janeiro"], country: "Brasil", currentName: null, lat: -22.9068, lng: -43.1729 },
  ],
  artists: [
    { id: "artista-demo-a", slug: "artista-demo-a", name: "Artista Demo A (simulado)", birthPlaceId: "polonia-varsovia", birthDate: year(1905), deathPlaceId: "brasil-sao-paulo-sao-paulo", deathDate: year(1980) },
    { id: "artista-demo-b", slug: "artista-demo-b", name: "Artista Demo B (simulado)", birthPlaceId: "austria-viena", birthDate: circa(1912), deathPlaceId: null, deathDate: unknown },
  ],
  works: [
    { id: "DEMO.1", artistId: "artista-demo-a", title: "Obra de demonstração 1", date: year(1950), technique: "óleo sobre tela", dimensions: null, acquisition: null, acquisitionDate: unknown, history: null, exhibitionIds: ["DEMO.EX.1"], publicationIds: ["DEMO.PB.1"] },
    { id: "DEMO.2", artistId: "artista-demo-b", title: "Obra de demonstração 2", date: circa(1960), technique: "gravura", dimensions: null, acquisition: null, acquisitionDate: unknown, history: null, exhibitionIds: ["DEMO.EX.1"], publicationIds: [] },
  ],
  exhibitions: [
    { id: "DEMO.EX.1", title: "Exposição de demonstração", startDate: year(1961), endDate: year(1961), institution: null, venue: null, placeId: "brasil-rio-de-janeiro-rio-de-janeiro" },
  ],
  publications: [
    { id: "DEMO.PB.1", authors: null, title: "Catálogo de demonstração", city: "São Paulo", publisher: null, date: year(1961), category: "Catálogo", periodical: null, volume: null, isbn: null, relatedExhibitionTitle: "Exposição de demonstração" },
  ],
};
