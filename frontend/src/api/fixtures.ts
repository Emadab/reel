// Fixture mode (VITE_FIXTURES=1): answers API calls from design/fixtures/sample-data.json,
// adapted to the backend's response shapes. Mutations are accepted and ignored.
import data from "../../../design/fixtures/sample-data.json";
import type {
  Explain, FilmCard, Library, MapPoint, MovieDetail, Rec, Recommendations, SearchResponse, Stats, TasteMap, Timeline,
} from "./types";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const d = data as Any;

const lib = d.library as Library & { items: FilmCard[] };
const allCards: FilmCard[] = [
  ...lib.items,
  ...d.timeline.months.flatMap((m: Any) => m.films),
  ...Object.values(d.movie_detail as Record<string, FilmCard>),
];
const byTitle = (title: string) => allCards.find((c) => c.title === title);
const byId = (id: number) => allCards.find((c) => c.tmdb_id === id);

function card(partial: Any): FilmCard {
  return {
    year: null, director: null, runtime: null, poster: null, poster_sm: null, palette: [], genres: [],
    my_rating: null, watch_count: 0, on_watchlist: false, last_watched: null, ...partial,
    poster_art: { motif: "sun", ...(partial.poster_art ?? {}) },
  };
}

function rec(r: Any): Rec {
  const liked: number[] = d.recommendations.ui_state.liked;
  const dismissed: number[] = d.recommendations.ui_state.dismissed;
  return {
    ...card(r),
    palette: r.glow ? [r.glow, r.poster_art.fg, r.poster_art.bg] : [],
    because: (r.because ?? []).map((t: string, i: number) => ({
      ...(byTitle(t) ?? card({ tmdb_id: -i, title: t })),
      my_rating: r.because_ratings?.[i] ?? byTitle(t)?.my_rating ?? null,
    })),
    reasons: r.reasons ?? [],
    why: r.why ?? null,
    glow: r.glow ?? null,
    reaction: liked.includes(r.tmdb_id) ? "like" : dismissed.includes(r.tmdb_id) ? "not_interested" : null,
  } as Rec;
}

function recommendations(filter: string): Recommendations {
  const r = d.recommendations;
  const items: Rec[] = r.items.map(rec);
  const keep = (x: Rec) => filter === "all" || (filter === "short" && (x.runtime ?? 999) < 120) || (filter === "wild" && x.is_wildcard);
  const top = rec(r.top);
  return {
    model: r.model, onboarding: false, computing: false,
    top: filter === "all" ? top : null,
    items: filter === "all" ? items : [top, ...items].filter(keep),
    health: r.health,
  };
}

/** The unseen-candidate dots, generated exactly like design/reference/TasteMap.dc.html (seed 7). */
function candidateDots(): MapPoint[] {
  let s = 7;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const gauss = () => {
    let u = 0;
    for (let i = 0; i < 4; i++) u += rnd();
    return (u - 2) / 1.1;
  };
  const centers = [[22, 32, 9], [62, 25, 11], [28, 68, 11], [72, 63, 10], [88, 34, 5]];
  const dots: MapPoint[] = [];
  let id = -1;
  centers.forEach(([cx, cy, sp]) => {
    for (let i = 0; i < 28; i++) {
      const x = Math.min(97, Math.max(3, cx + gauss() * sp));
      const y = Math.min(96, Math.max(4, cy + gauss() * sp * 0.9));
      dots.push({ tmdb_id: id--, title: "", kind: "candidate", x: +x.toFixed(1) / 100, y: +y.toFixed(1) / 100, alpha: +(0.12 + rnd() * 0.18).toFixed(2) });
    }
  });
  for (let i = 0; i < 24; i++) {
    dots.push({ tmdb_id: id--, title: "", kind: "candidate", x: +(3 + rnd() * 94).toFixed(1) / 100, y: +(4 + rnd() * 92).toFixed(1) / 100, alpha: 0.1 });
  }
  return dots;
}

