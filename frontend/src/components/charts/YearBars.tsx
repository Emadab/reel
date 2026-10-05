import { useEffect, useRef } from "react";
import type { YearBar } from "../../api/types";
import { mix } from "../Glow";

/** Every year: stacked exact (solid) and approximate (dashed) segments, scaled to 132 px. */
export function YearBars({ years, selected, onPick }: { years: YearBar[]; selected: number; onPick: (y: number) => void }) {
  const max = Math.max(1, ...years.map((y) => y.total));
  const many = years.length > 13;
  const box = useRef<HTMLDivElement>(null);
  // with a long history, keep the selected year in view
  useEffect(() => {
    const el = box.current;
    const btn = el?.querySelector<HTMLElement>("[aria-pressed='true']");
    if (el && btn) el.scrollLeft = btn.offsetLeft - el.clientWidth / 2 + btn.offsetWidth / 2; // horizontal only
  }, [selected, years.length]);
  return (
    <div ref={box} className={many ? "overflow-x-auto scroll-quiet -mx-1 px-1 pb-1" : undefined}>
      <div
        className="grid gap-2 items-end min-w-0"
        style={{ gridTemplateColumns: many ? `repeat(${years.length}, minmax(52px, 1fr))` : `repeat(13, minmax(0, 1fr))` }}
      >
        {years.map((y) => {
          const on = y.year === selected;
          const accent = "var(--color-accent)";
          return (
            <button
              key={y.year}
              type="button"
              aria-pressed={on}
              aria-label={`${y.year}: ${y.total} watches, ${y.approx} with approximate dates`}
              onClick={() => onPick(y.year)}
              className="flex flex-col items-stretch gap-2 py-2 px-1 rounded-[12px] cursor-pointer text-ink border hover:bg-(--fill-ctl)"
              style={{ borderColor: on ? "rgba(255,255,255,0.16)" : "transparent", background: on ? "rgba(255,255,255,0.06)" : undefined }}
            >
              <span className="font-mono text-[11px] text-center text-ink-2">{y.total}</span>
              <span className="flex flex-col justify-end h-[140px] gap-[2px]">
                {y.approx > 0 && (
                  <span
                    className="rounded-[4px_4px_0_0] box-border"
                    style={{ border: `1.5px dashed ${on ? accent : mix(accent, 55, "#07080C")}`, height: Math.round((y.approx / max) * 132) }}
                  />
                )}
                <span className="rounded-[2px]" style={{ height: Math.round(((y.total - y.approx) / max) * 132), background: on ? accent : mix(accent, 45, "#07080C") }} />
              </span>
              <span className="font-mono text-[12px] text-center">{y.year}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
