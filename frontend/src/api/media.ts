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
  people: { name: string; role: string; character: string | null }[];
  owned: boolean;
  platforms: string[];
  runs: RunOut[];
  allowed: string[];
  suggest: string | null;
  seasons?: { number: number; name: string | null; premiere: string | null; episodes: Episode[] }[];
  next_episode?: Episode | null;
  upcoming_episode?: Episode | null;
  time_left?: number | null;
  following?: boolean;
  external_ids: Record<string, string>;
};

export type MediaLibrary = { counts: Record<string, number>; items: ItemCard[]; genres: string[] };
export type Hit = {
  kind: Kind; source: string; ext_id: string; title: string; year: number | null; subtitle: string | null;
  cover_url: string | null; item_id: number | null;
};
export type MediaSearch = { local: ItemCard[]; results: Hit[] };
export type UpNext = { item: ItemCard; episode: Episode; progress: Progress; last: string };

export type MediaSort = "recent" | "rating" | "year" | "title";

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
  patchRun: (runId: number, body: Partial<{ rating: number; clear_rating: boolean; review: string; goal: Goal; started_on: string; finished_on: string; date_precision: RunPrecision }>) =>
    request<ItemDetail>("PATCH", `/media/runs/${runId}`, { body }),
  deleteRun: (runId: number) => request<void>("DELETE", `/media/runs/${runId}`),
  progress: (runId: number, body: Partial<{ unit: string; current: number; total: number; hours: number; percent: number }>) =>
    request<ItemDetail>("POST", `/media/runs/${runId}/progress`, { body }),
  episodes: (id: number, body: { episode_ids?: number[]; season?: number; watched: boolean }) =>
    request<ItemDetail>("POST", `/media/items/${id}/episodes`, { body }),
  upNext: () => request<UpNext[]>("GET", "/media/shows/up-next"),
  backlog: () => request<(ItemCard & { hours_left: number | null })[]>("GET", "/media/backlog"),
};

export const useMediaLibrary = (kind: Kind, p: { status?: string[]; genre?: string[]; sort?: MediaSort }) =>
  useQuery({ queryKey: ["media", kind, "library", p], queryFn: () => mediaApi.library(kind, p), placeholderData: keepPreviousData });
export const useMediaSearch = (kind: Kind, q: string) =>
  useQuery({ queryKey: ["media", kind, "search", q], queryFn: () => mediaApi.search(kind, q), enabled: q.trim().length >= 2, placeholderData: keepPreviousData, retry: false });
export const useItem = (id: number) => useQuery({ queryKey: ["media", "item", id], queryFn: () => mediaApi.item(id), enabled: id > 0 });
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
