import { AnimatePresence, motion } from "framer-motion";
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { rating } from "../lib/format";

const KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const tenth = (v: number) => Math.min(10, Math.max(0.1, Math.round(v * 10) / 10));

/**
 * A 0–10 rating as ten keys. Tap n → n (tap again → n − 0.5). Drag across the keys to scrub in tenths, with a live
 * readout; ←/→ step 0.1 (Shift: 1); Backspace clears. Decimals fill the last key partially.
 */
export function RatingInput({
  value, onChange, label = "Rating", compact = false, hideLabel = false,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  label?: string;
  compact?: boolean;
  hideLabel?: boolean;
}) {
  const id = useId();
  const row = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; id: number } | null>(null);
  const swallowClick = useRef(false);
  const [hover, setHover] = useState<number | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [popped, setPopped] = useState<{ n: number; k: number } | null>(null);
  const r = value ?? 0;
  const shown = scrub ?? hover ?? r;
  const set = (v: number | null, n?: number) => {
    onChange(v);
    if (n) setPopped((p) => ({ n, k: (p?.k ?? 0) + 1 }));
  };
  const at = (clientX: number) => {
    const b = row.current!.getBoundingClientRect();
    return tenth(((clientX - b.left) / b.width) * 10);
  };

  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 0.1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      const v = tenth(r + step);
      set(v, Math.ceil(v));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") set(r - step >= 0.1 ? tenth(r - step) : null);
    else if (e.key === "Backspace" || e.key === "Delete") set(null);
    else return;
    e.preventDefault();
  };
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    swallowClick.current = false; // a drag's click can land on the row (pointer capture), not a key: never carry it over
    press.current = { x: e.clientX, id: e.pointerId };
  };
  const onMove = (e: PointerEvent) => {
    const p = press.current;
    if (!p) return;
    if (scrub == null && Math.abs(e.clientX - p.x) < 5) return; // still a tap
    if (scrub == null) row.current!.setPointerCapture(p.id);
    setScrub(at(e.clientX));
  };
  const onUp = () => {
    press.current = null;
    if (scrub == null) return;
    swallowClick.current = true; // the click that follows a drag isn't a tap
    set(scrub, Math.ceil(scrub));
    setScrub(null);
  };

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <span id={`${id}-l`} className={hideLabel ? "absolute w-px h-px overflow-hidden [clip-path:inset(50%)]" : "flex items-baseline gap-2 text-[12px] text-ink-3"}>
        <span>
          {label}
          {value != null && <span className="text-ink-star"> · {rating(value)} / 10</span>}
        </span>
        {!compact && <span className="font-mono text-[10.5px] text-ink-4">drag for tenths</span>}
      </span>
      <div
        ref={row}
        role="group"
        aria-labelledby={`${id}-l`}
        className={`relative flex touch-none ${compact ? "gap-[2px]" : "gap-[3px] w-fit"} ${scrub != null ? "cursor-ew-resize [&_*]:cursor-ew-resize" : ""}`}
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => ((press.current = null), setScrub(null))}
        onMouseLeave={() => setHover(null)}
      >
        {/* live readout while scrubbing */}
        <AnimatePresence>
          {scrub != null && (
            <motion.span
              key="readout"
              initial={{ opacity: 0, y: 6, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 520, damping: 26 }}
              className="absolute bottom-[calc(100%+6px)] -translate-x-1/2 z-10 px-[10px] py-[5px] rounded-[10px] font-display font-semibold text-[17px] tabular-nums pointer-events-none text-on-accent bg-(--color-star-on) shadow-[0_8px_24px_-8px_rgba(245,216,138,0.8)]"
              style={{ left: `${(scrub / 10) * 100}%` }}
            >
              {rating(scrub)}
            </motion.span>
          )}
        </AnimatePresence>
        {KEYS.map((n) => {
          const fill = Math.max(0, Math.min(1, shown - (n - 1))) * 100;
          const lit = fill > 0;
          const preview = (hover != null && hover !== r) || scrub != null;
          const under = scrub != null && Math.ceil(scrub) === n;
          return (
            <motion.button
              key={n}
              type="button"
              data-score={n}
              aria-label={`${n} out of 10`}
              aria-pressed={r >= n - 0.5}
              onClick={() => {
                if (swallowClick.current) return void (swallowClick.current = false);
                set(value === n ? n - 0.5 : n, n);
              }}
              onMouseEnter={() => scrub == null && setHover(n)}
              onFocus={() => setHover(null)}
              whileTap={scrub == null ? { scale: 0.86, y: 1 } : undefined}
              className={compact ? "flex-1 min-w-0 h-11 p-0 border-0 bg-transparent cursor-pointer grid items-center" : "w-[30px] h-11 p-0 border-0 bg-transparent cursor-pointer grid items-center"}
            >
              <motion.span
                key={popped?.n === n ? popped.k : 0}
                initial={popped?.n === n ? { scale: 1.25, y: -3 } : false}
                animate={under ? { scale: 1.12, y: -3 } : { scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 520, damping: 15 }}
                className={`grid place-items-center rounded-[7px] font-mono font-medium tabular-nums ${compact ? "h-[28px] text-[10px]" : "h-[34px] text-[12px]"}`}
                style={{
                  background: lit
                    ? `linear-gradient(90deg, var(--color-star-on) ${fill}%, rgba(255,255,255,0.07) ${fill}%)`
                    : "rgba(255,255,255,0.07)",
                  boxShadow: lit
                    ? `inset 0 1px 0 rgba(255,255,255,0.35), 0 0 ${fill === 100 ? 12 : 6}px rgba(245,216,138,${preview ? 0.2 : 0.32})`
                    : "inset 0 1px 0 rgba(255,255,255,0.05), inset 0 0 0 1px rgba(255,255,255,0.06)",
                  color: fill >= 60 ? "var(--color-on-accent)" : "var(--color-ink-4)",
                  opacity: preview && lit && scrub == null ? 0.8 : 1,
                  transition: "box-shadow .2s, color .12s, opacity .12s",
                }}
              >
                {n}
              </motion.span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