function tastemap(): TasteMap {
  const t = d.tastemap;
  return {
    film_count: t.film_count,
    points: [...t.points.map((p: Any) => ({ ...p, bg: p.color })), ...candidateDots()],
    clusters: t.clusters,
    default_selected: t.default_selected,
  };
}

function explain(id: number): Explain {
  const e = d.tastemap.explain[id];
  const r = d.recommendations;
  const raw = [r.top, ...r.items].find((x: Any) => x.tmdb_id === id);
  const point = d.tastemap.points.find((p: Any) => p.tmdb_id === id);
  return {
    film: raw ? rec(raw) : (rec({ ...point, poster_art: { bg: "#333" } })),
    nearest: (e?.nearest ?? []).map((n: Any) => ({ film: { ...(byId(n.tmdb_id) ?? card(n)), my_rating: n.rating }, similarity: n.similarity })),
    note: e?.note ?? "",
  };
}

function movie(id: number): MovieDetail {
  const full = d.movie_detail[id];
  if (full) return { ...full, trailer_key: full.trailer_key ?? "fixture" }; // the mock shows the trailer panel
  const c = byId(id) ?? [d.recommendations.top, ...d.recommendations.items].map(rec).find((x) => x.tmdb_id === id) ?? card({ tmdb_id: id, title: "Unknown" });
  return {
    ...c, overview: null, keywords: [], cast: [], crew_highlights: {}, language: null, release_date: null,
    backdrop: null, trailer_key: null, scores: { tmdb: null, imdb: null, rt: null, metacritic: null },
    watches: [], neighbors: [], fetched_at: "2026-10-01T10:00:00Z",
  };
}

function timeline(year: number): Timeline {
  if (year === d.timeline.year) return d.timeline;
  const y = d.timeline.years.find((x: Any) => x.year === year);
  return {
    year, totals: { watches: y?.total ?? 0, approx: y?.approx ?? 0, hours: 0 },
    months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, films: [], approx: [] })), year_only: [],
  };
}

function stats(range: string): Stats {
  return { ...d.stats[range === "all" ? "all" : "2026"], heatmap: d.stats.heatmap };
}

function search(q: string): SearchResponse {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return { results: [], took_ms: 0 };
  return { results: d.search.results.filter((r: Any) => r.title.toLowerCase().includes(needle)), took_ms: d.search.took_ms };
}

export function fixture(method: string, path: string, params: Record<string, Any>): unknown {
  if (method !== "GET") return path === "/watches" ? { id: 999, ...params } : undefined;
  const m = path.match(/^\/movies\/(\d+)$/);
  if (m) return movie(Number(m[1]));
  const e = path.match(/^\/tastemap\/explain\/(-?\d+)$/);
  if (e) return explain(Number(e[1]));
  switch (path) {
    case "/library":
      return params.tab === "watchlist" ? { ...lib, items: [] } : params.tab === "rewatches" ? { ...lib, items: lib.items.filter((i) => i.watch_count > 1) } : lib;
    case "/library/facets":
      return {
        genres: [...new Set(lib.items.flatMap((i) => i.genres))],
        decades: [...new Set(lib.items.map((i) => Math.floor((i.year ?? 0) / 10) * 10))].sort((a, b) => b - a),
        directors: [...new Set(lib.items.map((i) => i.director).filter(Boolean))],
      };
    case "/search": return search(String(params.q ?? ""));
    case "/watches/recent": return lib.items.slice(0, 5);
    case "/watchlist": return [];
    case "/timeline": return timeline(Number(params.year ?? d.timeline.year));
    case "/timeline/years": return d.timeline.years;
    case "/stats": return stats(String(params.range ?? "all"));
    case "/recommendations": return recommendations(String(params.filter ?? "all"));
    case "/tastemap": return tastemap();
    case "/onboarding": return lib.items.slice(0, 8);
    case "/settings":
      return { accent: d.accent, accents: ["#7FDBFF", "#C6F36B", "#FFB86B", "#C9A7FF"], data_dir: "./data", tmdb_configured: true, tmdb_connected: null, omdb_configured: true };
    default: return undefined;
  }
}
