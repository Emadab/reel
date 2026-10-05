import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { Fragment, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "../api/client";
import { useLogWatch, useOnboarding, useRecs } from "../api/hooks";
import type { FilmCard, Reaction, Rec } from "../api/types";
import { alpha } from "../components/Glow";
import { IconBookmark, IconNotInterested, IconThumbUp } from "../components/Icons";
import { Poster, posterBg } from "../components/Poster";
import { QuickLog } from "../components/QuickLog";
import { RatingInput } from "../components/Rating";
import { useToast } from "../components/Toasts";
import { Button, ButtonLink, ErrorLine, IconButton, PageHeader, Segmented, TagChip } from "../components/ui";
import { pct, rating, relativeTime, runtime, today } from "../lib/format";

type Filter = "all" | "short" | "wild";

function joinAnd(xs: string[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

function useReaction(rec: Rec) {
  const [reaction, setReaction] = useState<Reaction>(rec.reaction ?? null);
  const [saved, setSaved] = useState(rec.on_watchlist);
  const toast = useToast();
  const qc = useQueryClient();
  const toggle = (signal: "like" | "not_interested") => {
    const prev = reaction;
    const next = prev === signal ? null : signal;
    setReaction(next); // optimistic
    const calls: Promise<unknown>[] = [];
    if (prev === "like" || prev === "not_interested") calls.push(api.undoFeedback(rec.tmdb_id, prev));
    if (next) calls.push(api.feedback(rec.tmdb_id, next));
    Promise.all(calls).catch(() => {
      setReaction(prev);
      toast({ text: "Couldn't reach the backend" });
    });
  };
  const save = async () => {
    setSaved(true);
    try {
      await api.addToWatchlist(rec.tmdb_id);
      await api.feedback(rec.tmdb_id, "added_watchlist");
      qc.invalidateQueries({ queryKey: ["library"] });
      toast({ text: <>Added <em>{rec.title}</em> to your watchlist</> });
    } catch (e) {
      setSaved(false);
      toast({ text: e instanceof Error ? e.message : "Couldn't save" });
    }
  };
  return { reaction, toggle, saved, save };
}

function Because({ films }: { films: FilmCard[] }) {
  return (
    <p className="mt-1 mb-0 text-[17px] leading-[1.5]">
      Because you loved{" "}
      {films.map((f, i) => (
        <Fragment key={f.tmdb_id}>
          {i > 0 && " and "}
          <Link to={`/film/${f.tmdb_id}`} className="text-ink-hi underline">{f.title}</Link>
          {f.my_rating != null && <span className="font-mono text-ink-star"> ★ {rating(f.my_rating)}</span>}
        </Fragment>
      ))}
    </p>
  );
}

function TopPick({ rec }: { rec: Rec }) {
  const [quick, setQuick] = useState(false);
  const { reaction, toggle, saved, save } = useReaction(rec);
  const glow = rec.glow ?? posterBg(rec);
  const wild = rec.is_wildcard;
  return (
    <section aria-label="Top pick" className="relative flex flex-wrap gap-9 p-7 rounded-[26px] bg-(--fill-glass) border border-(--line-3) backdrop-blur-[24px] overflow-hidden transition-opacity duration-300" style={{ opacity: reaction === "not_interested" ? 0.4 : 1 }}>
      <div aria-hidden className="absolute right-[-120px] top-[-200px] w-[760px] h-[560px] pointer-events-none" style={{ background: `radial-gradient(closest-side, ${alpha(glow, 0.32)}, ${alpha(glow, 0)})` }} />
      <div className="relative self-start">
        <Link to={`/film/${rec.tmdb_id}?from=recs`} aria-label={rec.title} className="relative no-underline">
          <Poster film={rec} size="top" eager className="w-[190px] max-[639px]:w-[140px]" shadow={`0 34px 70px -30px ${glow}`} />
        </Link>
        <AnimatePresence>
          {quick && <QuickLog film={{ ...rec, watch_count: 0 }} onClose={() => setQuick(false)} className="rounded-b-[16px]" />}
        </AnimatePresence>
      </div>
      <div className="relative flex-[1_1_380px] flex flex-col gap-[14px] min-w-0">
        <span className="font-mono text-[12px] tracking-[0.12em]" style={{ color: wild ? "var(--color-wild)" : "var(--color-score)" }}>{wild ? "WILDCARD PICK" : "TOP PICK TONIGHT"}</span>
        <h2 className="m-0 font-display font-semibold text-[44px] max-[639px]:text-[32px] leading-[1.05]">
          <Link to={`/film/${rec.tmdb_id}?from=recs`} className="no-underline">{rec.title}</Link>
        </h2>
        <p className="m-0 text-[15px] text-ink-2b">{[rec.director, rec.year, runtime(rec.runtime), rec.genres.join(", ")].filter(Boolean).join(" · ")}</p>
        {rec.because.length > 0 ? <Because films={rec.because} /> : rec.why && <p className="mt-1 mb-0 text-[17px] leading-[1.5]">{rec.why}</p>}
        {rec.reasons.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {rec.reasons.slice(0, 4).map((r) => <TagChip key={r} strong>{r}</TagChip>)}
          </div>
        )}
        <div className="flex flex-wrap gap-[10px] mt-2">
          <Button variant="primary" hero className="px-5" disabled={saved} onClick={save}>
            <IconBookmark size={16} strokeWidth={2.2} />
            {saved ? "On your watchlist" : "Add to watchlist"}
          </Button>
          <Button
            hero
            aria-expanded={quick}
            onClick={() => {
              void api.feedback(rec.tmdb_id, "seen_rated").catch(() => {});
              setQuick(true);
            }}
          >
            Seen it, rate it
          </Button>
          <Button hero aria-pressed={reaction === "not_interested"} onClick={() => toggle("not_interested")}>
            {reaction === "not_interested" ? "Hidden, model notified" : "Not interested"}
          </Button>
        </div>
      </div>
      <div className="relative flex flex-col items-end gap-[6px] max-[639px]:items-start">
        <span className="font-mono text-[11px] tracking-[0.1em] text-ink-3">CHANCE YOU RATE IT 4+</span>
        <span className="font-display font-medium text-[56px] leading-none" style={{ color: wild ? "var(--color-wild)" : "var(--color-score)" }}>{pct(rec.score)}</span>
      </div>
    </section>
  );
}

function RecCard({ rec }: { rec: Rec }) {
  const { reaction, toggle, saved, save } = useReaction(rec);
  const wild = rec.is_wildcard;
  const status = reaction === "not_interested" ? "Hidden, model notified" : reaction === "like" ? "Noted: more like this" : saved ? "On your watchlist" : "";
  const why = rec.why ?? (rec.because.length ? `Because you loved ${joinAnd(rec.because.map((b) => b.title))}` : rec.reasons[0] ?? "");
  return (
    <article
      className="flex gap-[18px] p-[18px] rounded-[22px] bg-(--fill-card) border transition-opacity duration-300"
      style={{ borderColor: wild ? "rgba(240,182,218,0.35)" : "var(--line-1)", opacity: reaction === "not_interested" ? 0.4 : 1 }}
    >
      <Link to={`/film/${rec.tmdb_id}?from=recs`} aria-label={rec.title} className="w-[92px] shrink-0 flex no-underline">
        {/* the reference stretches the poster to the card's height (flex row, align stretch) */}
        <Poster film={rec} size="rec" className="w-[92px]" style={{ aspectRatio: "auto", minHeight: 138 }} />
      </Link>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        {wild && <span className="self-start font-mono text-[11px] tracking-[0.08em] px-2 py-[3px] rounded-[6px] border border-dashed border-wild text-wild">WILDCARD</span>}
        <div className="flex justify-between items-baseline gap-[10px]">
          <h3 className="m-0 font-display font-medium text-[17px] leading-[1.2]">
            <Link to={`/film/${rec.tmdb_id}?from=recs`} className="no-underline">{rec.title}</Link>
          </h3>
          <span className="font-mono text-[14px]" style={{ color: wild ? "var(--color-wild)" : "var(--color-score)" }}>{pct(rec.score)}</span>
        </div>
        <span className="text-[13px] text-ink-3">{[rec.director, rec.year, runtime(rec.runtime)].filter(Boolean).join(" · ")}</span>
        <p className="m-0 text-[14px] leading-[1.45] text-ink-body">{why}</p>
        <div className="flex gap-[6px] mt-auto pt-[6px]">
          <IconButton shrink label={saved ? "On your watchlist" : "Add to watchlist"} on={saved} onClick={() => !saved && save()}>
            <IconBookmark size={18} />
          </IconButton>
          <IconButton shrink label="More like this" aria-pressed={reaction === "like"} on={reaction === "like"} onClick={() => toggle("like")}>
            <IconThumbUp size={18} />
          </IconButton>
          <IconButton shrink label="Not interested" aria-pressed={reaction === "not_interested"} onClick={() => toggle("not_interested")}>
            <IconNotInterested size={18} />
          </IconButton>
          <span className="ml-auto self-center text-[12px] text-ink-4">{status}</span>
        </div>
      </div>
    </article>
  );
}

function Onboarding() {
  const { data: films = [], isLoading, error } = useOnboarding(true);
  const log = useLogWatch();
  const qc = useQueryClient();
  const [ratings, setRatings] = useState<Record<number, number | null>>({});
  const [gone, setGone] = useState<Set<number>>(new Set());
  const rate = async (f: FilmCard, r: number | null) => {
    setRatings((x) => ({ ...x, [f.tmdb_id]: r }));
    if (r == null) return;
    await log.mutateAsync({
      tmdb_id: f.tmdb_id, watched_on: `${today().getFullYear()}-01-01`, date_precision: "year", rating: r,
      is_rewatch: false, location: null, with_whom: null, notes: null, source: "onboarding",
    });
  };
  const skip = async (f: FilmCard) => {
    setGone((g) => new Set(g).add(f.tmdb_id));
    await api.skipOnboarding(f.tmdb_id);
    qc.invalidateQueries({ queryKey: ["onboarding"] });
  };
  const rated = Object.values(ratings).filter((r) => r != null).length;
  return (
    <section className="p-7 rounded-[26px] bg-(--fill-glass) border border-(--line-3) backdrop-blur-[24px] flex flex-col gap-6">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="m-0 font-display font-semibold text-[28px]">Rate a few films to get started</h2>
          <p className="m-0 text-[15px] text-ink-2b">Ten ratings is enough for a first slate. Each one is logged as a watch sometime this year.</p>
        </div>
        <ButtonLink to="/import">Import from Letterboxd or IMDb</ButtonLink>
      </div>
      {rated > 0 && <span className="font-mono text-[12px] text-ink-3">{rated} rated this session</span>}
      {error ? <ErrorLine error={error} onSettings /> : isLoading ? (
        <p className="m-0 font-mono text-[13px] text-ink-4">Fetching well-known films from TMDB…</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(170px,100%),1fr))] gap-x-5 gap-y-8">
          {films.filter((f) => !gone.has(f.tmdb_id)).map((f) => (
            <div key={f.tmdb_id} className="flex flex-col gap-2 min-w-0">
              <Poster film={f} size="wall" layout={false} />
              <span className="text-[14px] font-medium truncate">{f.title} <span className="font-mono text-[12px] text-ink-3">{f.year}</span></span>
              <RatingInput label="Your rating" value={ratings[f.tmdb_id] ?? null} onChange={(r) => rate(f, r)} />
              {ratings[f.tmdb_id] == null && (
                <button type="button" onClick={() => skip(f)} className="self-start h-11 bg-transparent border-0 p-0 text-[13px] text-ink-3 underline underline-offset-2 cursor-pointer hover:text-ink">
                  Haven't seen it
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function ForYou() {
  const [sp, setSp] = useSearchParams();
  const filter = (sp.get("filter") as Filter) || "all";
  const { data, error, isLoading } = useRecs(filter);
  const m = data?.model;
  const h = data?.health;
  const sources = h?.sources.length ? joinAnd(h.sources) : "TMDB";

  return (
    <main className="flex flex-col gap-7 pt-9 px-12 pb-16 max-[1023px]:pt-7 max-[1023px]:px-6 max-[639px]:pt-5 max-[639px]:px-4 max-[639px]:pb-24 box-border min-w-0 relative">
      <PageHeader
        title="For you"
        subline={m ? `ranked by model ${m.version} · learned from ${m.ratings_used} ratings + ${m.reactions_used} reactions · updated ${relativeTime(m.computed_at)}` : data?.onboarding ? "rate ten films and the model takes it from there" : " "}
      >
        <Segmented<Filter>
          label="Show"
          value={filter}
          onChange={(v) => setSp(v === "all" ? {} : { filter: v }, { replace: true })}
          options={[{ id: "all", label: "All" }, { id: "short", label: "Under 2 hours" }, { id: "wild", label: "Wildcards" }]}
        />
      </PageHeader>

      {error && <ErrorLine error={error} onSettings />}
      {isLoading && <div className="skeleton h-[420px] rounded-[26px]" />}
      {data?.onboarding && <Onboarding />}
      {data && !data.onboarding && !data.top && !data.items.length && (
        <p className="m-0 font-mono text-[13px] text-ink-3b">
          {data.computing ? "Building your slate from TMDB… this takes a minute the first time." : filter === "all" ? "No recommendations yet." : "Nothing in this filter right now."}
        </p>
      )}
      {data?.top && <TopPick key={data.top.tmdb_id} rec={data.top} />}
      {data && data.items.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))] gap-4">
          {data.items.map((r) => <RecCard key={r.tmdb_id} rec={r} />)}
        </div>
      )}

      {h && !data?.onboarding && (data?.top || data?.items.length) ? (
        <section aria-label="Recommender health" className="flex flex-wrap gap-8 items-center py-5 px-6 rounded-[20px] border border-(--line-2)">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[11px] tracking-[0.1em] text-ink-3">HELD-OUT HIT RATE · TOP 20</span>
            <span className="text-[15px]">
              {h.hit_at_20 != null ? (
                <>
                  {h.hit_at_20} of your last {h.holdout_n} watches <span className="text-ink-3">(v1 found {h.baseline_hit_at_20})</span>
                </>
              ) : (
                <span className="text-ink-3">needs 20 rated watches</span>
              )}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[11px] tracking-[0.1em] text-ink-3">CANDIDATES</span>
            <span className="text-[15px]">{h.candidate_count} from {sources}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[11px] tracking-[0.1em] text-ink-3">WILDCARD SHARE</span>
            <span className="text-[15px]">{Math.round(h.wildcard_share * 100)}% of slots</span>
          </div>
          <Link to="/map" className="ml-auto max-[639px]:ml-0 flex items-center h-11 box-content px-4 rounded-[12px] border border-(--line-5) no-underline text-[14px]">
            See why on the taste map
          </Link>
        </section>
      ) : null}
    </main>
  );
}
