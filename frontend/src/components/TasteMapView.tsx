import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { num, pct, rating } from "../lib/format";
import { ErrorLine, PageHeader, cx } from "./ui";

/** One dot on a taste map, whatever the medium. */
export type MapDot = {
  id: number;
  title: string;
  x: number;
  y: number;
  kind: "mine" | "suggested" | "candidate";
  rating?: number | null;
  color?: string;
  bg?: string;
  poster?: string | null;
  score?: number;
  is_wildcard?: boolean;
  alpha?: number;
};
export type MapData = { count: number; points: MapDot[]; clusters: { label: string; x: number; y: number }[]; default_selected: number | null };
/** The side panel's subject: a suggestion, a candidate or one of yours. */
export type MapSubject = { id: number; title: string; meta: string; score: number | null; my_rating: number | null; wild: boolean; saved: boolean };
export type MapExplain = { subject: MapSubject; nearest: { id: number; title: string; my_rating: number | null; similarity: number }[]; note: string };

/** What differs between films, shows, books and games; everything else is the same map. */
export type MapCopy = {
  noun: string; // "film"
  nouns: string; // "films"
  mine: string; // "watched": legend and side panel label
  forYou: string; // the For you route
  save: string; // "Add to watchlist"
};

type View = { x: number; y: number; k: number };
const WILD = "var(--color-wild)";
const ACCENT = "var(--color-accent)";

function clampView(v: View, w: number, h: number): View {
  const k = Math.min(6, Math.max(1, v.k));
  return { k, x: Math.min(0, Math.max(w * (1 - k), v.x)), y: Math.min(0, Math.max(h * (1 - k), v.y)) };
}

function usePanZoom(ref: React.RefObject<HTMLElement | null>) {
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      setView((v) => {
        const k = Math.min(6, Math.max(1, v.k * Math.exp(-e.deltaY * 0.0015)));
        return clampView({ k, x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k) }, r.width, r.height);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref]);

  const handlers = {
    onPointerDown: (e: RPointerEvent) => {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      drag.current = { x: e.clientX, y: e.clientY, moved: 0 };
    },
    onPointerMove: (e: RPointerEvent) => {
      const el = ref.current;
      if (!el || !pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const r = el.getBoundingClientRect();
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2 - r.left;
        const cy = (a.y + b.y) / 2 - r.top;
        if (pinch.current) {
          const f = dist / pinch.current;
          setView((v) => {
            const k = Math.min(6, Math.max(1, v.k * f));
            return clampView({ k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) }, r.width, r.height);
          });
        }
        pinch.current = dist;
        return;
      }
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      d.moved += Math.abs(dx) + Math.abs(dy);
      if (d.moved > 4) {
        if (!el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
        setView((v) => clampView({ ...v, x: v.x + dx, y: v.y + dy }, r.width, r.height));
      }
    },
    onPointerUp: (e: RPointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
      setTimeout(() => (drag.current = null), 0);
    },
    onDoubleClick: () => setView({ x: 0, y: 0, k: 1 }),
  };
  const wasDrag = () => (drag.current?.moved ?? 0) > 4;
  return { view, setView, handlers, wasDrag };
}

/** Greedy label placement: highest-priority labels first, skip any that would overlap one already placed. */
function placeLabels(points: MapDot[], view: View, size: { w: number; h: number }, priority: (p: MapDot) => number): Map<number, number> {
  type Rect = { x0: number; y0: number; x1: number; y1: number; id?: number };
  const hit = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const visible = points.filter((p) => p.kind !== "candidate");
  const at = (p: MapDot) => [p.x * size.w * view.k + view.x, p.y * size.h * view.k + view.y];
  // every marker is an obstacle for every other label
  const markers: Rect[] = visible.map((p) => {
    const [cx, cy] = at(p);
    const half = p.kind === "suggested" ? 9 : Math.max(6, 12 + ((p.rating ?? 6) / 2 - 3) * 6) / 2 + 1;
    return { x0: cx - half, y0: cy - half * (p.kind === "suggested" ? 1 : 1.5), x1: cx + half, y1: cy + half * (p.kind === "suggested" ? 1 : 1.5), id: p.id };
  });
  const placed: Rect[] = [{ x0: 0, y0: size.h - 34, x1: 300, y1: size.h }]; // the "drag to pan" hint
  const shown = new Map<number, number>(); // id -> horizontal nudge (px) that keeps the label inside the map
  for (const p of [...visible].sort((a, b) => priority(b) - priority(a))) {
    const important = priority(p) >= 500; // selection, its neighbours and suggestions may sit over posters
    const [cx, cy] = at(p);
    let dx = 0;
    const w = p.title.length * (p.kind === "suggested" ? 6.6 : 6) + 6;
    const top = cy + (p.kind === "suggested" ? 14 : 12);
    const r = { x0: cx - w / 2, y0: top, x1: cx + w / 2, y1: top + 15 };
    if (r.x0 < 4 || r.x1 > size.w - 4 || r.y0 < 0 || r.y1 > size.h - 4) {
      if (!important) continue; // would be clipped
      dx = r.x0 < 4 ? 4 - r.x0 : r.x1 > size.w - 4 ? size.w - 4 - r.x1 : 0;
      r.x0 += dx;
      r.x1 += dx;
    }
    if (placed.some((q) => hit(r, q)) || (!important && markers.some((m) => m.id !== p.id && hit(r, m)))) continue;
    placed.push(r);
    shown.set(p.id, dx);
  }
  return shown;
}

