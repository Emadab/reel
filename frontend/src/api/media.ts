// Shows, books and games: response shapes, client and TanStack Query hooks (backend: app/routers/media.py).
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "./client";
import type { PosterArtColors } from "./types";

export type Kind = "show" | "book" | "game";
export type RunPrecision = "day" | "month" | "year" | "unknown";

export type ItemCard = {
  id: number;
  kind: Kind;
  title: string;
  year: number | null;
  subtitle: string | null;
  poster: string | null;
  poster_sm: string | null;
  backdrop: string | null;
  palette: string[];
  poster_art: PosterArtColors;
  genres: string[];
  item_status: "released" | "upcoming" | "returning" | "ended" | "canceled";
  endless: boolean;
  status: string | null;
  shelf: string | null;
  in_library: boolean;
  my_rating: number | null;
  progress: Progress;
  run_no: number;
  sticky: boolean;
  added_at: string | null;
};

export type Progress = {
  watched?: number; aired?: number; total?: number; // shows
  unit?: "page" | "percent" | "minutes"; current?: number; // books (total shared)
  hours?: number; percent?: number; // games
};

export type Episode = {
  id: number; season: number; number: number; title: string | null; overview: string | null;
  airstamp: string | null; aired: boolean; runtime: number | null; still: string | null; special: boolean; watched: boolean;
  watched_on: string | null; watched_precision: RunPrecision | null;
};

export type RunOut = {
  id: number; run_no: number; status: string | null; status_source: "user" | "derived";
  started_on: string | null; finished_on: string | null; date_precision: RunPrecision;
  progress: Progress; goal: Goal | null; variant: Record<string, string>; rating: number | null; review: string | null;
};
export type Goal = "main" | "main_extras" | "completionist";

export type ItemDetail = ItemCard & {
  original_title: string | null;
  overview: string | null;
  tagline: string | null;
  tags: string[];
  release_date: string | null;
  details: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  people: { name: string; role: string; character: string | null; photo: string | null }[];
  owned: boolean;
  platforms: string[];
  runs: RunOut[];
  allowed: string[];
  suggest: string | null;
  seasons?: { number: number; name: string | null; premiere: string | null; episodes: Episode[] }[];
  next_episode?: Episode | null;
  upcoming_episode?: Episode | null;
  collection?: { name: string; items: ItemCard[] } | null;
  time_left?: number | null;
  follow?: FollowState;
  external_ids: Record<string, string>;
  neighbors: { item: ItemCard; score: number | null }[];
  neighbors_pending: boolean;
};

export type MediaLibrary = { counts: Record<string, number>; items: ItemCard[]; genres: string[] };
export type Hit = {
  kind: Kind; source: string; ext_id: string; title: string; year: number | null; subtitle: string | null;
  cover_url: string | null; item_id: number | null;
};
export type MediaSearch = { local: ItemCard[]; results: Hit[] };
export type UpNext = { item: ItemCard; episode: Episode; progress: Progress; last: string };

export type Note = { id: number; type: string; title: string; text: string; path: string | null; item_id: number | null; created_at: string; seen: boolean };
export type CalendarEntry = { at: string; day: string; item: ItemCard; label: string; title: string | null; aired: boolean };
export type FollowState = { notify: boolean; priority: boolean };
export type FollowRow = { id: number; target_kind: "author" | "series"; target_id: string; name: string };

export type RunRef = { id: number; status: string; finished_on: string; precision: RunPrecision; rating: number | null; run_no: number };
export type TimelineEntry = ItemCard & { run: RunRef };
export type MediaTimeline = {
  year: number;
  totals: { finished: number; approx: number; hours?: number; episodes?: number; pages?: number };
  months: { month: number; items: TimelineEntry[]; approx: TimelineEntry[]; activity: number }[];
  year_only: TimelineEntry[];
};
export type MediaStats = {
  kpis: { items: number; finished: number; dropped: number; drop_rate: number | null; in_progress: number; active_days: number;
    avg_rating: number | null; hours?: number; episodes?: number; pages?: number };
  genres: { name: string; value: number; count?: number }[];
  people: { title: string; rows: { name: string; count: number }[] }[];
  ratings: { bin: number; count: number }[];
  mean: number | null;
  heatmap: { start: string; end: string; days: { date: string; count: number }[] };
};
export type AllStats = { rows: { kind: "movie" | Kind; label: string; finished: number; finished_label: string; hours: number | null; pages: number | null; drop_rate: number | null; drop_label: string | null }[]; hours: number };
export type MediaRec = ItemCard & { score: number; because: ItemCard[]; reasons: string[]; overview: string | null; wildcard: boolean; liked: boolean };
export type MediaRecs = { items: MediaRec[]; model: string | null; learned_from: number; computing: boolean };
export type MapPoint = { id: number; title: string; x: number; y: number; kind: "mine" | "suggested"; rating?: number | null; status?: string | null; color?: string; score?: number; poster: string | null };
export type ImportRow = { raw: { title: string; author: string | null; status: string; rating: number | null; date: string | null; precision: string }; status: "pending" | "matched" | "ambiguous" | "unmatched"; ext_id?: string | null; include?: boolean; options?: { ext_id: string; title: string; year: number | string | null; subtitle?: string | null }[] };
export type MediaImportJob = { id: number; source: string; committed: boolean; state: string; progress: { done: number; total: number }; summary: { matched: number; ambiguous: number; unmatched: number; included: number }; rows: ImportRow[] };

