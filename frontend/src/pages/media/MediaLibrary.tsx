import { AnimatePresence, motion } from "framer-motion";
import { useId, useMemo, useState } from "react";
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
import { asFilm, fraction, itemPath, MediaCard, Meter, pagePad, progressText, wallGrid } from "./parts";
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

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The tick button and the progress ring in one: a segmented HUD track, a neon arc for how much you've watched,
 * a check in the middle. The glow is an SVG filter with room to spread, so it never stops at the svg's box.
 */
function NeonRing({ value, label, busy, onClick }: { value: number; label: string; busy: boolean; onClick: () => void }) {
  const id = useId().replace(/:/g, "");
  const size = 56, r = 23, c = 2 * Math.PI * r;
  return (
    <button
      type="button" aria-label={label} title="Mark watched" disabled={busy} onClick={onClick}
      className="group relative size-14 shrink-0 grid place-items-center rounded-full bg-transparent border-0 p-0 cursor-pointer disabled:cursor-wait"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="absolute inset-0 -rotate-90 overflow-visible">
        <defs>
          <filter id={`glow-${id}`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <linearGradient id={`arc-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" />
            <stop offset="100%" stopColor="var(--color-wild)" />
          </linearGradient>
        </defs>
        {/* HUD track: 46 short segments */}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth={3} strokeDasharray={`${c / 46 - 1.4} 1.4`} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#arc-${id})`} strokeWidth={3} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(value, 0.015))} filter={`url(#glow-${id})`}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <span
        className={cx(
          "relative size-9 rounded-full grid place-items-center border transition-[background-color,color,box-shadow] duration-200",
          "border-[color-mix(in_oklch,var(--color-accent)_45%,transparent)] bg-[color-mix(in_oklch,var(--color-accent)_10%,transparent)] text-accent",
          "group-hover:bg-accent group-hover:text-on-accent group-hover:shadow-[0_0_18px_-2px_var(--color-accent)] group-focus-visible:bg-accent group-focus-visible:text-on-accent",
          busy && "animate-pulse",
        )}
      >
        <IconCheck size={16} strokeWidth={2.4} />
      </span>
    </button>
  );
}

/** Shows: the next aired episode of everything you're watching, ticked off right here. */
function UpNextRail() {
  const up = useUpNext(true);
  const tick = useMediaMut((u: UpNext) => mediaApi.episodes(u.item.id, { episode_ids: [u.episode.id], watched: true }));
  const toast = useToast();
  const [pulse, setPulse] = useState<{ id: number; k: number } | null>(null);
  if (!up.data?.length) return null;
  return (
    <section className="flex flex-col gap-4" aria-label="Up next">
      <SectionTitle>Up next</SectionTitle>
      <div className="flex gap-4 overflow-x-auto scroll-quiet py-2 -my-2 px-1 -mx-1">
        {up.data.map((u) => {
          const code = `S${pad(u.episode.season)} · E${pad(u.episode.number)}`;
          const f = fraction("show", u.progress) ?? 0;
          const glow = u.item.palette[0] ?? "var(--color-accent)";
          return (
            <div
              key={u.item.id}
              className="group/card relative shrink-0 w-[372px] max-[639px]:w-[312px] flex items-center gap-4 py-[14px] pl-[14px] pr-[12px] rounded-[18px] overflow-hidden border border-(--line-2) bg-(--fill-glass) backdrop-blur-[24px] transition-[border-color,box-shadow] duration-300 hover:border-[color-mix(in_oklch,var(--color-accent)_45%,transparent)] hover:shadow-[0_0_0_1px_color-mix(in_oklch,var(--color-accent)_18%,transparent),0_18px_44px_-22px_var(--color-accent)]"
            >
              {/* neon edge, the show's own colour behind its poster, scanlines and HUD corner brackets */}
              <span aria-hidden className="absolute inset-x-[18px] top-0 h-px bg-[linear-gradient(90deg,transparent,var(--color-accent)_30%,var(--color-wild)_70%,transparent)] opacity-60 group-hover/card:opacity-100 transition-opacity" />
              <span aria-hidden className="absolute -left-10 -top-10 size-[150px] rounded-full pointer-events-none opacity-50" style={{ background: `radial-gradient(closest-side, color-mix(in oklch, ${glow} 55%, transparent), transparent)` }} />
              <span aria-hidden className="absolute inset-0 pointer-events-none opacity-[0.35] bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.035)_0_1px,transparent_1px_3px)]" />
              <span aria-hidden className="absolute right-[8px] top-[8px] size-[10px] border-t border-r border-[color-mix(in_oklch,var(--color-accent)_55%,transparent)] rounded-tr-[3px]" />
              <span aria-hidden className="absolute left-[8px] bottom-[8px] size-[10px] border-b border-l border-[color-mix(in_oklch,var(--color-wild)_45%,transparent)] rounded-bl-[3px]" />

              <Link to={itemPath(u.item)} className="mini-poster relative shrink-0" aria-label={u.item.title}>
                <Poster film={asFilm(u.item)} size="rec" className="w-[62px] rounded-[10px]" layout={false} shadow={`0 12px 28px -14px ${glow}`} />
              </Link>
              <div className="relative flex-1 min-w-0 flex flex-col gap-[7px]">
                <Link to={itemPath(u.item)} className="text-[15px] font-medium leading-[1.2] truncate no-underline">{u.item.title}</Link>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="shrink-0 font-mono text-[11px] tracking-[0.14em] px-[6px] py-[2px] rounded-[4px] text-accent border border-[color-mix(in_oklch,var(--color-accent)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-accent)_10%,transparent)] shadow-[0_0_10px_-4px_var(--color-accent)]">
                    {code}
                  </span>
                  <span className="text-[13px] text-ink-3 truncate">{u.episode.title ?? "Untitled episode"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="relative flex-1 h-[3px] rounded-full bg-white/8 overflow-hidden">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,var(--color-accent),var(--color-wild))] transition-[width] duration-700 ease-out" style={{ width: `${Math.round(f * 100)}%` }} />
                  </span>
                  <span className="shrink-0 font-mono text-[10.5px] tracking-[0.06em] text-ink-4 tabular-nums">{u.progress.watched}/{u.progress.aired} · {Math.round(f * 100)}%</span>
                </div>
              </div>
              <div className="relative">
                <NeonRing
                  value={f}
                  label={`Mark ${u.item.title} ${code} watched`}
                  busy={tick.isPending && tick.variables?.item.id === u.item.id}
                  onClick={async () => {
                    await tick.mutateAsync(u);
                    setPulse({ id: u.item.id, k: Date.now() });
                    toast({ text: <>Watched <em>{u.item.title}</em> {code}</> });
                  }}
                />
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
  const items = lib.data?.items ?? [];
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
  const filtered = genre.length > 0;

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
            <Button onClick={() => update("genre", [])}>Clear filters</Button>
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
