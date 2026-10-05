import { motion } from "framer-motion";
import { useId, useState, type KeyboardEvent } from "react";
import { IconStar } from "./Icons";

/**
 * Five stars. Click n → n, click n again → n − 0.5; ←/→ step 0.5; Backspace clears.
 * Hovering previews the rating; the chosen star pops.
 */
export function StarRating({
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
    if (e.key === "ArrowRight" || e.key === "ArrowUp") set(Math.min(5, r + 0.5), Math.ceil(Math.min(5, r + 0.5)));
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") set(r - 0.5 >= 0.5 ? r - 0.5 : null);
    else if (e.key === "Backspace" || e.key === "Delete") set(null);
    else return;
    e.preventDefault();
  };
  const w = compact ? 30 : 40;
  const icon = compact ? 22 : 26;
  return (
    <div className="flex flex-col gap-2">
      <span id={`${id}-l`} className={hideLabel ? "absolute w-px h-px overflow-hidden [clip-path:inset(50%)]" : "text-[12px] text-ink-3"}>
        {label}
        {value != null && ` · ${value.toFixed(1)}`}
      </span>
      <div role="group" aria-labelledby={`${id}-l`} className="flex gap-[2px]" onKeyDown={onKey} onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((n) => {
          const fill = shown >= n ? "100%" : shown >= n - 0.5 ? "50%" : "0%";
          const lit = fill !== "0%";
          return (
            <motion.button
              key={n}
              type="button"
              data-star={n}
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              aria-pressed={r >= n - 0.5}
              onClick={() => set(value === n ? n - 0.5 : n, n)}
              onMouseEnter={() => setHover(n)}
              whileTap={{ scale: 0.82 }}
              className="h-11 border-0 bg-transparent cursor-pointer p-0 grid place-items-center"
              style={{
                width: w,
                color: lit ? "var(--color-star-on)" : "var(--color-star-off)",
                opacity: hover != null && !lit ? 0.7 : 1,
                filter: lit ? "drop-shadow(0 0 6px rgba(245,216,138,0.35))" : undefined,
                transition: "color .12s, filter .2s, opacity .12s",
              }}
            >
              <motion.span
                key={popped?.n === n ? popped.k : 0}
                initial={popped?.n === n ? { scale: 1.35, rotate: -8 } : false}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 14 }}
                className="grid place-items-center"
              >
                <IconStar id={`${id}-s${n}`} fill={fill} size={icon} />
              </motion.span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
