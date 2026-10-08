import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { mediaApi, useMediaExplain, useMediaMap, type Kind } from "../../api/media";
import { Poster } from "../../components/Poster";
import { TasteMapView, type MapExplain } from "../../components/TasteMapView";
import { useToast } from "../../components/Toasts";
import { MODES, SHELF_LABEL } from "../../lib/mode";
import { asFilm } from "./parts";

const MINE: Record<Kind, string> = { show: "watched", book: "read", game: "played" };

/** The film taste map for shows, books and games: same layout, clusters and explanations. */
export default function MediaTasteMap({ kind }: { kind: Kind }) {
  const [sp] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, error, isLoading } = useMediaMap(kind);
  const [selected, setSelected] = useState<number | null>(null);
  const sel = selected ?? (Number(sp.get("focus")) || null) ?? data?.default_selected ?? null;
  const e = useMediaExplain(kind, sel).data;
  const [noun, nouns] = MODES[kind].noun;
  const wish = SHELF_LABEL[kind].wishlist;
  const why = useMemo<MapExplain | undefined>(
    () =>
      e && {
        subject: {
          id: e.item.id, title: e.item.title, meta: [e.item.subtitle, e.item.year, e.item.genres.slice(0, 2).join(", ")].filter(Boolean).join(" · "),
          score: e.item.score, my_rating: e.item.my_rating, wild: e.item.wildcard, saved: e.item.in_library,
        },
        nearest: e.nearest.map((n) => ({ id: n.item.id, title: n.item.title, my_rating: n.item.my_rating, similarity: n.similarity })),
        note: e.note,
      },
    [e],
  );

  return (
    <TasteMapView
      data={data}
      error={error}
      isLoading={isLoading}
      explain={why}
      selected={sel}
      onSelect={setSelected}
      copy={{ noun, nouns, mine: MINE[kind], forYou: `${MODES[kind].base}/for-you`, save: `Add to ${wish.toLowerCase()}` }}
      href={(id) => `${MODES[kind].base}/${id}`}
      poster={() => e && <Poster film={asFilm(e.item)} size="side" className="w-16" layout={false} />}
      onSave={async () => {
        if (!e) return;
        try {
          await mediaApi.patch(e.item.id, { shelf: "wishlist" });
          qc.invalidateQueries({ queryKey: ["media", kind] });
          toast({ text: <>Added <em>{e.item.title}</em> to your {wish.toLowerCase()}</> });
        } catch (err) {
          toast({ text: err instanceof Error ? err.message : "Couldn't save" });
        }
      }}
    />
  );
}