function candidateAlpha(p: MapDot): number {
  return p.alpha ?? 0.12 + (Math.abs(p.id * 2654435761) % 18) / 100;
}

/**
 * The taste map for every medium: what you've had (poster tiles sized by your rating), the current suggestions
 * (rings, pink for wildcards) and the unseen candidates (faint dots), laid out by the embeddings the
 * recommender uses, with labelled clusters and a side panel that explains any suggestion.
 */
export function TasteMapView(props: {
  data: MapData | undefined;
  error: unknown;
  isLoading: boolean;
  explain: MapExplain | undefined;
  selected: number | null;
  onSelect: (id: number) => void;
  copy: MapCopy;
  href: (id: number) => string;
  poster: (s: MapSubject) => ReactNode;
  onSave: (s: MapSubject) => void;
}) {
  const { data, error, isLoading, copy, href } = props;
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [showCand, setShowCand] = useState(true);
  const focus = Number(sp.get("focus")) || null;
  const mapRef = useRef<HTMLElement>(null);
  const { view, setView, handlers, wasDrag } = usePanZoom(mapRef);
  const [size, setSize] = useState({ w: 800, h: 700 });
  const [hovered, setHovered] = useState<number | null>(null);
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sel = props.selected;
  const explain = props.explain;
  const byId = useMemo(() => new Map((data?.points ?? []).map((p) => [p.id, p])), [data]);
  const selPoint = sel != null ? byId.get(sel) : undefined;
  const nearIds = useMemo(() => new Set((explain?.nearest ?? []).map((n) => n.id)), [explain]);
  const labelled = useMemo(
    () =>
      placeLabels(data?.points ?? [], view, size, (p) =>
        p.id === sel ? 1000 : nearIds.has(p.id) ? 900 : p.kind === "suggested" ? 500 + (p.score ?? 0) * 100 : (p.rating ?? 0) * 10,
      ),
    [data, view, size, sel, nearIds],
  );
  const groups = useMemo(() => {
    const pts = data?.points ?? [];
    return { mine: pts.filter((p) => p.kind === "mine"), suggested: pts.filter((p) => p.kind === "suggested"), candidates: pts.filter((p) => p.kind === "candidate") };
  }, [data]);

  // ?focus=:id centres the map on that point at 2×
  useEffect(() => {
    const p = focus != null ? byId.get(focus) : undefined;
    const el = mapRef.current;
    if (!p || !el) return;
    const { width: w, height: h } = el.getBoundingClientRect();
    const k = 2;
    setView(clampView({ k, x: w / 2 - p.x * w * k, y: h / 2 - p.y * h * k }, w, h));
  }, [focus, byId, setView]);

  const subject = explain?.subject;
  const label = selPoint?.kind === "mine" ? copy.mine.toUpperCase() : subject?.wild ? "WILDCARD" : selPoint?.kind === "candidate" ? "CANDIDATE" : "SUGGESTED";
  const selColor = subject?.wild ? WILD : ACCENT;
  const inv = 1 / view.k;

  return (
    <main className="flex flex-col gap-6 pt-9 px-12 pb-12 max-[1023px]:pt-7 max-[1023px]:px-6 max-[639px]:pt-5 max-[639px]:px-4 max-[639px]:pb-24 box-border min-w-0">
      <PageHeader title="Taste map" subline={data ? `UMAP of ${num(data.count)} ${copy.noun} embeddings · overview + keywords + genres` : " "}>
        <div className="flex flex-wrap gap-[18px] items-center text-[13px] text-ink-2b">
          <span className="flex items-center gap-2">
            <span className="w-3 h-[18px] rounded-[3px] bg-[#C46A2F] shadow-[0_0_10px_#C46A2F]" />
            {copy.mine} (size = your rating)
          </span>
          <span className="flex items-center gap-2">
            <span className="size-3 rounded-full box-border border-2 border-accent" />
            suggested
          </span>
          <label className="flex items-center gap-2 h-11 cursor-pointer">
            <input type="checkbox" checked={showCand} onChange={(e) => setShowCand(e.target.checked)} className="size-[18px] accent-accent" />
            <span className="flex items-center gap-2">
              <span className="size-[6px] rounded-full bg-[rgba(255,255,255,0.4)]" />
              unseen candidates
            </span>
          </label>
        </div>
      </PageHeader>

      {error ? <ErrorLine error={error} /> : null}
      <div className="flex flex-wrap gap-4 items-stretch">
        <section
          ref={mapRef}
          aria-label="Taste map. Drag to pan, scroll to zoom, double-click to reset."
          {...handlers}
          className="flex-[999_1_520px] min-w-0 relative h-[700px] max-[639px]:h-[520px] rounded-[24px] overflow-hidden bg-bg-map bg-[radial-gradient(rgba(255,255,255,0.06)_1px,transparent_1px)] bg-size-[28px_28px] border border-(--line-2) touch-none select-none cursor-grab active:cursor-grabbing"
        >
          {isLoading && <div className="absolute inset-0 skeleton" />}
          {data && data.points.length === 0 && (
            <p className="absolute inset-0 grid place-items-center m-0 px-8 text-center font-mono text-[13px] text-ink-4">
              The map appears once a few {copy.nouns} are logged and their embeddings are computed.
            </p>
          )}
          <div className="absolute inset-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
            {data?.clusters.map((c) => (
              <span
                key={c.label}
                className="absolute font-mono text-[11px] tracking-[0.14em] text-[rgba(236,238,243,0.5)] whitespace-nowrap pointer-events-none"
                style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, transform: `translate(-50%, -50%) scale(${inv})` }}
              >
                {c.label}
              </span>
            ))}

            {showCand &&
              groups.candidates.map((p) => (
                <span
                  key={p.id}
                  title={p.title || undefined}
                  className="absolute size-[5px] rounded-full"
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: `translate(-50%, -50%) scale(${inv})`, background: `rgba(255,255,255,${candidateAlpha(p)})` }}
                />
              ))}

            <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full pointer-events-none">
              {selPoint &&
                (explain?.nearest ?? []).map((n) => {
                  const q = byId.get(n.id);
                  return q ? (
                    <line key={q.id} x1={selPoint.x * 100} y1={selPoint.y * 100} x2={q.x * 100} y2={q.y * 100} stroke={selColor} strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
                  ) : null;
                })}
            </svg>

            {groups.mine.map((p) => {
              const w = Math.round(12 + ((p.rating ?? 6) / 2 - 3) * 6);
              const tip = `${p.title}${p.rating != null ? ` · ★ ${rating(p.rating)}` : ""}`;
              return (
                <Link
                  key={p.id}
                  to={href(p.id)}
                  title={tip}
                  aria-label={`${p.title}, your rating ${rating(p.rating)}`}
                  onClick={(e) => wasDrag() && e.preventDefault()}
                  draggable={false}
                  onMouseEnter={() => setHovered(p.id)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(p.id)}
                  onBlur={() => setHovered(null)}
                  className="absolute flex flex-col items-center gap-[5px] no-underline hover:z-10 focus-visible:z-10"
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: `translate(-50%, -50%) scale(${inv})` }}
                >
                  <span
                    className="block rounded-[3px] bg-cover bg-center"
                    style={{
                      width: Math.max(w, 6), height: Math.round(Math.max(w, 6) * 1.5), backgroundColor: p.bg ?? p.color,
                      backgroundImage: p.poster ? `url(${p.poster})` : undefined, backgroundSize: "cover",
                      boxShadow: `0 0 18px ${p.color ?? p.bg}, 0 0 0 1px rgba(255,255,255,0.18)`,
                    }}
                  />
                  {(labelled.has(p.id) || hovered === p.id) && (
                    <span className="text-[11px] whitespace-nowrap" style={{ color: nearIds.has(p.id) ? "#FFFFFF" : "rgba(236,238,243,0.62)", transform: `translateX(${labelled.get(p.id) ?? 0}px)` }}>{p.title}</span>
                  )}
                </Link>
              );
            })}

            {groups.suggested.map((p) => {
              const on = p.id === sel;
              const color = p.is_wildcard ? WILD : ACCENT;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-label={`${p.title}, suggested, ${pct(p.score)} chance you rate it 4 or more`}
                  aria-pressed={on}
                  title={`${p.title} · ${pct(p.score)}`}
                  onClick={() => !wasDrag() && props.onSelect(p.id)}
                  onMouseEnter={() => setHovered(p.id)}
                  onMouseLeave={() => setHovered(null)}
                  className="group absolute size-11 p-0 border-0 bg-transparent cursor-pointer grid place-items-center focus-visible:outline-white focus-visible:rounded-full"
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: `translate(-50%, -50%) scale(${inv})` }}
                >
                  {on && <span className="pulse-ring absolute size-4 rounded-full border-2" style={{ borderColor: color }} />}
                  <span className="size-4 rounded-full box-border border-2 transition-transform duration-250 group-hover:scale-125" style={{ borderColor: color, background: on ? color : "rgba(7,8,12,0.6)" }} />
                  {(labelled.has(p.id) || hovered === p.id) && (
                    <span className="absolute top-[38px] text-[12px] font-medium whitespace-nowrap" style={{ color, transform: `translateX(${labelled.get(p.id) ?? 0}px)` }}>{p.title}</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="absolute left-[18px] bottom-4 font-mono text-[11px] text-ink-4 pointer-events-none">drag to pan · scroll to zoom</div>
        </section>

        <aside className="flex-[1_1_280px] min-w-0 flex flex-col gap-[18px] p-6 rounded-[24px] bg-(--fill-glass) border border-(--line-2) backdrop-blur-[24px] box-border">
          {!subject || !explain ? (
            <p className="m-0 font-mono text-[13px] text-ink-4">{sel == null ? "Select a suggestion on the map." : "Loading…"}</p>
          ) : (
            <>
              <span className="font-mono text-[11px] tracking-[0.12em]" style={{ color: selColor }}>{label}</span>
              <div className="flex gap-[14px] items-start">
                <Link to={href(subject.id)} aria-label={subject.title} className="w-16 shrink-0">
                  {props.poster(subject)}
                </Link>
                <div className="flex flex-col gap-[6px] min-w-0">
                  <h2 className="m-0 font-display font-medium text-[20px] leading-[1.15]">
                    <Link to={href(subject.id)} className="no-underline">{subject.title}</Link>
                  </h2>
                  <span className="text-[13px] text-ink-3">{subject.meta}</span>
                  {subject.score != null && <span className="font-mono text-[13px]" style={{ color: selColor }}>{pct(subject.score)} chance of 4+</span>}
                  {subject.score == null && subject.my_rating != null && <span className="font-mono text-[13px] text-ink-star">★ {rating(subject.my_rating)}</span>}
                </div>
              </div>
              {explain.nearest.length > 0 && (
                <div className="flex flex-col gap-3">
                  <h3 className="m-0 text-[13px] font-medium text-ink-2b">Closest {copy.nouns} you rated</h3>
                  <ol className="list-none m-0 p-0 flex flex-col gap-3">
                    {explain.nearest.map((n) => (
                      <li key={n.id} className="grid grid-cols-[1fr_auto] gap-x-[10px] gap-y-[5px] items-baseline">
                        <span className="text-[14px] min-w-0 truncate">
                          {n.title} {n.my_rating != null && <span className="font-mono text-[12px] text-ink-star">★ {rating(n.my_rating)}</span>}
                        </span>
                        <span className="font-mono text-[12px] text-ink-3">cos {n.similarity.toFixed(2)}</span>
                        <span className="col-span-full h-1 rounded-[4px] bg-(--fill-tag)">
                          <span className="block h-1 rounded-[4px]" style={{ width: `${Math.round(Math.max(0, n.similarity) * 100)}%`, background: selColor }} />
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <p className="m-0 text-[13px] leading-[1.5] text-ink-3">{explain.note}</p>
              <div className={cx("flex flex-col gap-2 mt-auto")}>
                {selPoint?.kind !== "mine" && !subject.saved && (
                  <button type="button" onClick={() => props.onSave(subject)} className="h-11 border-0 rounded-[12px] bg-accent text-on-accent font-semibold text-[14px] cursor-pointer">
                    {copy.save}
                  </button>
                )}
                <button type="button" onClick={() => nav(copy.forYou)} className="h-11 box-content grid place-items-center rounded-[12px] border border-(--line-5) bg-transparent text-ink text-[14px] cursor-pointer">
                  Back to For you
                </button>
              </div>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
