import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useDesktop } from "./TitleBar";
import { cx } from "./ui";

const MIN_THUMB = 40;

/**
 * The desktop window's scrollbar (design extension): an overlay rail that takes no room from the page. It stays out of
 * sight until you scroll or reach for the right edge, then a slim accent pill slides in; hovering widens it, dragging
 * shows how far down you are, and clicking the track glides there.
 */
export function ScrollRail() {
  const on = useDesktop();
  const loc = useLocation();
  const rail = useRef<HTMLDivElement>(null);
  const [m, setM] = useState({ top: 0, size: 0, pct: 0, fits: true });
  const [awake, setAwake] = useState(false);
  const [near, setNear] = useState(false);
  const [drag, setDrag] = useState<{ y: number; scroll: number } | null>(null);
  const sleep = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!on) return;
    const body = document.body;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const h = rail.current?.clientHeight ?? 0;
      const { scrollTop, scrollHeight, clientHeight } = body;
      const range = scrollHeight - clientHeight;
      const size = Math.max(MIN_THUMB, (clientHeight / scrollHeight) * h);
      const pct = range > 0 ? scrollTop / range : 0;
      setM({ top: pct * (h - size), size, pct, fits: range <= 1 });
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
    const onMove = (e: PointerEvent) => setNear(window.innerWidth - e.clientX < 28);
    const ro = new ResizeObserver(schedule);
    ro.observe(document.getElementById("root")!);
    ro.observe(body);
    measure();
    body.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(sleep.current);
      ro.disconnect();
      body.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onMove);
    };
  }, [on, loc.pathname]);

  if (!on || m.fits) return null;
  const h = () => rail.current?.clientHeight ?? 1;
  const range = () => document.body.scrollHeight - document.body.clientHeight;
  const active = drag != null;
  const shown = awake || near || active;

  return (
    <div
      ref={rail}
      aria-hidden
      className={cx(
        "group fixed right-[5px] top-[calc(var(--tb)+6px)] bottom-[6px] z-[65] w-[14px] flex justify-end transition-opacity duration-300",
        shown ? "opacity-100" : "opacity-0",
      )}
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        // click the track: glide so the thumb centres on the pointer
        const y = e.clientY - e.currentTarget.getBoundingClientRect().top - m.size / 2;
        document.body.scrollTo({ top: (y / (h() - m.size)) * range(), behavior: "smooth" });
      }}
    >
      {/* the faint track only shows while you're reaching for it */}
      <div className={cx("absolute right-[3px] inset-y-0 w-px rounded-full bg-white/8 pointer-events-none transition-opacity", near || active ? "opacity-100" : "opacity-0")} />
      <div
        className={cx(
          "relative rounded-full cursor-default transition-[width,background-color,box-shadow] duration-200 ease-[cubic-bezier(.2,.7,.2,1)]",
          active || near ? "w-[7px]" : "w-[4px]",
          active
            ? "bg-accent shadow-[0_0_16px_color-mix(in_oklch,var(--color-accent)_70%,transparent)]"
            : "bg-[color-mix(in_oklch,var(--color-accent)_45%,rgba(255,255,255,0.35))] group-hover:bg-[color-mix(in_oklch,var(--color-accent)_75%,white)]",
        )}
        style={{ height: m.size, transform: `translateY(${m.top}px)` }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag({ y: e.clientY, scroll: document.body.scrollTop });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          document.body.scrollTop = drag.scroll + ((e.clientY - drag.y) / (h() - m.size)) * range();
        }}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
      >
        <span
          className={cx(
            "absolute right-[14px] top-1/2 -translate-y-1/2 px-2 py-[3px] rounded-[8px] font-mono text-[11px] tabular-nums whitespace-nowrap",
            "bg-[rgba(20,22,30,0.9)] border border-(--line-4) text-ink-2 backdrop-blur-[12px] pointer-events-none transition-opacity duration-150",
            active ? "opacity-100" : "opacity-0",
          )}
        >
          {Math.round(m.pct * 100)}%
        </span>
      </div>
    </div>
  );
}
