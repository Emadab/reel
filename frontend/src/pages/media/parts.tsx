// Shared pieces for the show, book and game pages, built from Reel's existing components and tokens.
import { Link } from "react-router";
import type { ItemCard, Kind, Progress } from "../../api/media";
import type { PosterFilm } from "../../components/Poster";
import { Poster } from "../../components/Poster";
import { cx } from "../../components/ui";
import { rating } from "../../lib/format";
import { MODES, statusLabel } from "../../lib/mode";

/** Items reuse the movie Poster; negative ids keep their shared-layout ids apart from films. */
export const asFilm = (c: Pick<ItemCard, "id" | "title" | "year" | "poster" | "poster_sm" | "poster_art" | "palette">): PosterFilm => ({
  tmdb_id: -c.id, title: c.title, year: c.year, poster: c.poster, poster_sm: c.poster_sm, poster_art: c.poster_art, palette: c.palette,
});

export const itemPath = (c: { kind: Kind; id: number }) => `${MODES[c.kind].base}/${c.id}`;

/** 0–1 through the current run, or null when there's nothing to measure. */
export function fraction(kind: Kind, p: Progress): number | null {
  if (kind === "show") return p.aired ? (p.watched ?? 0) / p.aired : null;
  if (kind === "book") return p.total && p.current != null ? Math.min(p.current / p.total, 1) : null;
  return p.percent != null ? p.percent / 100 : null;
}

export function progressText(kind: Kind, p: Progress): string | null {
  if (kind === "show") return p.aired ? `${p.watched ?? 0} of ${p.aired} episodes` : null;
  if (kind === "book") {
    if (p.current == null) return null;
    if (p.unit === "percent") return `${Math.round(p.current)}%`;
    if (p.unit === "minutes") return `${Math.round(p.current)} of ${p.total ?? "?"} min`;
    return `p. ${Math.round(p.current)}${p.total ? ` of ${p.total}` : ""}`;
  }
  const h = p.hours != null ? `${+p.hours.toFixed(1)} h` : null;
  return [h, p.percent != null && `${Math.round(p.percent)}%`].filter(Boolean).join(" · ") || null;
}

/** A thin meter in the Scores style: 3 px, accent fill with a soft glow. */
export function Meter({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cx("block h-[3px] rounded-full bg-white/[0.07] overflow-hidden", className)} role="presentation">
      <span className="block h-full rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)] transition-[width] duration-700 ease-out" style={{ width: `${Math.round(value * 100)}%` }} />
    </span>
  );
}

/** Progress ring for the up-next rail. */
export function Ring({ value, size = 44, label }: { value: number; size?: number; label?: string }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative grid place-items-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={3} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-accent)" strokeWidth={3} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - value)} style={{ filter: "drop-shadow(0 0 4px var(--color-accent))", transition: "stroke-dashoffset .7s ease-out" }}
        />
      </svg>
      {label && <span className="absolute font-mono text-[10.5px] text-ink-2 tabular-nums">{label}</span>}
    </span>
  );
}

export function MediaCard({ item }: { item: ItemCard }) {
  const f = fraction(item.kind, item.progress);
  const active = item.status && !["completed", "finished", "beaten", "wishlist", "backlog"].includes(item.status);
  const sub = [statusLabel(item.kind, item.status), active ? progressText(item.kind, item.progress) : item.subtitle].filter(Boolean).join(" · ");
  return (
    <Link to={itemPath(item)} className="poster-card flex flex-col gap-[10px] no-underline text-inherit hover:text-inherit min-w-0">
      <div className="relative">
        <Poster film={asFilm(item)} size="wall" />
        {active && f != null && <Meter value={f} className="absolute inset-x-3 bottom-3 bg-[rgba(7,8,12,0.55)]" />}
      </div>
      <div className="flex justify-between items-baseline gap-2">
        <span className="text-[14px] font-medium truncate">{item.title}</span>
        {item.my_rating != null && <span className="font-mono text-[12px] text-ink-star shrink-0">★ {rating(item.my_rating)}</span>}
      </div>
      <span className="mt-[-6px] text-[12px] text-ink-4 truncate">{sub}</span>
    </Link>
  );
}

export const wallGrid = "grid grid-cols-[repeat(auto-fill,minmax(min(150px,100%),1fr))] gap-x-5 gap-y-8 max-[639px]:grid-cols-2 max-[639px]:gap-x-3 max-[639px]:gap-y-5";
export const pagePad = "px-12 max-[1023px]:px-6 max-[639px]:px-4";
