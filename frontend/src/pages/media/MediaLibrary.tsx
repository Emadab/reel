import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Link, useSearchParams } from "react-router";
import { mediaApi, useMediaLibrary, useMediaMut, useUpNext, type ItemCard, type Kind, type MediaSort, type UpNext } from "../../api/media";
import { FilterChip } from "../../components/FilterChip";
import { useAmbientGlow } from "../../components/Glow";
import { IconCheck, IconPlus } from "../../components/Icons";
import { Poster, posterBg } from "../../components/Poster";
import { useToast } from "../../components/Toasts";
import { Button, ButtonLink, PageHeader, PillTab, SectionTitle, cx } from "../../components/ui";
import { usePalette } from "../../features/search/palette";
import { num } from "../../lib/format";
import { MODES, SHELF_LABEL, START, TABS } from "../../lib/mode";
import type { MenuAt } from "../../components/ContextMenu";
import { asFilm, fraction, itemPath, MediaCard, MediaCardMenu, Meter, pagePad, progressText, wallGrid } from "./parts";
import { BacklogPlanner } from "./BacklogPlanner";

const WATCHED: Record<Kind, string> = { show: "last watched", book: "last read", game: "last played" };
const sorts = (kind: Kind): { value: MediaSort; label: string }[] => [
  { value: "recent", label: "recent activity" },
  { value: "watched", label: WATCHED[kind] },
  { value: "rating", label: "my rating" },
  { value: "year", label: "release year" },
  { value: "title", label: "title" },
];

function chipLabel(name: string, values: string[]) {
  if (!values.length) return name;
  return values.length === 1 ? `${name}: ${values[0]}` : `${name} · ${values.length}`;
}

/**
 * A strip's own scrollbar (design extension), in the window scrollbar's vocabulary: a slim neon pill on a hairline
 * track that wakes while you scroll or hover, widens under the pointer, drags, and glides to a clicked spot.
 */
function StripScrollbar({ strip, count }: { strip: RefObject<HTMLDivElement | null>; count: number }) {
  const track = useRef<HTMLDivElement>(null);
  const [m, setM] = useState({ left: 0, size: 0, fits: true });
  const [awake, setAwake] = useState(false);
  const [drag, setDrag] = useState<{ x: number; scroll: number } | null>(null);
  const sleep = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const w = track.current?.clientWidth ?? 0;
      const range = el.scrollWidth - el.clientWidth;
      const size = Math.max(56, (el.clientWidth / el.scrollWidth) * w);
      setM({ left: range > 0 ? (el.scrollLeft / range) * (w - size) : 0, size, fits: range <= 1 });
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(measure);
    };
    const onScroll = () => {
      schedule();
      setAwake(true);
      clearTimeout(sleep.current);
      sleep.current = setTimeout(() => setAwake(false), 1100);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(sleep.current);
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [strip, count]);

  if (m.fits) return null;
  const el = () => strip.current!;
  const room = () => (track.current?.clientWidth ?? 1) - m.size;
  const range = () => el().scrollWidth - el().clientWidth;
  const active = drag != null;
  return (
    <div
      ref={track}
      aria-hidden
      className="group/bar relative h-[14px] flex items-center cursor-pointer"
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        // click the track: glide so the thumb centres on the pointer
        const x = e.clientX - e.currentTarget.getBoundingClientRect().left - m.size / 2;
        el().scrollTo({ left: (x / room()) * range(), behavior: "smooth" });
      }}
    >
      <div className={cx("absolute inset-x-0 h-px rounded-full bg-white/8 pointer-events-none transition-opacity duration-300", awake || active ? "opacity-100" : "opacity-60 group-hover/bar:opacity-100")} />
      <div
        className={cx(
          "absolute left-0 rounded-full cursor-default transition-[height,opacity,box-shadow] duration-200 ease-[cubic-bezier(.2,.7,.2,1)]",
          "bg-[linear-gradient(90deg,var(--color-accent),var(--color-wild))]",
          active || awake ? "h-[5px] opacity-100" : "h-[3px] opacity-55 group-hover/bar:h-[5px] group-hover/bar:opacity-90",
          active && "shadow-[0_0_14px_color-mix(in_oklch,var(--color-accent)_70%,transparent)]",
        )}
        style={{ width: m.size, transform: `translateX(${m.left}px)` }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag({ x: e.clientX, scroll: el().scrollLeft });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          el().scrollLeft = drag.scroll + ((e.clientX - drag.x) / room()) * range();
        }}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
      />
    </div>
  );
}

