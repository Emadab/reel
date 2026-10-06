import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { api } from "../api/client";
import { useDeleteAllWatches, useMovie, useRefreshMovie, useWatchlistToggle } from "../api/hooks";
import type { MovieDetail, Neighbor, WatchOut } from "../api/types";
import { CastPhoto } from "../components/CastPhoto";
import { Dialog } from "../components/Dialog";
import { mix } from "../components/Glow";
import { IconChevronLeft, IconClose, IconMore, IconPlay, IconPlus } from "../components/Icons";
import { Poster, posterBg } from "../components/Poster";
import { useToast } from "../components/Toasts";
import { ErrorLine, Eyebrow, MonoTag, SectionTitle, TagChip, cx } from "../components/ui";
import { usePalette } from "../features/search/palette";
import { onColor } from "../lib/color";
import { formatFullDate, formatWatchDate, language, pct, rating, relativeTime, runtime } from "../lib/format";
import { backTarget } from "../lib/history";

const PRECISION = { day: "exact day", month: "month only", year: "year only", unknown: "date unknown" } as const;

function MoreMenu({ film }: { film: MovieDetail }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const wl = useWatchlistToggle();
  const refresh = useRefreshMovie();
  const delAll = useDeleteAllWatches();
  const toast = useToast();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  useEffect(() => setConfirm(false), [open]);
  const item = "w-full h-11 flex items-center px-3 rounded-[10px] bg-transparent hover:bg-(--fill-ctl) border-0 text-[14px] text-left cursor-pointer text-ink no-underline hover:text-ink";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="size-[46px] grid place-items-center rounded-[14px] bg-white/8 border border-(--line-5) text-ink cursor-pointer backdrop-blur-[16px] hover:bg-white/10"
      >
        <IconMore size={18} />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-[calc(100%+8px)] z-30 w-[260px] p-2 rounded-[16px] bg-[rgba(20,22,30,0.92)] border border-(--line-4) backdrop-blur-[24px] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.8)]">
          <button role="menuitem" type="button" className={item} onClick={() => { wl.mutate({ id: film.tmdb_id, on: !film.on_watchlist }); setOpen(false); }}>
            {film.on_watchlist ? "Remove from watchlist" : "Add to watchlist"}
          </button>
          <button
            role="menuitem" type="button" className={item} disabled={refresh.isPending}
            onClick={async () => {
              await refresh.mutateAsync(film.tmdb_id);
              setOpen(false);
              toast({ text: "Data refreshed from TMDB" });
            }}
          >
            {refresh.isPending ? "Refreshing…" : "Refresh data"}
          </button>
          <a role="menuitem" className={item} href={`https://www.themoviedb.org/movie/${film.tmdb_id}`} target="_blank" rel="noreferrer">Open on TMDB</a>
          {film.imdb_id && <a role="menuitem" className={item} href={`https://www.imdb.com/title/${film.imdb_id}/`} target="_blank" rel="noreferrer">Open on IMDb</a>}
          {film.watch_count > 0 &&
            (confirm ? (
              <div className="flex items-center gap-2 px-3 h-11 text-[13px]">
                Delete {film.watch_count} watch{film.watch_count > 1 ? "es" : ""}?
                <button type="button" className="ml-auto h-11 px-1 bg-transparent border-0 text-wild font-medium cursor-pointer" onClick={async () => { await delAll.mutateAsync(film.tmdb_id); setOpen(false); toast({ text: "All your watches of this film were deleted" }); }}>
                  Delete
                </button>
              </div>
            ) : (
              <button role="menuitem" type="button" className={cx(item, "text-wild hover:text-wild")} onClick={() => setConfirm(true)}>
                Delete all my watches…
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function TrailerModal({ open, onClose, film }: { open: boolean; onClose: () => void; film: MovieDetail }) {
  return (
    <Dialog open={open} onClose={onClose} label={`${film.title} trailer`} top={96} className="w-[calc(100%-32px)] max-w-[1100px]">
      <div className="relative aspect-video rounded-[20px] overflow-hidden bg-(--color-bg-video) border border-(--line-1) palette-in">
        {film.trailer_key && (
          <iframe
            className="absolute inset-0 size-full border-0"
            src={`https://www.youtube-nocookie.com/embed/${film.trailer_key}?autoplay=1&rel=0`}
            title={`${film.title} trailer`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        )}
        <button type="button" aria-label="Close trailer" onClick={onClose} className="absolute right-3 top-3 size-11 rounded-[12px] grid place-items-center bg-[rgba(7,8,12,0.55)] border border-(--line-4) text-ink cursor-pointer backdrop-blur-[16px]">
          <IconClose />
        </button>
      </div>
    </Dialog>
  );
}

function History({ film, glow, glow2 }: { film: MovieDetail; glow: string; glow2: string }) {
  const { openEdit } = usePalette();
  const dots = [glow, glow2, "#8E95A3"];
  return (
    <section className="p-6 rounded-[22px] bg-(--fill-glass) border border-(--line-2) backdrop-blur-[24px] flex flex-col gap-[22px]">
      <div className="flex justify-between items-baseline">
        <SectionTitle>Your history</SectionTitle>
        <span className="font-mono text-[12px] text-ink-3">{film.watches.length} watch{film.watches.length === 1 ? "" : "es"}</span>
      </div>
      <ol className="list-none m-0 p-0 flex flex-col">
        {film.watches.map((w: WatchOut, i) => {
          const where = [w.location, w.with_whom && `with ${w.with_whom}`].filter(Boolean).join(" · ");
          return (
            <li key={w.id}>
              <button
                type="button"
                aria-label={`Edit watch on ${formatWatchDate(w.watched_on, w.date_precision)}`}
                onClick={() => openEdit(w, film)}
                className="w-full flex gap-4 text-left bg-transparent border-0 p-0 cursor-pointer text-ink rounded-[12px] hover:bg-white/[0.02]"
              >
                <div className="flex flex-col items-center pt-1 self-stretch">
                  <span className="size-3 rounded-full shrink-0" style={{ background: dots[i % 3], boxShadow: `0 0 14px ${dots[i % 3]}` }} />
                  <span className="flex-1 w-px bg-(--line-4) my-[6px]" />
                </div>
                <div className="flex-1 flex flex-col gap-[6px] pb-[22px] min-w-0">
                  <div className="flex justify-between items-baseline gap-[10px]">
                    <span className="text-[15px] font-medium">{formatWatchDate(w.watched_on, w.date_precision)}</span>
                    {w.rating != null && <span className="font-mono text-[14px]" style={{ color: glow }}>★ {rating(w.rating)}</span>}
                  </div>
                  <div className="flex flex-wrap gap-[6px]">
                    <MonoTag>{PRECISION[w.date_precision]}</MonoTag>
                    <MonoTag>{w.is_rewatch ? "rewatch" : "first watch"}</MonoTag>
                  </div>
                  {where && <span className="text-[13px] text-ink-3">{where}</span>}
                  {w.notes && <p className="mt-[2px] mb-0 text-[14px] leading-[1.5] text-ink-body">{w.notes}</p>}
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const money = (n: number | null | undefined) => (n ? `$${compact.format(n)}` : null);

function Crew({ film }: { film: MovieDetail }) {
  const c = film.crew_highlights;
  const roles = [
    ["Directed by", film.director ? [film.director] : []],
    ["Written by", c.writer],
    ["Cinematography", c.cinematography],
    ["Music", c.music],
    ["Editing", c.editing],
    ["Produced by", c.producer],
  ].filter(([, v]) => v?.length) as [string, string[]][];
  if (roles.length < 2) return null;
  return (
    <section data-extension className="flex flex-col gap-4">
      <SectionTitle>Crew</SectionTitle>
      <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(min(190px,100%),1fr))] gap-x-6 gap-y-5">
        {roles.map(([role, names]) => (
          <div key={role} className="flex flex-col gap-[6px] pl-[14px] border-l border-(--line-3)">
            <dt><Eyebrow className="text-[10.5px] text-ink-4">{role}</Eyebrow></dt>
            <dd className="m-0 text-[14px] leading-[1.45]">{names.slice(0, 3).join(", ")}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Four scores, each with a meter on a shared 0–100 scale, plus the awards line. */
function Scores({ film, glow }: { film: MovieDetail; glow: string }) {
  const num = (v: string | null) => (v == null ? null : parseFloat(v));
  const rows: { label: string; value: string | null; of: number; sub: string }[] = [
    { label: "TMDB", value: film.scores.tmdb, of: 10, sub: film.votes?.tmdb ? `${compact.format(film.votes.tmdb)} votes` : "users" },
    { label: "IMDb", value: film.scores.imdb, of: 10, sub: film.votes?.imdb ? `${compact.format(film.votes.imdb)} votes` : "users" },
    { label: "Rotten Tomatoes", value: film.scores.rt, of: 100, sub: "Tomatometer" },
    { label: "Metacritic", value: film.scores.metacritic, of: 100, sub: "Metascore" },
  ];
  return (
    <section aria-label="Scores" className="rounded-[22px] bg-(--fill-glass) border border-(--line-2) overflow-hidden">
      <div className="grid grid-cols-2">
        {rows.map((r, i) => {
          const n = num(r.value);
          const fill = n == null ? 0 : Math.min(100, (n / r.of) * 100);
          return (
            <div key={r.label} className={cx("flex flex-col gap-[10px] p-5", i % 2 === 0 && "border-r border-(--line-2)", i < 2 && "border-b border-(--line-2)")}>
              <Eyebrow className="text-[10.5px]">{r.label}</Eyebrow>
              <span className={cx("font-display text-[26px] font-medium leading-none tabular-nums", n == null && "text-ink-4")}>
                {r.value ?? "–"}
                {n != null && r.of === 10 && <span className="font-sans text-[13px] text-ink-4 font-normal"> / 10</span>}
              </span>
              <span className="h-[3px] rounded-full bg-white/[0.07] overflow-hidden">
                <span className="block h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${fill}%`, background: glow, boxShadow: `0 0 10px ${glow}` }} />
              </span>
              <span className="font-mono text-[11px] text-ink-4">{n == null ? "not rated yet" : r.sub}</span>
            </div>
          );
        })}
      </div>
      {film.awards && (
        <div className="flex flex-col gap-[6px] px-5 py-4 border-t border-(--line-2)">
          <Eyebrow className="text-[10.5px]">Awards</Eyebrow>
          <p className="m-0 text-[14px] leading-[1.5] text-ink-2">{film.awards}</p>
        </div>
      )}
    </section>
  );
}

function Details({ film }: { film: MovieDetail }) {
  const f = film.facts ?? {};
  const langs = [language(film.language), ...(f.languages ?? [])].filter((x, i, a) => x && a.indexOf(x) === i);
  const rows = [
    ["Released", film.release_date ? formatFullDate(film.release_date) : null],
    ["Rated", f.certification],
    ["Original title", film.original_title],
    [langs.length > 1 ? "Languages" : "Language", langs.join(", ")],
    [f.countries && f.countries.length > 1 ? "Countries" : "Country", f.countries?.join(", ")],
    ["Studios", f.studios?.join(", ")],
    ["Budget", money(f.budget)],
    ["Box office", money(f.revenue) ?? f.box_office],
    ["Status", f.status && f.status !== "Released" ? f.status : null],
  ].filter(([, v]) => v) as [string, string][];
  const links = [
    ["TMDB", `https://www.themoviedb.org/movie/${film.tmdb_id}`],
    ["IMDb", film.imdb_id ? `https://www.imdb.com/title/${film.imdb_id}/` : null],
    ["Website", f.homepage],
  ].filter(([, v]) => v) as [string, string][];
  return (
    <section aria-label="Details" className="rounded-[22px] border border-(--line-2) overflow-hidden">
      <dl className="m-0 px-5 py-1">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[112px_1fr] gap-4 py-[11px] border-b border-(--divider) last:border-0">
            <dt className="text-[13px] text-ink-4">{k}</dt>
            <dd className="m-0 text-[13px] text-ink leading-[1.45]">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-(--line-2) bg-white/[0.015]">
        {links.map(([label, href]) => (
          <a key={label} href={href} target="_blank" rel="noreferrer" className="press h-8 px-3 grid place-items-center rounded-[9px] border border-(--line-4) text-[12px] text-ink-2 no-underline hover:bg-(--fill-ctl) hover:text-ink-hi">
            {label} ↗
          </a>
        ))}
        <span className="ml-auto font-mono text-[11px] text-ink-4">updated {relativeTime(film.fetched_at)}</span>
      </div>
    </section>
  );
}

function Collection({ film }: { film: MovieDetail }) {
  const c = film.collection;
  if (!c) return null;
  const seen = c.films.filter((f) => f.watch_count > 0).length;
  return (
    <section data-extension className="px-12 max-[1023px]:px-6 max-[639px]:px-4 flex flex-col gap-[18px]">
      <div className="flex justify-between items-baseline gap-4 flex-wrap">
        <SectionTitle>{c.name}</SectionTitle>
        <span className="font-mono text-[12px] text-ink-3">seen {seen} of {c.films.length}</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(130px,100%),1fr))] gap-[18px]">
        {c.films.map((f) => {
          const here = f.tmdb_id === film.tmdb_id;
          const meta = here
            ? "This film"
            : f.watch_count > 0
              ? `Watched${f.my_rating != null ? ` · ★ ${rating(f.my_rating)}` : ""}`
              : f.on_watchlist
                ? "On your watchlist"
                : f.year
                  ? `${f.year} · not seen`
                  : "Not seen";
          return (
            <Link
              key={f.tmdb_id}
              to={`/film/${f.tmdb_id}`}
              aria-current={here ? "page" : undefined}
              className={cx("mini-poster flex flex-col gap-2 no-underline text-inherit hover:text-inherit", !here && f.watch_count === 0 && "opacity-60 hover:opacity-100 transition-opacity")}
            >
              <Poster film={f} size="mini" shadow={here ? `0 0 0 2px ${"var(--glow)"}, 0 20px 40px -20px var(--glow)` : false} layout={false} />
              <span className={cx("text-[12px]", here ? "text-ink" : "text-ink-3")}>{meta}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function NeighbourTile({ n }: { n: Neighbor }) {
  const meta = n.kind === "watched" ? `Watched${n.film.my_rating != null ? ` · ★ ${rating(n.film.my_rating)}` : ""}` : `Suggested · ${pct(n.score)}`;
  return (
    <Link to={`/film/${n.film.tmdb_id}`} className="mini-poster flex flex-col gap-2 no-underline text-inherit hover:text-inherit">
      <Poster film={n.film} size="mini" shadow={false} layout={false} />
      <span className="text-[12px] text-ink-3">{meta}</span>
    </Link>
  );
}

export default function FilmDetail() {
  const id = Number(useParams().tmdbId);
  const loc = useLocation();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const { data: film, isLoading, error } = useMovie(id);
  const { openPalette } = usePalette();
  const [trailer, setTrailer] = useState(false);
  const [allCast, setAllCast] = useState(false);
  const back = useMemo(() => backTarget(loc.pathname), [loc.pathname]);

  useEffect(() => {
    const from = sp.get("from");
    if (from === "recs" || from === "map") void api.feedback(id, "opened").catch(() => {});
  }, [id, sp]);

  const backPill = (
    <button
      type="button"
      onClick={() => (back.back ? nav(-1) : nav("/"))}
      className="flex items-center gap-2 h-11 box-content pl-3 pr-4 rounded-[12px] bg-[rgba(7,8,12,0.45)] border border-(--line-4) backdrop-blur-[16px] text-[14px] text-ink cursor-pointer"
    >
      <IconChevronLeft size={16} />
      {back.label}
    </button>
  );

  if (isLoading || !film)
    return (
      <main className="flex flex-col gap-6 pt-8 px-12 pb-[72px] max-[1023px]:px-6 max-[639px]:px-4">
        <div className="flex">{backPill}</div>
        {error ? <ErrorLine error={error} onSettings /> : <div className="skeleton h-[480px] rounded-[22px]" />}
      </main>
    );

  const glow = film.palette[0] ?? posterBg(film);
  const glow2 = film.palette[1] ?? glow;
  const seen = film.watch_count > 0;
  const onGlow = film.on_glow ?? onColor(glow);
  const style = { "--glow": glow, "--glow2": glow2 } as CSSProperties;

  return (
    <main style={style} className="flex flex-col gap-12 pb-[72px] max-[639px]:pb-24 min-w-0">
      <section aria-label="Film" className="relative min-h-[600px] max-[639px]:min-h-0 -mt-(--tb) pt-[calc(32px+var(--tb))] px-12 pb-11 max-[1023px]:px-6 max-[639px]:px-4 box-border flex flex-col justify-between gap-10">
        {/* only the backdrop layers are clipped, so the More menu can open past the hero */}
        <div aria-hidden className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 bg-bg-hero" />
          {film.backdrop && (
            <>
              <img src={film.backdrop} alt="" className="absolute inset-0 size-full object-cover" />
              <div aria-hidden className="absolute inset-0 bg-[rgba(7,8,12,0.35)]" />
            </>
          )}
          <div aria-hidden className="absolute left-[30%] top-[-18%] w-[900px] h-[700px]" style={{ background: `radial-gradient(closest-side, ${mix(glow, 70)}, transparent)` }} />
          <div aria-hidden className="absolute right-[-10%] top-[10%] w-[700px] h-[600px]" style={{ background: `radial-gradient(closest-side, ${mix(glow2, 45)}, transparent)` }} />
          <div aria-hidden className="absolute left-0 right-0 bottom-0 h-[60%] bg-linear-to-b from-[rgba(7,8,12,0)] to-bg" />
        </div>

        <div className="relative flex justify-between items-center gap-4 flex-wrap">{backPill}</div>

        <div className="relative flex flex-wrap items-end gap-9 max-[639px]:gap-6">
          <Poster film={film} size="detail" eager className="w-[200px] max-[639px]:w-[120px]" shadow={`0 40px 80px -30px ${glow}, 0 0 0 1px rgba(255,255,255,0.08)`} />
          <div className="flex-[1_1_360px] flex flex-col gap-[14px] min-w-0">
            {film.genres.length > 0 && (
              <span className="font-mono text-[12px] tracking-[0.12em] uppercase" style={{ color: glow }}>
                {film.genres.slice(0, 3).join(" · ")}
              </span>
            )}
            <h1 className="m-0 font-display font-semibold text-[56px] max-[639px]:text-[34px] leading-[1.02] tracking-[-0.02em] [text-wrap:balance]">{film.title}</h1>
            {film.tagline && <p className="m-0 -mt-1 max-w-[56ch] text-[17px] italic text-ink-2 [text-wrap:balance]">{film.tagline}</p>}
            <p className="m-0 flex flex-wrap items-center gap-x-[10px] gap-y-1 text-[15px] text-ink-2b">
              {film.facts?.certification && (
                <span className="font-mono text-[11px] leading-none px-[6px] py-[4px] rounded-[5px] border border-white/30 text-ink-2">{film.facts.certification}</span>
              )}
              {[film.year, runtime(film.runtime), film.director, language(film.language)].filter(Boolean).join(" · ")}
            </p>
            <div className="flex flex-wrap gap-[10px] mt-2">
              <button
                type="button"
                onClick={() => openPalette({ logFor: { tmdb_id: film.tmdb_id, title: film.title, year: film.year, watch_count: film.watch_count } })}
                className="flex items-center gap-2 h-[46px] px-5 rounded-[14px] font-semibold text-[14px] border-0 cursor-pointer"
                style={{ background: glow, color: onGlow, boxShadow: `0 10px 30px -10px ${glow}` }}
              >
                <IconPlus size={16} />
                {seen ? "Log a rewatch" : "Log a watch"}
              </button>
              {film.trailer_key && (
                <button type="button" onClick={() => setTrailer(true)} className="flex items-center gap-2 h-[46px] px-[18px] rounded-[14px] bg-white/8 border border-(--line-5) text-ink text-[14px] cursor-pointer backdrop-blur-[16px] hover:bg-white/10">
                  <IconPlay size={16} />
                  Play trailer
                </button>
              )}
              <MoreMenu film={film} />
            </div>
          </div>
          <div className="flex flex-col items-end gap-[14px] max-[639px]:items-start">
            {seen && film.my_rating != null && (
              <div className="flex flex-col items-end gap-1 max-[639px]:items-start">
                <Eyebrow className="tracking-[0.12em]">YOUR RATING</Eyebrow>
                <span className="font-display font-medium text-[64px] leading-none" style={{ color: glow }}>{rating(film.my_rating)}</span>
                <span className="text-[13px] text-ink-3">across {film.watch_count} watch{film.watch_count === 1 ? "" : "es"}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-10 px-12 max-[1023px]:px-6 max-[639px]:px-4">
        <div className="flex-[1_1_520px] min-w-0 flex flex-col gap-9">
          <section className="flex flex-col gap-[14px]">
            <SectionTitle>Overview</SectionTitle>
            <p className="m-0 max-w-[64ch] text-[16px] leading-[1.65] text-ink-2 [text-wrap:pretty]">{film.overview || "No overview on TMDB yet."}</p>
            {film.keywords.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {film.keywords.slice(0, 8).map((k) => <TagChip key={k}>{k}</TagChip>)}
              </div>
            )}
          </section>

          {film.trailer_key && (
            <section aria-label="Trailer" className="relative aspect-video rounded-[20px] overflow-hidden bg-(--color-bg-video) border border-(--line-1) grid place-items-center">
              {film.backdrop && <img src={film.backdrop} alt="" className="absolute inset-0 size-full object-cover opacity-40" />}
              <div aria-hidden className="absolute inset-0" style={{ background: `radial-gradient(60% 70% at 35% 60%, ${mix(glow, 35)}, transparent)` }} />
              <button type="button" aria-label="Play trailer" onClick={() => setTrailer(true)} className="relative size-[76px] rounded-full border border-[rgba(255,255,255,0.25)] bg-[rgba(255,255,255,0.12)] backdrop-blur-[16px] text-ink-hi grid place-items-center cursor-pointer">
                <IconPlay size={26} />
              </button>
              <span className="absolute left-5 bottom-[18px] font-mono text-[12px] text-ink-3">TRAILER · YouTube via TMDB videos</span>
            </section>
          )}

          {film.cast.length > 0 && (
            <section className="flex flex-col gap-4">
              <SectionTitle>Cast</SectionTitle>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(120px,100%),1fr))] gap-5">
                {film.cast.slice(0, allCast ? undefined : 12).map((p) => (
                  <div key={`${p.name}-${p.character}`} className="flex flex-col items-start gap-[10px]">
                    <CastPhoto name={p.name} src={p.photo} />
                    <div className="flex flex-col gap-[2px]">
                      <span className="text-[14px] font-medium">{p.name}</span>
                      {p.character && <span className="text-[13px] text-ink-4">{p.character}</span>}
                    </div>
                  </div>
                ))}
              </div>
              {film.cast.length > 12 && (
                <button type="button" onClick={() => setAllCast((v) => !v)} className="self-start h-9 px-4 rounded-[10px] bg-transparent border border-(--line-4) text-[13px] text-ink-2 cursor-pointer hover:bg-(--fill-ctl) hover:text-ink-hi">
                  {allCast ? "Show fewer" : `Show all ${film.cast.length}`}
                </button>
              )}
            </section>
          )}

          <Crew film={film} />
        </div>

        <aside className="flex-[1_1_340px] min-w-0 flex flex-col gap-5">
          {seen && <History film={film} glow={glow} glow2={glow2} />}
          <Scores film={film} glow={glow} />
          <Details film={film} />
        </aside>
      </div>

      <Collection film={film} />

      {film.neighbors.length > 0 && (
        <section className="px-12 max-[1023px]:px-6 max-[639px]:px-4 flex flex-col gap-[18px]">
          <div className="flex justify-between items-baseline gap-4 flex-wrap">
            <SectionTitle>Its neighbours on your taste map</SectionTitle>
            <Link to={`/map?focus=${film.tmdb_id}`} className="text-[14px] text-ink-2b underline">Open taste map</Link>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(130px,100%),1fr))] gap-[18px]">
            {film.neighbors.map((n) => <NeighbourTile key={n.film.tmdb_id} n={n} />)}
          </div>
        </section>
      )}
      <TrailerModal open={trailer} onClose={() => setTrailer(false)} film={film} />
    </main>
  );
}
