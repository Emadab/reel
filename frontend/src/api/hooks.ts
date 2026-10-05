import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type LibraryParams } from "./client";
import type { WatchIn, WatchPatch } from "./types";

export const useLibrary = (p: LibraryParams) =>
  useInfiniteQuery({
    queryKey: ["library", p],
    queryFn: ({ pageParam }) => api.library({ ...p, cursor: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  });

export const useFacets = () => useQuery({ queryKey: ["facets"], queryFn: api.facets });
export const useMovie = (id: number) =>
  useQuery({
    queryKey: ["movie", id],
    queryFn: () => api.movie(id),
    enabled: id > 0,
    // backdrop/poster still downloading in the background: check back a few times
    refetchInterval: (q) => (q.state.data?.images_pending && q.state.dataUpdateCount < 8 ? 2500 : false),
  });
export const useSearch = (q: string) =>
  useQuery({ queryKey: ["search", q], queryFn: () => api.search(q), enabled: q.trim().length >= 2, placeholderData: keepPreviousData, retry: false });
export const useRecent = (enabled: boolean) => useQuery({ queryKey: ["recent"], queryFn: api.recent, enabled });
export const useWatchlist = (enabled = true) => useQuery({ queryKey: ["watchlist"], queryFn: api.watchlist, enabled });
export const useTimeline = (year: number) => useQuery({ queryKey: ["timeline", year], queryFn: () => api.timeline(year), placeholderData: keepPreviousData });
export const useYears = () => useQuery({ queryKey: ["years"], queryFn: api.years });
export const useStats = (range: string) => useQuery({ queryKey: ["stats", range], queryFn: () => api.stats(range), placeholderData: keepPreviousData });
export const useRecs = (filter: string) =>
  useQuery({
    queryKey: ["recs", filter],
    queryFn: () => api.recommendations(filter),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.computing ? 4000 : false),
  });
export const useTasteMap = () => useQuery({ queryKey: ["tastemap"], queryFn: api.tastemap });
export const useExplain = (id: number | null) =>
  useQuery({ queryKey: ["explain", id], queryFn: () => api.explain(id!), enabled: id != null, placeholderData: keepPreviousData });
export const useOnboarding = (enabled: boolean) => useQuery({ queryKey: ["onboarding"], queryFn: api.onboarding, enabled, staleTime: Infinity });
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: api.settings, staleTime: Infinity });

/** Logging, editing or deleting anything can change every view, so mutations refresh all queries. */
function useMut<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries() });
}

export const useLogWatch = () => useMut((w: WatchIn) => api.logWatch(w));
export const useEditWatch = () => useMut(({ id, patch }: { id: number; patch: WatchPatch }) => api.editWatch(id, patch));
export const useDeleteWatch = () => useMut((id: number) => api.deleteWatch(id));
export const useDeleteAllWatches = () => useMut((id: number) => api.deleteAllWatches(id));
export const useRefreshMovie = () => useMut((id: number) => api.refresh(id));
export const useWatchlistToggle = () =>
  useMut(({ id, on }: { id: number; on: boolean }) => (on ? api.addToWatchlist(id) : api.removeFromWatchlist(id)));
