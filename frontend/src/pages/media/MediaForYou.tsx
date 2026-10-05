import { Link } from "react-router";
import { mediaApi, useMediaMut, useMediaRecs, type Kind, type MediaRec } from "../../api/media";
import { useAmbientGlow } from "../../components/Glow";
import { IconBookmark, IconNotInterested } from "../../components/Icons";
import { Poster, posterBg } from "../../components/Poster";
import { useToast } from "../../components/Toasts";
import { Button, ErrorLine, PageHeader, cx } from "../../components/ui";
import { MODES, SHELF_LABEL } from "../../lib/mode";
import { asFilm, itemPath, pagePad } from "./parts";

function RecCard({ r, kind }: { r: MediaRec; kind: Kind }) {
  const toast = useToast();
  const shelf = useMediaMut((s: string) => mediaApi.patch(r.id, { shelf: s }));
  const glow = r.palette[0] ?? posterBg(asFilm(r));
  const wish = SHELF_LABEL[kind].wishlist;
  return (
    <article className="relative flex gap-5 p-5 rounded-[22px] bg-(--fill-card) border border-(--line-1) overflow-hidden">
      <div aria-hidden className="absolute -left-16 -top-16 size-[220px] pointer-events-none" style={{ background: `radial-gradient(closest-side, color-mix(in oklch, ${glow} 30%, transparent), transparent)` }} />
      <Link to={itemPath(r)} className="mini-poster relative shrink-0" aria-label={r.title}>
        <Poster film={asFilm(r)} size="rec" className="w-[96px]" layout={false} shadow={`0 18px 36px -18px ${glow}`} />
      </Link>
      <div className="relative flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <Link to={itemPath(r)} className="text-[16px] font-medium no-underline truncate">{r.title}</Link>
          <span className="font-mono text-[12px] text-score shrink-0">{Math.round(r.score * 100)}%</span>
        </div>
        <span className="font-mono text-[12px] text-ink-4 truncate">{[r.year, r.genres.slice(0, 2).join(", ")].filter(Boolean).join(" · ")}</span>
        {r.because.length > 0 && (
          <p className="m-0 text-[13px] text-ink-body leading-[1.5]">
            Because you liked {r.because.map((b, i) => <span key={b.id}>{i > 0 && " and "}<em>{b.title}</em></span>)}
            {r.reasons[0] && <span className="text-ink-3"> · {r.reasons[0]}</span>}
          </p>
        )}
        <div className="mt-auto flex gap-2 pt-1">
          <button
            type="button" disabled={shelf.isPending}
            onClick={async () => { await shelf.mutateAsync("wishlist"); toast({ text: <>Added <em>{r.title}</em> to {wish.toLowerCase()}</> }); }}
            className={cx("flex items-center gap-2 h-11 px-3 rounded-[12px] border text-[13px]", r.shelf === "wishlist" ? "border-accent text-accent" : "border-(--line-4) text-ink-2 hover:bg-(--fill-ctl)")}
          >
            <IconBookmark size={16} /> {r.shelf === "wishlist" ? `On ${wish.toLowerCase()}` : wish}
          </button>
          <button
            type="button" aria-label={`Not interested in ${r.title}`} title="Not interested"
            onClick={async () => { await shelf.mutateAsync("not_interested"); toast({ text: "Got it. It won't come back." }); }}
            className="size-11 grid place-items-center rounded-[12px] border border-(--line-4) text-ink-3 hover:bg-(--fill-ctl)"
          >
            <IconNotInterested size={16} />
          </button>
        </div>
      </div>
    </article>
  );
}

export default function MediaForYou({ kind }: { kind: Kind }) {
  const { data, error, isLoading } = useMediaRecs(kind);
  const recompute = useMediaMut(() => mediaApi.recompute(kind));
  useAmbientGlow(data?.items[0]?.palette[0] ?? null);
  const [, many] = MODES[kind].noun;
  const sub = data
    ? data.computing && !data.items.length
      ? "Finding suggestions…"
      : `learned from ${data.learned_from} ${many}${data.model ? ` · ${data.model === "lightgbm" ? "trained model" : "taste vector"}` : ""}${data.computing ? " · updating" : ""}`
    : " ";
  return (
    <main className={cx("flex flex-col gap-8 pt-9 pb-16 max-[1023px]:pt-7 max-[639px]:pt-5 max-[639px]:pb-24 box-border min-w-0", pagePad)}>
      <PageHeader title="For you" subline={sub}>
        <Button onClick={() => recompute.mutate(undefined)} disabled={recompute.isPending || data?.computing}>Refresh suggestions</Button>
      </PageHeader>
      {error && <ErrorLine error={error} />}
      {isLoading ? (
        <div className="skeleton h-[320px] rounded-[22px]" />
      ) : data && !data.items.length && !data.computing ? (
        <p className="m-0 py-20 text-center font-mono text-[13px] text-ink-3b">
          Finish or rate a few {many} and suggestions appear here. Dropping something teaches it too.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(420px,100%),1fr))] gap-4">
          {data?.items.map((r) => <RecCard key={r.id} r={r} kind={kind} />)}
        </div>
      )}
    </main>
  );
}
