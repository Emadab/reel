import { AnimatePresence } from "framer-motion";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { LibraryParams } from "../api/client";
import { useFacets, useLibrary } from "../api/hooks";
import type { CardWithWatch, FilmCard } from "../api/types";
import { FilterChip } from "../components/FilterChip";
import { alpha, useAmbientGlow } from "../components/Glow";
import { IconCheck, IconPlus } from "../components/Icons";
import { QuickLog } from "../components/QuickLog";
import { Poster, posterBg } from "../components/Poster";
import { Button, PageHeader, PillTab, Segmented, cx } from "../components/ui";
import { usePalette } from "../features/search/palette";
import { lightest } from "../lib/color";
import { formatLongDate, formatWatchDate, num, rating, runtime } from "../lib/format";

const Carousel3D = lazy(() => import("../components/Carousel3D"));

type Tab = NonNullable<LibraryParams["tab"]>;
type Sort = NonNullable<LibraryParams["sort"]>;
const SORTS: { value: Sort; label: string }[] = [
  { value: "recent", label: "recently watched" },
  { value: "rating", label: "my rating" },
  { value: "year", label: "release year" },
  { value: "title", label: "title" },
  { value: "runtime", label: "runtime" },
];
const RATINGS = ["9", "8", "7", "6", "5", "4"];

function chipLabel(name: string, values: string[], fmt: (v: string) => string = (v) => v) {
  if (!values.length) return name;
  return values.length === 1 ? `${name}: ${fmt(values[0])}` : `${name} · ${values.length}`;
}