/** Shows: the next aired episode of everything you're watching, ticked off right here. */
function UpNextRail() {
  const strip = useRef<HTMLDivElement>(null);
  const up = useUpNext(true);
  const tick = useMediaMut((u: UpNext) => mediaApi.episodes(u.item.id, { episode_ids: [u.episode.id], watched: true }));
  const toast = useToast();
  const [pulse, setPulse] = useState<{ id: number; k: number } | null>(null);
  const [menu, setMenu] = useState<{ u: UpNext; at: MenuAt } | null>(null);
  const markNext = async (u: UpNext) => {
    const code = `S${u.episode.season} · E${u.episode.number}`;
    await tick.mutateAsync(u);
    setPulse({ id: u.item.id, k: Date.now() });
    toast({ text: <>Watched <em>{u.item.title}</em> {code}</> });
  };
  if (!up.data?.length) return null;
  return (
    <section className="flex flex-col gap-4" aria-label="Up next">
      <SectionTitle>Up next</SectionTitle>
      <div ref={strip} className="flex gap-4 overflow-x-auto [scrollbar-width:none] pt-[18px] pb-[34px] -mt-[18px] -mb-[34px] px-[20px] -mx-[20px] select-none">
        {up.data.map((u) => {
          const code = `S${u.episode.season} · E${u.episode.number}`;
          const f = fraction("show", u.progress) ?? 0;
          const glow = u.item.palette[0] ?? "var(--color-accent)";
          return (
            <div
              key={u.item.id}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ u, at: { x: e.clientX, y: e.clientY } });
              }}
              className="group/card relative shrink-0 w-[400px] max-[639px]:w-[318px] flex items-center gap-4 py-[14px] pl-[14px] pr-[12px] rounded-[16px] border border-(--line-3) bg-[linear-gradient(160deg,rgba(255,255,255,0.045),rgba(255,255,255,0.015))] transition-[border-color,box-shadow,translate] duration-300 hover:-translate-y-[2px] hover:border-[color-mix(in_oklch,var(--color-accent)_60%,transparent)] hover:shadow-[0_0_0_1px_color-mix(in_oklch,var(--color-accent)_22%,transparent),0_14px_30px_-18px_var(--color-accent)]"
            >
              {/* a crisp neon top edge */}
              <span aria-hidden className="absolute inset-x-[22px] -top-px h-px bg-[linear-gradient(90deg,transparent,var(--color-accent)_25%,var(--color-wild)_75%,transparent)] opacity-70 group-hover/card:opacity-100 transition-opacity" />

              <Link to={itemPath(u.item)} className="mini-poster relative shrink-0" aria-label={u.item.title} draggable={false}>
                {/* the show's own colour spills from its poster, unclipped */}
                <Poster film={asFilm(u.item)} size="rec" className="w-[64px] rounded-[8px]" layout={false} shadow={`0 0 0 1px rgba(255,255,255,0.08), 0 10px 30px -10px ${glow}, 0 0 22px -8px ${glow}`} />
              </Link>
              <div className="relative flex-1 min-w-0 flex flex-col gap-[6px]">
                <Link to={itemPath(u.item)} draggable={false} className="text-[15px] font-semibold leading-[1.2] tracking-[-0.005em] truncate no-underline">{u.item.title}</Link>
                <span className="font-mono text-[12px] tracking-[0.06em] text-accent">{code}</span>
                <span className="text-[13.5px] leading-[1.35] text-ink-2 line-clamp-2">{u.episode.title ?? "Untitled episode"}</span>
                <div className="flex items-center gap-[10px] mt-[2px]">
                  <span className="relative flex-1 h-[3px] rounded-full bg-white/10 overflow-hidden">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,var(--color-accent),var(--color-wild))] shadow-[0_0_8px_var(--color-accent)] transition-[width] duration-700 ease-out" style={{ width: `${Math.max(Math.round(f * 100), 1)}%` }} />
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tracking-[0.04em] text-ink-4 tabular-nums">{u.progress.watched}/{u.progress.aired}</span>
                </div>
              </div>
              <div className="relative">
                <button
                  type="button"
                  aria-label={`Mark ${u.item.title} ${code} watched`}
                  title="Mark watched"
                  disabled={tick.isPending && tick.variables?.item.id === u.item.id}
                  onClick={() => void markNext(u)}
                  className="size-11 shrink-0 rounded-full grid place-items-center border border-[color-mix(in_oklch,var(--color-accent)_55%,transparent)] bg-[color-mix(in_oklch,var(--color-accent)_12%,transparent)] text-accent cursor-pointer transition-[background-color,color,box-shadow] duration-200 hover:bg-accent hover:text-on-accent hover:shadow-[0_0_18px_-2px_var(--color-accent)] disabled:cursor-wait disabled:animate-pulse"
                >
                  <IconCheck size={17} />
                </button>
                <AnimatePresence>
                  {pulse?.id === u.item.id && (
                    <motion.span
                      key={pulse.k}
                      aria-hidden
                      initial={{ scale: 0.7, opacity: 0.9 }}
                      animate={{ scale: 1.9, opacity: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.7, ease: "easeOut" }}
                      onAnimationComplete={() => setPulse(null)}
                      className="absolute inset-0 rounded-full border-2 border-accent pointer-events-none"
                    />
                  )}
                </AnimatePresence>
              </div>
            </div>
          );
        })}
      </div>
      <StripScrollbar strip={strip} count={up.data.length} />
      {menu && (
        <MediaCardMenu
          item={menu.u.item}
          at={menu.at}
          onClose={() => setMenu(null)}
          extra={[{ label: `Mark S${menu.u.episode.season} · E${menu.u.episode.number} watched`, onSelect: () => void markNext(menu.u) }]}
        />
      )}
    </section>
  );
}

