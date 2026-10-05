import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useDeleteWatch } from "../api/hooks";
import { usePalette } from "../features/search/palette";
import { iso, rating as fmt, today } from "../lib/format";
import { IconCheck, IconClose } from "./Icons";
import { RatingInput } from "./Rating";
import { useToast } from "./Toasts";
import { cx } from "./ui";

export type QuickFilm = { tmdb_id: number; title: string; year: number | null; watch_count: number };

/**
 * One-click logging (design extension): a glass sheet that slides over the poster. Tapping a star saves a
 * watch for today (or yesterday) with that rating; "No rating" saves without one; "More…" opens the full form.
 */
export function QuickLog({ film, onClose, className }: { film: QuickFilm; onClose: () => void; className?: string }) {
  const [day, setDay] = useState<"today" | "yesterday">("today");
  const [rating, setRating] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const del = useDeleteWatch();
  const toast = useToast();
  const { openPalette } = usePalette();
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saved = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("[data-score='8']")?.focus();
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close.current();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      clearTimeout(timer.current);
      // refresh lists once the sheet is gone (a watchlist card disappears on refresh)
      if (saved.current) void qc.invalidateQueries();
    };
  }, [qc]); // once: callers pass onClose inline

  const save = async (r: number | null) => {
    setRating(r);
    const d = today();
    if (day === "yesterday") d.setDate(d.getDate() - 1);
    setSaving(true);
    try {
      const w = await api.logWatch({
        tmdb_id: film.tmdb_id, watched_on: iso(d), date_precision: "day", rating: r, is_rewatch: film.watch_count > 0,
        location: null, with_whom: null, notes: null,
      });
      saved.current = true;
      setDone(true);
      toast({
        text: <>Logged <em>{film.title}</em>{r != null && <span className="font-mono text-ink-star"> ★ {fmt(r)}</span>}</>,
        undo: () => del.mutate(w.id),
      });
      timer.current = setTimeout(() => close.current(), 900); // let the check land first
    } catch (e) {
      setSaving(false);
      toast({ text: e instanceof Error ? e.message : "Couldn't save" });
    }
  };

  return (
    <motion.div
      ref={ref}
      role="dialog"
      aria-label={`Log ${film.title}`}
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 16, opacity: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      onClick={(e) => e.preventDefault()}
      className={cx(
        "absolute inset-x-0 bottom-0 z-10 flex flex-col gap-2 p-[10px] rounded-b-[12px] bg-[rgba(10,12,17,0.86)] border-t border-(--line-4) backdrop-blur-[18px]",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.div key="done" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 520, damping: 18 }} className="flex flex-col items-center gap-1 py-3">
            <span className="size-10 rounded-full bg-accent text-on-accent grid place-items-center shadow-[0_0_24px_var(--color-accent)]">
              <IconCheck size={20} />
            </span>
            <span className="text-[12px] text-ink-2b">Logged</span>
          </motion.div>
        ) : (
          <motion.div key="form" exit={{ opacity: 0 }} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-1">
              <div role="group" aria-label="When" className="flex gap-[2px] p-[2px] rounded-[9px] bg-(--fill-input) border border-(--line-3)">
                {(["today", "yesterday"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={day === d}
                    onClick={() => setDay(d)}
                    className={cx("h-7 px-2 rounded-[7px] border-0 text-[11px] cursor-pointer capitalize", day === d ? "bg-ink text-on-accent" : "bg-transparent text-ink-2")}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <button type="button" aria-label="Close" onClick={onClose} className="size-7 grid place-items-center rounded-[8px] bg-transparent border-0 text-ink-3 cursor-pointer hover:text-ink">
                <IconClose size={14} />
              </button>
            </div>
            <div className="-my-1">
              <RatingInput compact hideLabel label={`Rate ${film.title}`} value={rating} onChange={(r) => r != null && !saving && save(r)} />
            </div>
            <div className="flex justify-between text-[11px]">
              <button type="button" disabled={saving} onClick={() => save(null)} className="h-7 bg-transparent border-0 p-0 text-ink-3 cursor-pointer underline-offset-2 hover:underline hover:text-ink">
                No rating
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  openPalette({ logFor: { tmdb_id: film.tmdb_id, title: film.title, year: film.year, watch_count: film.watch_count } });
                }}
                className="h-7 bg-transparent border-0 p-0 text-ink-3 cursor-pointer underline-offset-2 hover:underline hover:text-ink"
              >
                More…
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
