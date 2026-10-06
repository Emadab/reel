import { Fragment, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { mediaApi, useMediaMut, useMediaRecs, type ItemCard, type Kind, type MediaRec } from "../../api/media";
import { alpha, useAmbientGlow } from "../../components/Glow";
import { IconBookmark, IconCheck, IconNotInterested, IconThumbUp } from "../../components/Icons";
import { Poster, posterBg } from "../../components/Poster";
import { RatingInput } from "../../components/Rating";
import { useToast } from "../../components/Toasts";
import { Button, ErrorLine, IconButton, PageHeader, Segmented, TagChip, cx } from "../../components/ui";
import { pct, rating } from "../../lib/format";
import { MODES, SHELF_LABEL } from "../../lib/mode";
import { asFilm, itemPath, pagePad } from "./parts";

type Filter = "all" | "wild";

const SEEN: Record<Kind, string> = { show: "Seen it, rate it", book: "Read it, rate it", game: "Played it, rate it" };
const joinAnd = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The same four answers a film suggestion takes: want it, more like this, already had it, not interested. */
function useAnswers(r: MediaRec, kind: Kind) {
  const toast = useToast();
  const wish = SHELF_LABEL[kind].wishlist;
  const [liked, setLiked] = useState(r.liked);
  const [hidden, setHidden] = useState(false);
  const [rated, setRated] = useState<number | null>(null);
  const shelf = useMediaMut((s: string) => mediaApi.patch(r.id, { shelf: s }));
  const like = useMediaMut((v: boolean) => mediaApi.feedback(r.id, v));
  const seen = useMediaMut((v: number | null) => mediaApi.seenIt(r.id, v));
  return {
    wish,
    saved: r.shelf === "wishlist",
    liked,
    hidden,
    rated,
    save: async () => {
      await shelf.mutateAsync("wishlist");
      toast({ text: <>Added <em>{r.title}</em> to your {wish.toLowerCase()}</> });
    },
    toggleLike: () => {
      setLiked(!liked); // optimistic
      like.mutate(!liked, { onError: () => { setLiked(liked); toast({ text: "Couldn't reach the backend" }); } });
    },
    hide: async () => {
      setHidden(true);
      await shelf.mutateAsync("not_interested");
      toast({ text: "Got it. It won't come back." });
    },
    rate: async (v: number | null) => {
      if (v == null) return;
      setRated(v);
      await seen.mutateAsync(v);
      toast({ text: <>Logged <em>{r.title}</em> · ★ {rating(v)}</> });
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
  const [rating_, setRating] = useState(false);
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
        {r.because.length > 0 ? <Because items={r.because} /> : r.overview && <p className="mt-1 mb-0 text-[15px] leading-[1.55] text-ink-body line-clamp-3">{r.overview}</p>}
        {r.reasons.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {r.reasons.slice(0, 4).map((x) => <TagChip key={x} strong>{x}</TagChip>)}
          </div>
        )}
        <div className="flex flex-wrap gap-[10px] mt-2">
          <Button variant="primary" hero className="px-5" disabled={a.saved} onClick={a.save}>
            <IconBookmark size={16} strokeWidth={2.2} />
            {a.saved ? `On your ${a.wish.toLowerCase()}` : `Add to ${a.wish.toLowerCase()}`}
          </Button>
          <Button hero aria-expanded={rating_} onClick={() => setRating((v) => !v)}>{a.rated != null ? `Logged · ★ ${rating(a.rated)}` : SEEN[kind]}</Button>
          <Button hero aria-pressed={a.hidden} onClick={a.hide}>{a.hidden ? "Hidden, model notified" : "Not interested"}</Button>
        </div>
        {rating_ && a.rated == null && <RatingInput label="Your rating" value={null} onChange={a.rate} />}
      </div>
      <div className="relative flex flex-col items-end gap-[6px] max-[639px]:items-start">
        <span className="font-mono text-[11px] tracking-[0.1em] text-ink-3">MATCH</span>
        <span className="font-display font-medium text-[56px] leading-none" style={{ color: wild ? "var(--color-wild)" : "var(--color-score)" }}>{pct(r.score)}</span>
      </div>
    </section>
  );
}

function RecCard({ r, kind }: { r: MediaRec; kind: Kind }) {
  const a = useAnswers(r, kind);
  const [rating_, setRating] = useState(false);
  const wild = r.wildcard;
  const status = a.hidden ? "Hidden, model notified" : a.rated != null ? `Logged · ★ ${rating(a.rated)}` : a.liked ? "Noted: more like this" : a.saved ? `On your ${a.wish.toLowerCase()}` : "";
  const why = r.because.length ? `Because you loved ${joinAnd(r.because.map((b) => b.title))}` : r.reasons[0] ?? "";
  return (
    <article
      className="flex gap-[18px] p-[18px] rounded-[22px] bg-(--fill-card) border transition-opacity duration-300"
      style={{ borderColor: wild ? "rgba(240,182,218,0.35)" : "var(--line-1)", opacity: a.hidden ? 0.4 : 1 }}
    >
      <Link to={itemPath(r)} aria-label={r.title} className="w-[92px] shrink-0 flex no-underline">
        <Poster film={asFilm(r)} size="rec" className="w-[92px]" layout={false} style={{ aspectRatio: "auto", minHeight: 138 }} />
      </Link>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        {wild && <span className="self-start font-mono text-[11px] tracking-[0.08em] px-2 py-[3px] rounded-[6px] border border-dashed border-wild text-wild">WILDCARD</span>}
        <div className="flex justify-between items-baseline gap-[10px]">
          <h3 className="m-0 font-display font-medium text-[17px] leading-[1.2]">
            <Link to={itemPath(r)} className="no-underline">{r.title}</Link>
          </h3>
          <span className="font-mono text-[14px]" style={{ color: wild ? "var(--color-wild)" : "var(--color-score)" }}>{pct(r.score)}</span>
        </div>
        <span className="text-[13px] text-ink-3">{[r.subtitle, r.year, r.genres.slice(0, 2).join(", ")].filter(Boolean).join(" · ")}</span>
        {why && <p className="m-0 text-[14px] leading-[1.45] text-ink-body">{why}</p>}
        {rating_ && a.rated == null && <RatingInput compact label="Your rating" value={null} onChange={a.rate} />}
        <div className="flex gap-[6px] mt-auto pt-[6px]">
          <IconButton shrink label={a.saved ? `On your ${a.wish.toLowerCase()}` : `Add to ${a.wish.toLowerCase()}`} on={a.saved} onClick={() => !a.saved && a.save()}>
            <IconBookmark size={18} />
          </IconButton>
          <IconButton shrink label="More like this" aria-pressed={a.liked} on={a.liked} onClick={a.toggleLike}>
            <IconThumbUp size={18} />
          </IconButton>
          <IconButton shrink label={SEEN[kind]} aria-expanded={rating_} on={a.rated != null} onClick={() => setRating((v) => !v)}>
            <IconCheck size={18} />
          </IconButton>
          <IconButton shrink label="Not interested" aria-pressed={a.hidden} onClick={a.hide}>
            <IconNotInterested size={18} />
          </IconButton>
          <span className="ml-auto self-center text-[12px] text-ink-4 text-right">{status}</span>
        </div>
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
  const sub = data
    ? data.computing && !data.items.length
      ? "Finding suggestions…"
      : `learned from ${data.learned_from} ${many}${data.model ? ` · ${data.model === "lightgbm" ? "trained model" : "taste vector"}` : ""}${data.computing ? " · updating" : ""}`
    : " ";
  return (
    <main className={cx("flex flex-col gap-7 pt-9 pb-16 max-[1023px]:pt-7 max-[639px]:pt-5 max-[639px]:pb-24 box-border min-w-0", pagePad)}>
      <PageHeader title="For you" subline={sub}>
        <Segmented<Filter>
          label="Show"
          value={filter}
          onChange={(v) => setSp(v === "all" ? {} : { filter: v }, { replace: true })}
          options={[{ id: "all", label: "All" }, { id: "wild", label: "Wildcards" }]}
        />
        <Button onClick={() => recompute.mutate(undefined)} disabled={recompute.isPending || data?.computing}>Refresh suggestions</Button>
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
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))] gap-4">
              {rest.map((r) => <RecCard key={r.id} r={r} kind={kind} />)}
            </div>
          )}
        </>
      )}
    </main>
  );
}
