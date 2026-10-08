import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { mediaApi, useMediaMut, useMediaRecs, type ItemCard, type Kind, type MediaRec } from "../../api/media";
import { alpha, useAmbientGlow } from "../../components/Glow";
import { Poster, posterBg } from "../../components/Poster";
import { CardActions, CardWhy, HeroActions, type Answers } from "../../components/RecActions";
import { RecHealth, joinAnd } from "../../components/RecHealth";
import { useToast } from "../../components/Toasts";
import { Button, ErrorLine, PageHeader, Segmented, TagChip, cx } from "../../components/ui";
import { whenCalm } from "../../lib/celebrate";
import { pct, rating, relativeTime } from "../../lib/format";
import { MODES, SHELF_LABEL } from "../../lib/mode";
import { asFilm, itemPath, pagePad } from "./parts";

type Filter = "all" | "wild";

const SEEN: Record<Kind, string> = { show: "Seen it, rate it", book: "Read it, rate it", game: "Played it, rate it" };

/** The same four answers a film suggestion takes, applied at once and saved behind; a failed save puts the answer
 *  back. Lists refresh once the animation has played, except this slate, which keeps its cards where they are. */
function useAnswers(r: MediaRec, kind: Kind): Answers {
  const toast = useToast();
  const qc = useQueryClient();
  const wish = SHELF_LABEL[kind].wishlist.toLowerCase();
  const [saved, setSaved] = useState(r.shelf === "wishlist");
  const [liked, setLiked] = useState(r.liked);
  const [hidden, setHidden] = useState(false);
  const [rated, setRated] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const was = r.shelf === "wishlist" || r.shelf === "not_interested" ? "" : r.shelf ?? "";
  const send = <T,>(call: Promise<T>, undo: () => void) =>
    call.then(
      () => whenCalm(() => void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "media" && q.queryKey[2] !== "recs" })),
      () => {
        undo();
        toast({ text: "Couldn't reach the backend" });
      },
    );
  return {
    wish,
    seen: SEEN[kind],
    saved,
    liked,
    rated,
    hidden,
    rating: open,
    save: () => {
      const next = !saved;
      setSaved(next);
      if (next) setHidden(false);
      void send(mediaApi.patch(r.id, { shelf: next ? "wishlist" : was }), () => setSaved(!next));
    },
    like: () => {
      setLiked(!liked);
      void send(mediaApi.feedback(r.id, !liked), () => setLiked(liked));
    },
    openRating: () => setOpen((o) => !o),
    rate: (v) => {
      setRated(v);
      setOpen(false);
      void send(mediaApi.seenIt(r.id, v), () => setRated(null));
    },
    hide: () => {
      const next = !hidden;
      setHidden(next);
      if (next) setSaved(false); // the shelf can only be one of them
      if (next && liked) {
        setLiked(false); // and a like makes no sense on something hidden
        void send(mediaApi.feedback(r.id, false), () => setLiked(true));
      }
      void send(mediaApi.patch(r.id, { shelf: next ? "not_interested" : was }), () => setHidden(!next));
    },
  };
}

function Because({ items }: { items: ItemCard[] }) {
  return (
    <p className="mt-1 mb-0 text-[17px] leading-[1.5]">
      Because you loved{" "}
      {items.map((b, i) => (
        <Fragment key={b.id}>
          {i > 0 && " and "}
          <Link to={itemPath(b)} className="text-ink-hi underline">{b.title}</Link>
          {b.my_rating != null && <span className="font-mono text-ink-star"> ★ {rating(b.my_rating)}</span>}
        </Fragment>
      ))}
    </p>
  );
}

function TopPick({ r, kind }: { r: MediaRec; kind: Kind }) {
  const a = useAnswers(r, kind);
  const glow = r.palette[0] ?? posterBg(asFilm(r));
  const wild = r.wildcard;
  return (
    <section aria-label="Top pick" className="relative flex flex-wrap gap-9 p-7 rounded-[26px] bg-(--fill-glass) border border-(--line-3) backdrop-blur-[24px] overflow-hidden transition-opacity duration-300" style={{ opacity: a.hidden ? 0.4 : 1 }}>
      <div aria-hidden className="absolute right-[-120px] top-[-200px] w-[760px] h-[560px] pointer-events-none" style={{ background: `radial-gradient(closest-side, ${alpha(glow, 0.32)}, ${alpha(glow, 0)})` }} />
      <Link to={itemPath(r)} aria-label={r.title} className="relative self-start no-underline">
        <Poster film={asFilm(r)} size="top" eager className="w-[190px] max-[639px]:w-[140px]" layout={false} shadow={`0 34px 70px -30px ${glow}`} />
      </Link>
      <div className="relative flex-[1_1_380px] flex flex-col gap-[14px] min-w-0">
        <span className="font-mono text-[12px] tracking-[0.12em]" style={{ color: wild ? "var(--color-wild)" : "var(--color-score)" }}>{wild ? "WILDCARD PICK" : "TOP PICK"}</span>
        <h2 className="m-0 font-display font-semibold text-[44px] max-[639px]:text-[32px] leading-[1.05]">
          <Link to={itemPath(r)} className="no-underline">{r.title}</Link>
        </h2>
        <p className="m-0 text-[15px] text-ink-2b">{[r.subtitle, r.year, r.genres.slice(0, 3).join(", ")].filter(Boolean).join(" · ")}</p>
        {r.because.length > 0 ? <Because items={r.because} /> : r.why ? <p className="mt-1 mb-0 text-[17px] leading-[1.5]">{r.why}</p> : r.overview && <p className="mt-1 mb-0 text-[15px] leading-[1.55] text-ink-body line-clamp-3">{r.overview}</p>}
        {r.reasons.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {r.reasons.slice(0, 4).map((x) => <TagChip key={x} strong>{x}</TagChip>)}
          </div>
        )}
        <HeroActions a={a} />
      </div>
      <div className="relative flex flex-col items-end gap-[6px] max-[639px]:items-start">
        <span className="font-mono text-[11px] tracking-[0.1em] text-ink-3">CHANCE YOU RATE IT 4+</span>
        <span className="font-display font-medium text-[56px] leading-none" style={{ color: wild ? "var(--color-wild)" : "var(--color-score)" }}>{pct(r.score)}</span>
      </div>
    </section>
  );
}