function LastWatched({ film }: { film: CardWithWatch }) {
  const glow = film.palette[0] ?? posterBg(film);
  const light = lightest(film.palette, film.poster_art.fg);
  const w = film.watch;
  const where = w.location ? (/^home$/i.test(w.location) ? "at home" : w.location) : null;
  return (
    <Link
      to={`/film/${film.tmdb_id}`}
      aria-label={`Last watched: ${film.title}`}
      className="relative flex flex-wrap items-center gap-7 p-[22px] rounded-[22px] bg-(--fill-glass) border border-(--line-2) backdrop-blur-[24px] overflow-hidden no-underline text-ink hover:text-ink"
    >
      <div aria-hidden className="absolute left-[-80px] top-[-120px] w-[520px] h-[380px] pointer-events-none" style={{ background: `radial-gradient(closest-side, ${alpha(glow, 0.55)}, ${alpha(glow, 0)})` }} />
      <Poster film={film} size="last" className="w-24" shadow={`0 18px 40px -16px ${alpha(posterBg(film), 0.9)}`} />
      <div className="relative flex-[1_1_280px] flex flex-col gap-2 min-w-0">
        <span className="font-mono text-[12px] tracking-[0.08em] uppercase" style={{ color: `color-mix(in oklch, ${light} 62%, ${glow})` }}>
          LAST WATCHED · {formatLongDate(w.watched_on, w.date_precision)}
        </span>
        <h2 className="m-0 font-display font-semibold text-[28px]">{film.title}</h2>
        <p className="m-0 text-[14px] text-ink-3">
          {[film.director, film.year, runtime(film.runtime), where].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="relative flex flex-col items-end gap-3 max-[639px]:items-start">
        {w.rating != null && <span className="font-mono text-[26px]" style={{ color: light }}>★ {rating(w.rating)}</span>}
      </div>
    </Link>
  );
}

export function WallCard({ film, tab }: { film: FilmCard; tab: Tab }) {
  const [quick, setQuick] = useState(false);
  const watched = film.watch_count > 0;
  const sub =
    tab === "watchlist"
      ? film.added_at ? `Added ${formatWatchDate(film.added_at.slice(0, 10), "day")}` : "On your watchlist"
      : [film.director, film.last_watched && formatWatchDate(film.last_watched.date, film.last_watched.precision)].filter(Boolean).join(" · ");
  return (
    <div className="quick-card relative flex flex-col gap-[10px] min-w-0">
      <Link to={`/film/${film.tmdb_id}`} className="poster-card flex flex-col gap-[10px] no-underline text-inherit hover:text-inherit min-w-0">
        <Poster film={film} size="wall" />
        <div className="flex justify-between items-baseline gap-2">
          <span className="text-[14px] font-medium truncate">{film.title}</span>
          {tab !== "watchlist" && film.my_rating != null && <span className="font-mono text-[12px] text-ink-star shrink-0">★ {rating(film.my_rating)}</span>}
        </div>
        <span className="mt-[-6px] text-[12px] text-ink-4 truncate">{sub}</span>
      </Link>
      {/* quick log (design extension): sits over the poster, outside the link */}
      <div className="absolute inset-x-0 top-0 aspect-[2/3] pointer-events-none rounded-[12px] overflow-hidden">
        {!quick && (
          <button
            type="button"
            aria-label={watched ? `Log a rewatch of ${film.title}` : `Mark ${film.title} watched`}
            title={watched ? "Log a rewatch" : "Mark watched"}
            onClick={() => setQuick(true)}
            className="quick-btn pointer-events-auto absolute right-2 top-2 size-9 rounded-full grid place-items-center border border-[rgba(255,255,255,0.22)] bg-[rgba(7,8,12,0.62)] backdrop-blur-[10px] text-ink-hi cursor-pointer shadow-[0_6px_18px_-6px_rgba(0,0,0,0.8)] hover:bg-accent hover:text-on-accent hover:border-accent"
          >
            {watched ? <IconPlus size={16} /> : <IconCheck size={17} />}
          </button>
        )}
        <AnimatePresence>
          {quick && (
            <div className="pointer-events-auto">
              <QuickLog film={film} onClose={() => setQuick(false)} />
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

const grid = "grid grid-cols-[repeat(auto-fill,minmax(min(150px,100%),1fr))] gap-x-5 gap-y-8 max-[639px]:grid-cols-2 max-[639px]:gap-x-3 max-[639px]:gap-y-5";

export function Library() {
  const [sp, setSp] = useSearchParams();
  const { openPalette } = usePalette();
  const params: LibraryParams = useMemo(
    () => ({
      tab: (sp.get("tab") as Tab) || "watched",
      genre: sp.getAll("genre"),
      decade: sp.getAll("decade").map(Number),
      min_rating: sp.get("min_rating") ? Number(sp.get("min_rating")) : null,
      director: sp.get("director"),
      sort: (sp.get("sort") as Sort) || "recent",
    }),
    [sp],
  );
  const view = sp.get("view") === "carousel" ? "carousel" : "grid";
  const lib = useLibrary(params);
  const facets = useFacets();
  const first = lib.data?.pages[0];
  const items = useMemo(() => lib.data?.pages.flatMap((p) => p.items) ?? [], [lib.data]);
  useAmbientGlow(first?.last_watched?.palette[0] ?? (first?.last_watched ? posterBg(first.last_watched) : null));

  const update = (k: string, values: string[]) => {
    const next = new URLSearchParams(sp);
    next.delete(k);
    values.forEach((v) => next.append(k, v));
    setSp(next, { replace: true });
  };

  // the carousel shows up to 72 posters (three rings): load enough pages to fill them
  useEffect(() => {
    if (view === "carousel" && items.length < 72 && lib.hasNextPage && !lib.isFetchingNextPage) void lib.fetchNextPage();
  }, [view, items.length, lib]);

  // infinite scroll
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || view !== "grid") return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && lib.hasNextPage && !lib.isFetchingNextPage && lib.fetchNextPage(), { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [lib, view]);

  const t = first?.totals;
  const tab = params.tab!;
  const filtered = !!(params.genre?.length || params.decade?.length || params.min_rating || params.director);
  const sortLabel = SORTS.find((s) => s.value === params.sort)?.label ?? "recently watched";

  return (
    <main className="flex flex-col gap-8 pt-9 px-12 pb-16 max-[1023px]:pt-7 max-[1023px]:px-6 max-[639px]:pt-5 max-[639px]:px-4 max-[639px]:pb-24 box-border min-w-0">
      <PageHeader title="Library" subline={t ? `${num(t.films)} films · ${num(t.watches)} watches · ${num(t.hours)} hours` : " "}>
        <Segmented
          label="View"
          value={view}
          onChange={(v) => update("view", v === "carousel" ? ["carousel"] : [])}
          options={[{ id: "grid", label: "Poster wall" }, { id: "carousel", label: "3D carousel" }]}
        />
        <Button variant="primary" onClick={() => openPalette()}>
          <IconPlus size={16} />
          Log a watch
        </Button>
      </PageHeader>

      {first?.last_watched && <LastWatched film={first.last_watched} />}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div role="tablist" aria-label="Collection" className="flex flex-wrap gap-[6px]">
          {(["watched", "watchlist", "rewatches"] as Tab[]).map((id) => (
            <PillTab key={id} on={tab === id} label={id[0].toUpperCase() + id.slice(1)} count={first?.counts[id]} onClick={() => update("tab", id === "watched" ? [] : [id])} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip label={chipLabel("Genre", params.genre ?? [])} multi options={(facets.data?.genres ?? []).map((g) => ({ value: g, label: g }))} selected={params.genre ?? []} onChange={(v) => update("genre", v)} />
          <FilterChip
            label={chipLabel("Decade", (params.decade ?? []).map(String), (d) => `${d}s`)}
            multi
            options={(facets.data?.decades ?? []).map((d) => ({ value: String(d), label: `${d}s` }))}
            selected={(params.decade ?? []).map(String)}
            onChange={(v) => update("decade", v)}
          />
          <FilterChip
            label={params.min_rating ? `Rating: ${rating(params.min_rating)}+` : "Rating"}
            options={RATINGS.map((r) => ({ value: r, label: `★ ${r} and up` }))}
            selected={params.min_rating ? [String(params.min_rating)] : []}
            onChange={(v) => update("min_rating", v)}
          />
          <FilterChip
            label={params.director ? `Director: ${params.director}` : "Director"}
            searchable
            options={(facets.data?.directors ?? []).map((d) => ({ value: d, label: d }))}
            selected={params.director ? [params.director] : []}
            onChange={(v) => update("director", v)}
          />
          <FilterChip
            label={`Sort: ${sortLabel}`}
            align="right"
            options={SORTS}
            selected={[params.sort!]}
            onChange={(v) => update("sort", v[0] && v[0] !== "recent" ? [v[0]] : [])}
          />
        </div>
      </div>

      {lib.isLoading ? (
        <div className={grid} aria-busy>
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="flex flex-col gap-[10px]">
              <div className="skeleton aspect-[2/3] rounded-[12px]" />
              <div className="skeleton h-[14px] rounded-[4px] w-3/4" />
            </div>
          ))}
        </div>
      ) : lib.isError ? (
        <p className="m-0 font-mono text-[13px] text-wild">{(lib.error as Error).message}</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-5 py-20 text-center">
          <p className="m-0 font-mono text-[13px] text-ink-3b">
            {filtered
              ? "No films match these filters."
              : tab === "watchlist"
                ? "Your watchlist is empty. Press Shift ↵ on a search result to add one."
                : tab === "rewatches"
                  ? "Nothing rewatched yet."
                  : "Nothing here yet. Press Ctrl K to log your first film."}
          </p>
          {filtered ? (
            <Button onClick={() => setSp(new URLSearchParams(tab === "watched" ? {} : { tab }), { replace: true })}>Clear filters</Button>
          ) : (
            <Button variant="primary" onClick={() => openPalette()}>
              <IconPlus size={16} />
              Log a watch
            </Button>
          )}
        </div>
      ) : view === "carousel" ? (
        <Suspense fallback={<div className="skeleton h-[640px] rounded-[22px]" />}>
          <Carousel3D films={items} />
        </Suspense>
      ) : (
        <div className={cx(grid, lib.isPlaceholderData && "opacity-60 transition-opacity")}>
          {items.map((f) => (
            <WallCard key={f.tmdb_id} film={f} tab={tab} />
          ))}
        </div>
      )}
      {lib.hasNextPage && <div ref={sentinel} aria-hidden className="h-px" />}
    </main>
  );
}
