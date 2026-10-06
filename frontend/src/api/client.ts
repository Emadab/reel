import { FIXTURES } from "../lib/format";
import type {
  Explain, Facets, FilmCard, ImportJob, Library, MovieDetail, Recommendations, Reaction, SearchResponse,
  SettingsOut, Stats, TasteMap, Timeline, WatchIn, WatchOut, WatchPatch, YearBar,
} from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Params = Record<string, string | number | boolean | null | undefined | (string | number)[]>;

function query(params?: Params): string {
  if (!params) return "";
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    for (const item of Array.isArray(v) ? v : [v]) q.append(k, String(item));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function request<T>(method: string, path: string, opts: { params?: Params; body?: unknown } = {}): Promise<T> {
  if (FIXTURES) {
    const { fixture } = await import("./fixtures");
    return fixture(method, path, opts.params ?? {}) as T;
  }
  const isForm = opts.body instanceof FormData;
  const r = await fetch(`/api${path}${query(opts.params)}`, {
    method,
    headers: opts.body && !isForm ? { "Content-Type": "application/json" } : undefined,
    body: opts.body == null ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
  });
  if (!r.ok) {
    let detail = r.statusText;
    try {
      const j = await r.json();
      detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* not JSON */
    }
    throw new ApiError(r.status, detail);
  }
  return (r.status === 204 ? undefined : await r.json()) as T;
}

export type LibraryParams = {
  tab?: "watched" | "watchlist" | "rewatches";
  genre?: string[];
  decade?: number[];
  min_rating?: number | null;
  director?: string | null;
  sort?: "recent" | "rating" | "year" | "title" | "runtime";
  cursor?: number;
};

export const api = {
  library: (p: LibraryParams) => request<Library>("GET", "/library", { params: p }),
  facets: () => request<Facets>("GET", "/library/facets"),
  movie: (id: number) => request<MovieDetail>("GET", `/movies/${id}`),
  refresh: (id: number) => request<MovieDetail>("POST", `/movies/${id}/refresh`),
  deleteAllWatches: (id: number) => request<void>("DELETE", `/movies/${id}/watches`),
  search: (q: string) => request<SearchResponse>("GET", "/search", { params: { q } }),
  recent: () => request<FilmCard[]>("GET", "/watches/recent"),
  logWatch: (body: WatchIn) => request<WatchOut>("POST", "/watches", { body }),
  editWatch: (id: number, body: WatchPatch) => request<WatchOut>("PATCH", `/watches/${id}`, { body }),
  deleteWatch: (id: number) => request<void>("DELETE", `/watches/${id}`),
  watchlist: () => request<FilmCard[]>("GET", "/watchlist"),
  addToWatchlist: (id: number) => request<unknown>("POST", `/watchlist/${id}`),
  removeFromWatchlist: (id: number) => request<void>("DELETE", `/watchlist/${id}`),
  timeline: (year: number) => request<Timeline>("GET", "/timeline", { params: { year } }),
  years: () => request<YearBar[]>("GET", "/timeline/years"),
  stats: (range: string) => request<Stats>("GET", "/stats", { params: { range } }),
  recommendations: (filter: string) => request<Recommendations>("GET", "/recommendations", { params: { filter } }),
  feedback: (tmdb_id: number, signal: Exclude<Reaction, null> | "dislike" | "opened" | "seen_rated") =>
    request<void>("POST", "/feedback", { body: { tmdb_id, signal } }),
  undoFeedback: (tmdb_id: number, signal: string) => request<void>("DELETE", `/feedback/${tmdb_id}/${signal}`),
  tastemap: () => request<TasteMap>("GET", "/tastemap"),
  explain: (id: number) => request<Explain>("GET", `/tastemap/explain/${id}`),
  onboarding: () => request<FilmCard[]>("GET", "/onboarding"),
  skipOnboarding: (id: number) => request<void>("POST", `/onboarding/skip/${id}`),
  settings: () => request<SettingsOut>("GET", "/settings"),
  putSettings: (body: Partial<{ accent: string; tmdb_token: string; omdb_key: string; data_dir: string }>) =>
    request<SettingsOut>("PUT", "/settings", { body }),
  testKey: (name: string) => request<{ ok: boolean }>("POST", `/settings/test/${name}`),
  importUpload: (source: "letterboxd" | "imdb", files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    return request<{ job_id: number; rows: number }>("POST", `/import/${source}`, { body: fd });
  },
  importJob: (id: number) => request<ImportJob>("GET", `/import/${id}`),
  patchImportRow: (id: number, i: number, body: { tmdb_id?: number; include?: boolean }) =>
    request<unknown>("PATCH", `/import/${id}/rows/${i}`, { body }),
  commitImport: (id: number) => request<{ created: number; skipped: number }>("POST", `/import/${id}/commit`),
  restore: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<{ ok: boolean }>("POST", "/system/restore", { body: fd });
  },
};