export type MediaSort = "recent" | "watched" | "rating" | "year" | "title";

export const mediaApi = {
  library: (kind: Kind, p: { status?: string[]; genre?: string[]; sort?: MediaSort }) =>
    request<MediaLibrary>("GET", `/media/${kind}/library`, { params: p }),
  search: (kind: Kind, q: string) => request<MediaSearch>("GET", `/media/${kind}/search`, { params: { q } }),
  add: (kind: Kind, body: { ext_id: string; shelf?: string; status?: string }) => request<ItemCard>("POST", `/media/${kind}/items`, { body }),
  item: (id: number) => request<ItemDetail>("GET", `/media/items/${id}`),
  refresh: (id: number) => request<ItemDetail>("POST", `/media/items/${id}/refresh`),
  patch: (id: number, body: Partial<{ shelf: string; owned: boolean; platforms: string[]; priority: number; endless: boolean }>) =>
    request<ItemDetail>("PATCH", `/media/items/${id}`, { body }),
  remove: (id: number) => request<void>("DELETE", `/media/items/${id}`),
  setStatus: (id: number, status: string) => request<ItemDetail>("POST", `/media/items/${id}/status`, { body: { status } }),
  startRun: (id: number, body: { status: string; goal?: Goal | null; started_on?: string | null; finished_on?: string | null; date_precision?: RunPrecision; rating?: number | null }) =>
    request<ItemDetail>("POST", `/media/items/${id}/runs`, { body }),
  patchRun: (runId: number, body: Partial<{ rating: number; clear_rating: boolean; review: string; goal: Goal; variant: Record<string, string>; started_on: string; finished_on: string; clear_started: boolean; clear_finished: boolean; date_precision: RunPrecision }>) =>
    request<ItemDetail>("PATCH", `/media/runs/${runId}`, { body }),
  deleteRun: (runId: number) => request<void>("DELETE", `/media/runs/${runId}`),
  progress: (runId: number, body: Partial<{ unit: string; current: number; total: number; hours: number; percent: number }>) =>
    request<ItemDetail>("POST", `/media/runs/${runId}/progress`, { body }),
  episodes: (id: number, body: { episode_ids?: number[]; season?: number; watched: boolean; watched_on?: string; date_precision?: RunPrecision }) =>
    request<ItemDetail>("POST", `/media/items/${id}/episodes`, { body }),
  history: (id: number, body: { upto_season: number | null; started_on?: string; finished_on?: string; date_precision: RunPrecision; rating?: number | null; on_air_dates?: boolean }) =>
    request<ItemDetail>("POST", `/media/items/${id}/history`, { body }),
  upNext: () => request<UpNext[]>("GET", "/media/shows/up-next"),
  notifications: () => request<{ unseen: number; items: Note[] }>("GET", "/notifications"),
  seen: (ids?: number[]) => request<void>("POST", "/notifications/seen", { body: { ids: ids ?? null } }),
  calendar: (kind: Kind) => request<CalendarEntry[]>("GET", `/media/${kind}/calendar`),
  follow: (id: number, body: { notify?: boolean; priority?: boolean }) => request<FollowState>("POST", `/media/items/${id}/follow`, { body }),
  follows: () => request<FollowRow[]>("GET", "/follows"),
  addFollow: (body: { target_kind: "author" | "series"; target_id: string; name: string }) => request<FollowRow[]>("POST", "/follows", { body }),
  removeFollow: (id: number) => request<void>("DELETE", `/follows/${id}`),
  timeline: (kind: Kind, year: number) => request<MediaTimeline>("GET", `/media/${kind}/timeline`, { params: { year } }),
  years: (kind: Kind) => request<{ year: number; total: number; approx: number }[]>("GET", `/media/${kind}/timeline/years`),
  stats: (kind: Kind | "all", range: string) => request<MediaStats>("GET", `/media/${kind}/stats`, { params: { range } }),
  allStats: (range: string) => request<AllStats>("GET", "/media/all/stats", { params: { range } }),
  recs: (kind: Kind, wild = false) => request<MediaRecs>("GET", `/media/${kind}/recommendations${wild ? "?wild=true" : ""}`),
  feedback: (id: number, like: boolean) => request<{ liked: boolean }>("POST", `/media/items/${id}/feedback`, { body: { like } }),
  seenIt: (id: number, rating: number | null) => request<ItemDetail>("POST", `/media/items/${id}/seen`, { body: { rating } }),
  recompute: (kind: Kind) => request<void>("POST", `/media/${kind}/recommendations/recompute`),
  tastemap: (kind: Kind) => request<{ points: MapPoint[] }>("GET", `/media/${kind}/tastemap`),
  importUpload: (source: string, file: File) => {
    const fd = new FormData();
    fd.append("files", file);
    return request<{ job_id: number; rows: number }>("POST", `/media/import/${source}`, { body: fd });
  },
  importJob: (id: number) => request<MediaImportJob>("GET", `/media/import/${id}`),
  patchImportRow: (id: number, i: number, body: { ext_id?: string; include?: boolean }) => request<unknown>("PATCH", `/media/import/${id}/rows/${i}`, { body }),
  commitImport: (id: number) => request<{ created: number; skipped: number }>("POST", `/media/import/${id}/commit`),
  backlog: () => request<(ItemCard & { hours_left: number | null })[]>("GET", "/media/backlog"),
};

