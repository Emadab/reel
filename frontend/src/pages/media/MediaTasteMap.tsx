import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useMediaMap, type Kind, type MapPoint } from "../../api/media";
import { Poster } from "../../components/Poster";
import { PageHeader, cx } from "../../components/ui";
import { rating } from "../../lib/format";
import { MODES, statusLabel } from "../../lib/mode";
import { pagePad } from "./parts";

/**
 * Your shows, books or games laid out by similarity (UMAP of the same text embeddings the suggestions use).
 * Filled dots are yours, sized by rating; rings are suggestions. Every dot is a link.
 */
export default function MediaTasteMap({ kind }: { kind: Kind }) {
  const { data, isLoading } = useMediaMap(kind);
  const nav = useNavigate();
  const [hovered, setHover] = useState<MapPoint | null>(null);
  const pts = data?.points ?? [];
  const focus = Number(useSearchParams()[0].get("focus")) || null; // from a detail page's "Open taste map"
  const focused = pts.find((p) => p.id === focus) ?? null;
  const hover = hovered ?? focused;
  const mine = pts.filter((p) => p.kind === "mine").length;
  return (
    <main className={cx("flex flex-col gap-7 pt-9 pb-16 max-[1023px]:pt-7 max-[639px]:pt-5 max-[639px]:pb-24 box-border min-w-0", pagePad)}>
      <PageHeader title="Taste map" subline={data ? `${mine} of your ${MODES[kind].noun[1]} · ${pts.length - mine} suggestions` : " "}>
        <div className="flex gap-[18px] text-[12px] text-ink-3">
          <span className="flex items-center gap-2"><span className="size-3 rounded-full bg-accent" />yours</span>
          <span className="flex items-center gap-2"><span className="size-3 rounded-full box-border border-[1.5px] border-accent" />suggested</span>
        </div>
      </PageHeader>
      {isLoading ? (
        <div className="skeleton h-[560px] rounded-[24px]" />
      ) : pts.length < 2 ? (
        <p className="m-0 py-20 text-center font-mono text-[13px] text-ink-3b">The map draws itself once you have a few {MODES[kind].noun[1]} and suggestions. Open For you to start them.</p>
      ) : (
        <section aria-label="Taste map" className="relative h-[620px] max-[639px]:h-[460px] rounded-[24px] bg-bg-map border border-(--line-2) overflow-hidden">
          <div aria-hidden className="absolute inset-0 opacity-40" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
          <svg className="absolute inset-0 size-full" role="img" aria-label={`${pts.length} points`}>
            {pts.map((p) => {
              const r = p.kind === "mine" ? 6 + Math.max(0, (p.rating ?? 6) - 5) * 1.6 : 6;
              return (
                <a key={p.id} href={`${MODES[kind].base}/${p.id}`} aria-label={p.title}
                  onClick={(e) => { e.preventDefault(); nav(`${MODES[kind].base}/${p.id}`); }}
                  onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover((h) => (h?.id === p.id ? null : h))} onFocus={() => setHover(p)}>
                  <circle cx={`${p.x * 100}%`} cy={`${p.y * 100}%`} r={r + 12} fill="transparent" />
                  {p.id === focus && <circle cx={`${p.x * 100}%`} cy={`${p.y * 100}%`} r={r + 7} fill="none" stroke="white" strokeWidth={1.5} opacity={0.85} />}
                  {p.kind === "mine" ? (
                    <circle cx={`${p.x * 100}%`} cy={`${p.y * 100}%`} r={r} fill={p.color ?? "var(--color-accent)"} stroke="#0A0C11" strokeWidth={2}
                      style={{ filter: `drop-shadow(0 0 6px ${p.color ?? "var(--color-accent)"})` }} />
                  ) : (
                    <circle cx={`${p.x * 100}%`} cy={`${p.y * 100}%`} r={r} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} opacity={0.4 + (p.score ?? 0.5) * 0.6} />
                  )}
                </a>
              );
            })}
          </svg>
          {hover && (
            <Link
              to={`${MODES[kind].base}/${hover.id}`}
              className="absolute z-10 flex items-center gap-3 p-3 pr-4 rounded-[14px] bg-[rgba(20,22,30,0.92)] border border-(--line-4) backdrop-blur-[24px] no-underline text-ink pointer-events-none"
              style={{ left: `min(calc(${hover.x * 100}% + 14px), calc(100% - 300px))`, top: `min(calc(${hover.y * 100}% + 14px), calc(100% - 92px))` }}
            >
              <Poster film={{ tmdb_id: -hover.id, title: hover.title, poster_sm: hover.poster }} size="thumb" className="w-9" layout={false} />
              <span className="flex flex-col gap-[3px] max-w-[220px]">
                <span className="text-[14px] font-medium truncate">{hover.title}</span>
                <span className="font-mono text-[11px] text-ink-3">
                  {hover.kind === "mine"
                    ? [statusLabel(kind, hover.status ?? null), hover.rating != null && `★ ${rating(hover.rating)}`].filter(Boolean).join(" · ")
                    : `Suggested · ${Math.round((hover.score ?? 0) * 100)}%`}
                </span>
              </span>
            </Link>
          )}
        </section>
      )}
    </main>
  );
}
