import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { api } from "../api/client";
import { useExplain, useTasteMap } from "../api/hooks";
import { Poster } from "../components/Poster";
import { TasteMapView, type MapData, type MapExplain } from "../components/TasteMapView";
import { useToast } from "../components/Toasts";
import { runtime } from "../lib/format";

const COPY = { noun: "film", nouns: "films", mine: "watched", forYou: "/for-you", save: "Add to watchlist" };

export default function TasteMap() {
  const [sp] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, error, isLoading } = useTasteMap();
  const [selected, setSelected] = useState<number | null>(null);
  const sel = selected ?? (Number(sp.get("focus")) || null) ?? data?.default_selected ?? null;
  const explain = useExplain(sel);

  const map = useMemo<MapData | undefined>(
    () =>
      data && {
        count: data.film_count,
        clusters: data.clusters,
        default_selected: data.default_selected,
        points: data.points.map(({ tmdb_id, kind, poster_sm, ...p }) => ({ ...p, id: tmdb_id, kind: kind === "watched" ? "mine" : kind, poster: poster_sm })),
      },
    [data],
  );
  const e = explain.data;
  const why = useMemo<MapExplain | undefined>(
    () =>
      e && {
        subject: {
          id: e.film.tmdb_id, title: e.film.title, meta: [e.film.director, e.film.year, runtime(e.film.runtime)].filter(Boolean).join(" · "),
          score: e.film.score, my_rating: e.film.my_rating, wild: e.film.is_wildcard, saved: e.film.on_watchlist,
        },
        nearest: e.nearest.map((n) => ({ id: n.film.tmdb_id, title: n.film.title, my_rating: n.film.my_rating, similarity: n.similarity })),
        note: e.note,
      },
    [e],
  );

  return (
    <TasteMapView
      data={map}
      error={error}
      isLoading={isLoading}
      explain={why}
      selected={sel}
      onSelect={setSelected}
      copy={COPY}
      href={(id) => `/film/${id}?from=map`}
      poster={() => e && <Poster film={e.film} size="side" className="w-16" />}
      onSave={async () => {
        if (!e) return;
        try {
          await api.addToWatchlist(e.film.tmdb_id);
          await api.feedback(e.film.tmdb_id, "added_watchlist");
          qc.invalidateQueries();
          toast({ text: <>Added <em>{e.film.title}</em> to your watchlist</> });
        } catch (err) {
          toast({ text: err instanceof Error ? err.message : "Couldn't save" });
        }
      }}
    />
  );
}