/** Books and games: what you're in the middle of, with its progress. */
function InProgressStrip({ kind, items }: { kind: Kind; items: ItemCard[] }) {
  const now = items.filter((i) => i.status === START[kind].status || i.status === "dipping");
  if (!now.length) return null;
  return (
    <section className="flex flex-col gap-4" aria-label={kind === "book" ? "Currently reading" : "Now playing"}>
      <SectionTitle>{kind === "book" ? "Currently reading" : "Now playing"}</SectionTitle>
      <div className="flex gap-4 overflow-x-auto scroll-quiet pb-2 -mb-2">
        {now.map((i) => {
          const f = fraction(kind, i.progress);
          return (
            <Link key={i.id} to={itemPath(i)} className="mini-poster shrink-0 w-[320px] flex items-center gap-4 p-[14px] rounded-[22px] bg-(--fill-glass) border border-(--line-2) backdrop-blur-[24px] no-underline text-ink hover:text-ink hover:border-(--line-4)">
              <Poster film={asFilm(i)} size="rec" className="w-[64px]" layout={false} shadow={false} />
              <div className="flex-1 min-w-0 flex flex-col gap-[8px]">
                <span className="text-[15px] font-medium truncate">{i.title}</span>
                <span className="text-[13px] text-ink-3 truncate">{i.subtitle ?? " "}</span>
                {f != null && <Meter value={f} />}
                <span className="font-mono text-[12px] text-ink-4">{progressText(kind, i.progress) ?? "no progress logged yet"}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export default function MediaLibrary({ kind }: { kind: Kind }) {
  const [sp, setSp] = useSearchParams();
  const { openPalette } = usePalette();
  const tabs = TABS[kind];
  const tab = tabs.find((t) => t.id === sp.get("tab")) ?? null;
  const genre = sp.getAll("genre");
  const sort = (sp.get("sort") as MediaSort) || "recent";
  const all = useMediaLibrary(kind, { sort });
  const lib = useMediaLibrary(kind, { status: tab?.statuses, genre, sort });
  // games: played (any run, whatever its status or percentage) or not, on top of the tabs
  const played = kind === "game" ? sp.get("played") : null;
  const items = (lib.data?.items ?? []).filter((i) => !played || (played === "yes") === i.run_no > 0);
  const everything = all.data?.items ?? [];
  const counts = all.data?.counts ?? {};
  const first = tab ?? null;
  useAmbientGlow(everything[0]?.palette[0] ?? (everything[0] ? posterBg(asFilm(everything[0])) : null));

  const update = (k: string, values: string[]) => {
    const next = new URLSearchParams(sp);
    next.delete(k);
    values.forEach((v) => next.append(k, v));
    setSp(next, { replace: true });
  };

  const subline = useMemo(() => {
    const n = counts.all ?? 0;
    const [one, many] = MODES[kind].noun;
    const parts = [`${num(n)} ${n === 1 ? one : many}`];
    if (kind === "show") parts.push(`${num(everything.reduce((a, i) => a + (i.progress.watched ?? 0), 0))} episodes watched`);
    if (kind === "book") parts.push(`${num(counts.finished ?? 0)} finished`);
    if (kind === "game") parts.push(`${num(Math.round(everything.reduce((a, i) => a + (i.progress.hours ?? 0), 0)))} hours played`);
    return parts.join(" · ");
  }, [counts, everything, kind]);

  const SORTS = sorts(kind);
  const sortLabel = SORTS.find((s) => s.value === sort)?.label ?? SORTS[0].label;
  const filtered = genre.length > 0 || !!played;
  const nPlayed = everything.filter((i) => i.run_no > 0).length;

  return (
    <main className={cx("flex flex-col gap-8 pt-9 pb-16 max-[1023px]:pt-7 max-[639px]:pt-5 max-[639px]:pb-24 box-border min-w-0", pagePad)}>
      <PageHeader title={MODES[kind].label} subline={all.data ? subline : " "}>
        {kind !== "game" && <ButtonLink to={`${MODES[kind].base}/import`}>Import</ButtonLink>}
        <Button variant="primary" onClick={() => openPalette()}>
          <IconPlus size={16} />
          {MODES[kind].add}
        </Button>
      </PageHeader>

      {kind === "show" ? <UpNextRail /> : <InProgressStrip kind={kind} items={everything} />}
      {kind !== "show" && <BacklogPlanner kind={kind} />}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div role="tablist" aria-label="Collection" className="flex flex-wrap gap-[6px]">
          <PillTab on={!first} label="All" count={counts.all} onClick={() => update("tab", [])} />
          {tabs.map((t) => (
            <PillTab key={t.id} on={first?.id === t.id} label={t.label} count={t.statuses.reduce((a, s) => a + (counts[s] ?? 0), 0)} onClick={() => update("tab", [t.id])} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {kind === "game" && (
            <FilterChip
              label={played === "yes" ? "Played" : played === "no" ? "Not played" : "Played or not"}
              options={[{ value: "yes", label: `Played (${nPlayed})` }, { value: "no", label: `Not played (${everything.length - nPlayed})` }]}
              selected={played ? [played] : []} onChange={(v) => update("played", v)}
            />
          )}
          <FilterChip label={chipLabel("Genre", genre)} multi options={(all.data?.genres ?? []).map((g) => ({ value: g, label: g }))} selected={genre} onChange={(v) => update("genre", v)} />
          <FilterChip label={`Sort: ${sortLabel}`} align="right" options={SORTS} selected={[sort]} onChange={(v) => update("sort", v[0] && v[0] !== "recent" ? [v[0]] : [])} />
        </div>
      </div>

      {lib.isLoading ? (
        <div className={wallGrid} aria-busy>
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
              ? `No ${MODES[kind].noun[1]} match these filters.`
              : first
                ? `Nothing in ${first.label.toLowerCase()} yet. Press Shift ↵ on a search result to add to ${SHELF_LABEL[kind].wishlist.toLowerCase()}.`
                : `Nothing here yet. Press Ctrl K to find your first ${MODES[kind].noun[0]}.`}
          </p>
          {filtered ? (
            <Button onClick={() => { const next = new URLSearchParams(sp); next.delete("genre"); next.delete("played"); setSp(next, { replace: true }); }}>Clear filters</Button>
          ) : (
            <Button variant="primary" onClick={() => openPalette()}>
              <IconPlus size={16} />
              {MODES[kind].add}
            </Button>
          )}
        </div>
      ) : (
        <div className={cx(wallGrid, lib.isPlaceholderData && "opacity-60 transition-opacity")}>
          {items.map((i) => <MediaCard key={i.id} item={i} />)}
        </div>
      )}
    </main>
  );
}