export const useMediaLibrary = (kind: Kind, p: { status?: string[]; genre?: string[]; sort?: MediaSort }) =>
  useQuery({ queryKey: ["media", kind, "library", p], queryFn: () => mediaApi.library(kind, p), placeholderData: keepPreviousData });
export const useMediaSearch = (kind: Kind, q: string) =>
  useQuery({ queryKey: ["media", kind, "search", q], queryFn: () => mediaApi.search(kind, q), enabled: q.trim().length >= 2, placeholderData: keepPreviousData, retry: false });
export const useItem = (id: number) =>
  useQuery({ queryKey: ["media", "item", id], queryFn: () => mediaApi.item(id), enabled: id > 0, refetchInterval: (q) => (q.state.data?.neighbors_pending ? 3000 : false) });
export const useNotifications = (enabled: boolean) =>
  useQuery({ queryKey: ["media", "notifications"], queryFn: mediaApi.notifications, enabled, refetchInterval: 60_000 });
export const useCalendar = (kind: Kind) => useQuery({ queryKey: ["media", kind, "calendar"], queryFn: () => mediaApi.calendar(kind) });
export const useFollows = (enabled: boolean) => useQuery({ queryKey: ["media", "follows"], queryFn: mediaApi.follows, enabled });
export const useMediaTimeline = (kind: Kind, year: number) =>
  useQuery({ queryKey: ["media", kind, "timeline", year], queryFn: () => mediaApi.timeline(kind, year), placeholderData: keepPreviousData });
export const useMediaYears = (kind: Kind) => useQuery({ queryKey: ["media", kind, "years"], queryFn: () => mediaApi.years(kind) });
export const useMediaStats = (kind: Kind, range: string) =>
  useQuery({ queryKey: ["media", kind, "stats", range], queryFn: () => mediaApi.stats(kind, range), placeholderData: keepPreviousData });
export const useAllStats = (range: string, enabled: boolean) =>
  useQuery({ queryKey: ["media", "all", "stats", range], queryFn: () => mediaApi.allStats(range), enabled });
export const useMediaRecs = (kind: Kind, wild = false) =>
  useQuery({ queryKey: ["media", kind, "recs", wild], queryFn: () => mediaApi.recs(kind, wild), refetchInterval: (q) => (q.state.data?.computing ? 4000 : false) });
export const useMediaMap = (kind: Kind) => useQuery({ queryKey: ["media", kind, "map"], queryFn: () => mediaApi.tastemap(kind) });
export const useBacklog = () => useQuery({ queryKey: ["media", "backlog"], queryFn: mediaApi.backlog });
export const useUpNext = (enabled: boolean) => useQuery({ queryKey: ["media", "show", "up-next"], queryFn: mediaApi.upNext, enabled });

/** Any media write can change every media view; movie queries are left alone. */
export function useMediaMut<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      if (data && typeof data === "object" && "runs" in (data as object)) qc.setQueryData(["media", "item", (data as unknown as ItemDetail).id], data);
      void qc.invalidateQueries({ queryKey: ["media"] });
    },
  });
}