function RecCard({ r, kind }: { r: MediaRec; kind: Kind }) {
  const a = useAnswers(r, kind);
  const wild = r.wildcard;
  const why = r.why ?? (r.because.length ? `Because you loved ${joinAnd(r.because.map((b) => b.title))}` : r.reasons[0] ?? "");
  return (
    <article
      className="flex gap-[18px] p-[18px] rounded-[22px] bg-(--fill-card) border transition-opacity duration-300"
      style={{ borderColor: wild ? "rgba(240,182,218,0.35)" : "var(--line-1)", opacity: a.hidden ? 0.4 : 1 }}
    >
      <Link to={itemPath(r)} aria-label={r.title} className="w-[116px] shrink-0 self-start no-underline">
        <Poster film={asFilm(r)} size="rec" className="w-[116px]" layout={false} />
      </Link>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        {wild && <span className="self-start font-mono text-[11px] tracking-[0.08em] px-2 py-[3px] rounded-[6px] border border-dashed border-wild text-wild">WILDCARD</span>}
        <div className="flex justify-between items-baseline gap-[10px] min-w-0">
          <h3 className="m-0 min-w-0 truncate font-display font-medium text-[17px] leading-[1.2]">
            <Link to={itemPath(r)} className="no-underline">{r.title}</Link>
          </h3>
          <span className="shrink-0 font-mono text-[14px]" style={{ color: wild ? "var(--color-wild)" : "var(--color-score)" }}>{pct(r.score)}</span>
        </div>
        <span className="truncate text-[13px] text-ink-3">{[r.subtitle, r.year, r.genres.slice(0, 2).join(", ")].filter(Boolean).join(" · ")}</span>
        <CardWhy a={a} why={why} title={r.title} />
        <CardActions a={a} />
      </div>
    </article>
  );
}

export default function MediaForYou({ kind }: { kind: Kind }) {
  const [sp, setSp] = useSearchParams();
  const filter = (sp.get("filter") as Filter) || "all";
  const { data, error, isLoading } = useMediaRecs(kind, filter === "wild");
  const recompute = useMediaMut(() => mediaApi.recompute(kind));
  const [top, ...rest] = data?.items ?? [];
  useAmbientGlow(top?.palette[0] ?? null);
  const [, many] = MODES[kind].noun;
  const m = data?.model;
  const sub = data?.computing && !data.items.length
    ? "Finding suggestions…"
    : m
      ? `ranked by model ${m.version} · learned from ${m.ratings_used} ${many} + ${m.reactions_used} reactions · updated ${relativeTime(m.computed_at)}`
      : " ";
  return (
    <main className={cx("flex flex-col gap-7 pt-9 pb-16 max-[1023px]:pt-7 max-[639px]:pt-5 max-[639px]:pb-24 box-border min-w-0", pagePad)}>
      <PageHeader title="For you" subline={sub}>
        <Segmented<Filter>
          label="Show"
          value={filter}
          onChange={(v) => setSp(v === "all" ? {} : { filter: v }, { replace: true })}
          options={[{ id: "all", label: "All", tip: "Every suggestion" }, { id: "wild", label: "Wildcards", tip: "Well-loved picks outside your usual taste" }]}
        />
        <Button onClick={() => recompute.mutate(undefined)} disabled={recompute.isPending || data?.computing} title="Re-rank with your latest ratings and reactions">Refresh suggestions</Button>
      </PageHeader>
      {error && <ErrorLine error={error} />}
      {isLoading ? (
        <div className="skeleton h-[420px] rounded-[26px]" />
      ) : data && !data.items.length && !data.computing ? (
        <p className="m-0 py-20 text-center font-mono text-[13px] text-ink-3b">
          {filter === "wild" ? "No wildcards right now." : `Finish or rate a few ${many} and suggestions appear here. Dropping something teaches it too.`}
        </p>
      ) : (
        <>
          {top && <TopPick key={top.id} r={top} kind={kind} />}
          {rest.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))] auto-rows-fr gap-4">
              {rest.map((r) => <RecCard key={r.id} r={r} kind={kind} />)}
            </div>
          )}
          {data && data.items.length > 0 && <RecHealth health={data.health} recent={many} mapTo={`${MODES[kind].base}/map`} />}
        </>
      )}
    </main>
  );
}
