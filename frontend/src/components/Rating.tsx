import { motion } from "framer-motion";
import { useId, useState, type KeyboardEvent } from "react";
import { rating } from "../lib/format";

const KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * A 0–10 rating as ten keys. Click n → n, click n again → n − 0.5; ←/→ step 0.5; Backspace clears.
 * Hovering previews the score; the chosen key pops. Imported decimals (7.7) fill the key partially.
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
  const [hover, setHover] = useState<number | null>(null);
  const [popped, setPopped] = useState<{ n: number; k: number } | null>(null);
  const r = value ?? 0;
  const shown = hover ?? r;
  const set = (v: number | null, n?: number) => {
    onChange(v);
    if (n) setPopped((p) => ({ n, k: (p?.k ?? 0) + 1 }));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") set(Math.min(10, r + 0.5), Math.ceil(Math.min(10, r + 0.5)));
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") set(r - 0.5 >= 0.5 ? r - 0.5 : null);
    else if (e.key === "Backspace" || e.key === "Delete") set(null);
    else return;
    e.preventDefault();
  };
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <span id={`${id}-l`} className={hideLabel ? "absolute w-px h-px overflow-hidden [clip-path:inset(50%)]" : "text-[12px] text-ink-3"}>
        {label}
        {value != null && <span className="text-ink-star"> · {rating(value)} / 10</span>}
      </span>
      <div role="group" aria-labelledby={`${id}-l`} className={compact ? "flex gap-[2px]" : "flex gap-[3px]"} onKeyDown={onKey} onMouseLeave={() => setHover(null)}>
        {KEYS.map((n) => {
          const fill = Math.max(0, Math.min(1, shown - (n - 1))) * 100;
          const lit = fill > 0;
          const preview = hover != null && hover !== r;
          return (
            <motion.button
              key={n}
              type="button"
              data-score={n}
              aria-label={`${n} out of 10`}
              aria-pressed={r >= n - 0.5}
              onClick={() => set(value === n ? n - 0.5 : n, n)}
              onMouseEnter={() => setHover(n)}
              onFocus={() => setHover(null)}
              whileTap={{ scale: 0.86, y: 1 }}
              className={compact ? "flex-1 min-w-0 h-11 p-0 border-0 bg-transparent cursor-pointer grid items-center" : "w-[30px] h-11 p-0 border-0 bg-transparent cursor-pointer grid items-center"}
            >
              <motion.span
                key={popped?.n === n ? popped.k : 0}
                initial={popped?.n === n ? { scale: 1.25, y: -3 } : false}
                animate={{ scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 520, damping: 15 }}
                className={`grid place-items-center rounded-[7px] font-mono font-medium tabular-nums ${compact ? "h-[28px] text-[10px]" : "h-[34px] text-[12px]"}`}
                style={{
                  background: lit
                    ? `linear-gradient(90deg, var(--color-star-on) ${fill}%, rgba(255,255,255,0.07) ${fill}%)`
                    : "rgba(255,255,255,0.07)",
                  boxShadow: lit
                    ? `inset 0 1px 0 rgba(255,255,255,0.35), 0 0 ${fill === 100 ? 12 : 6}px rgba(245,216,138,${preview ? 0.18 : 0.32})`
                    : "inset 0 1px 0 rgba(255,255,255,0.05), inset 0 0 0 1px rgba(255,255,255,0.06)",
                  color: fill >= 60 ? "var(--color-on-accent)" : "var(--color-ink-4)",
                  opacity: preview && lit ? 0.8 : 1,
                  transition: "background .12s, box-shadow .2s, color .12s, opacity .12s",
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
