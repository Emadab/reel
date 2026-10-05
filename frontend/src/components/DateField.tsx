import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { DatePrecision } from "../api/types";
import { iso, today } from "../lib/format";
import { IconChevronLeft, IconChevronRight } from "./Icons";
import { cx } from "./ui";

type View = "days" | "months" | "years";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const parse = (s: string) => new Date(`${s}T00:00:00`);
const label = (s: string, p: DatePrecision) => {
  const d = parse(s);
  if (p === "year") return String(d.getFullYear());
  if (p === "month") return LONG.format(d);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
};

/**
 * The watch date (design extension): a field that opens a calendar in the app's own style instead of the browser's.
 * Day precision shows days, month shows months, year shows years; nothing in the future can be picked.
 */
export function DateField({ id, value, precision, onChange, className }: {
  id: string; value: string; precision: DatePrecision; onChange: (iso: string) => void; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const first: View = precision === "day" ? "days" : precision === "month" ? "months" : "years";
  const [view, setView] = useState<View>(first);
  const [cursor, setCursor] = useState(() => parse(value)); // the day/month/year with keyboard focus
  const [dir, setDir] = useState(0);
  const now = today();

  useEffect(() => {
    if (!open) return;
    setView(first);
    setCursor(parse(value));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current!.getBoundingClientRect();
      const h = panel.current?.offsetHeight ?? 340;
      const below = r.bottom + 8 + h < window.innerHeight;
      setPos({ left: Math.min(r.left, window.innerWidth - 316), top: below ? r.bottom + 8 : Math.max(8, r.top - 8 - h) });
    };
    place();
    const close = (e: MouseEvent) => !panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    document.addEventListener("mousedown", close);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
      document.removeEventListener("mousedown", close);
    };
  }, [open, view]);

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLButtonElement>("[data-cursor='true']")?.focus();
  }, [open, view, cursor]);

  const pick = (d: Date) => {
    onChange(iso(d));
    setOpen(false);
    btn.current?.focus();
  };
  const shiftMonth = (n: number) => {
    setDir(n);
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, Math.min(c.getDate(), 28)));
  };
  const future = (d: Date) => d > now;

  const onKey = (e: KeyboardEvent) => {
    const c = cursor;
    const move = (d: Date) => {
      if (d.getMonth() !== c.getMonth() || d.getFullYear() !== c.getFullYear()) setDir(d > c ? 1 : -1);
      setCursor(d);
    };
    const step = view === "days" ? { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } : view === "months" ? { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 } : { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 };
    if (e.key === "Escape") {
      setOpen(false);
      btn.current?.focus();
    } else if (e.key in step) {
      const n = step[e.key as keyof typeof step];
      if (view === "days") move(new Date(c.getFullYear(), c.getMonth(), c.getDate() + n));
      else if (view === "months") move(new Date(c.getFullYear(), c.getMonth() + n, 1));
      else move(new Date(c.getFullYear() + n, 0, 1));
    } else if (e.key === "PageUp" || e.key === "PageDown") shiftMonth(e.key === "PageUp" ? -1 : 1);
    else return;
    e.preventDefault();
    e.stopPropagation(); // Escape must not close the dialog around us
  };

  const sel = parse(value);
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const cell = (on: boolean, isNow: boolean, off: boolean) =>
    cx(
      "relative grid place-items-center rounded-[10px] border-0 text-[13px] tabular-nums cursor-pointer transition-[background-color,color,box-shadow] duration-150 outline-none",
      "focus-visible:shadow-[inset_0_0_0_1.5px_var(--color-accent)] active:scale-[.9]",
      on ? "bg-accent text-on-accent font-semibold shadow-[0_6px_18px_-6px_var(--color-accent)]" : "bg-transparent text-ink-2 hover:bg-(--fill-ctl) hover:text-ink-hi",
      isNow && !on && "text-accent shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-accent)_55%,transparent)]",
      off && "!text-ink-4/40 !bg-transparent cursor-not-allowed shadow-none",
    );

  let grid: React.ReactNode;
  if (view === "days") {
    const lead = (new Date(y, m, 1).getDay() + 6) % 7;
    const count = new Date(y, m + 1, 0).getDate();
    grid = (
      <div className="grid grid-cols-7 gap-[2px]">
        {DAYS.map((d) => <span key={d} className="h-7 grid place-items-center font-mono text-[10.5px] text-ink-4">{d}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: count }, (_, i) => {
          const d = new Date(y, m, i + 1);
          const off = future(d);
          return (
            <button
              key={i}
              type="button"
              disabled={off}
              data-cursor={d.getDate() === cursor.getDate()}
              tabIndex={d.getDate() === cursor.getDate() ? 0 : -1}
              aria-pressed={iso(d) === value}
              aria-label={d.toDateString()}
              onClick={() => pick(d)}
              className={cx(cell(iso(d) === value, iso(d) === iso(now), off), "h-9")}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    );
  } else if (view === "months") {
    grid = (
      <div className="grid grid-cols-3 gap-[6px]">
        {MONTHS.map((name, i) => {
          const d = new Date(y, i, 1);
          const off = future(d);
          return (
            <button
              key={name}
              type="button"
              disabled={off}
              data-cursor={i === m}
              tabIndex={i === m ? 0 : -1}
              onClick={() => (precision === "month" ? pick(d) : (setCursor(new Date(y, i, Math.min(cursor.getDate(), 28))), setView("days")))}
              className={cx(cell(sel.getFullYear() === y && sel.getMonth() === i, now.getFullYear() === y && now.getMonth() === i, off), "h-12")}
            >
              {name}
            </button>
          );
        })}
      </div>
    );
  } else {
    const start = Math.floor(y / 12) * 12;
    grid = (
      <div className="grid grid-cols-3 gap-[6px]">
        {Array.from({ length: 12 }, (_, i) => start + i).map((yr) => {
          const off = yr > now.getFullYear() || yr < 1900;
          return (
            <button
              key={yr}
              type="button"
              disabled={off}
              data-cursor={yr === y}
              tabIndex={yr === y ? 0 : -1}
              onClick={() => (precision === "year" ? pick(new Date(yr, 0, 1)) : (setCursor(new Date(yr, m, 1)), setView("months")))}
              className={cx(cell(sel.getFullYear() === yr, now.getFullYear() === yr, off), "h-12")}
            >
              {yr}
            </button>
          );
        })}
      </div>
    );
  }

  const title = view === "days" ? LONG.format(cursor) : view === "months" ? String(y) : `${Math.floor(y / 12) * 12} – ${Math.floor(y / 12) * 12 + 11}`;
  const page = (n: number) => {
    setDir(n);
    if (view === "days") shiftMonth(n);
    else setCursor(new Date(y + n * (view === "months" ? 1 : 12), m, 1));
  };
  const host = (btn.current?.closest("dialog[open]") as Element | null) ?? document.body;

  return (
    <>
      <button
        ref={btn}
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          "flex items-center gap-3 text-left cursor-pointer hover:border-(--line-6)",
          open && "border-[color-mix(in_oklch,var(--color-accent)_60%,transparent)]! shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-accent)_14%,transparent)]",
          className,
        )}
      >
        <span className="flex-1 tabular-nums whitespace-nowrap">{label(value, precision)}</span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="text-ink-3 shrink-0" aria-hidden>
          <rect x="2" y="3" width="12" height="11" rx="2.5" />
          <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" strokeLinecap="round" />
        </svg>
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={panel}
              role="dialog"
              aria-label="Choose a date"
              onKeyDown={onKey}
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1 } }}
              transition={{ type: "spring", stiffness: 520, damping: 34 }}
              className="fixed z-[150] w-[300px] p-3 rounded-[18px] bg-[rgba(18,20,27,0.96)] border border-(--line-4) backdrop-blur-[24px] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.9)] text-ink origin-top"
              style={{ left: pos.left, top: pos.top }}
            >
              <div className="flex items-center gap-1 mb-2">
                <button
                  type="button"
                  onClick={() => setView(view === "days" ? "months" : "years")}
                  disabled={view === "years"}
                  className="flex-1 h-9 px-2 rounded-[10px] bg-transparent border-0 text-left font-display font-medium text-[14px] text-ink cursor-pointer hover:bg-(--fill-ctl) disabled:cursor-default disabled:hover:bg-transparent"
                >
                  {title}
                </button>
                <button type="button" aria-label="Previous" onClick={() => page(-1)} className="size-9 grid place-items-center rounded-[10px] bg-transparent border-0 text-ink-3 cursor-pointer hover:bg-(--fill-ctl) hover:text-ink-hi">
                  <IconChevronLeft size={16} />
                </button>
                <button type="button" aria-label="Next" onClick={() => page(1)} className="size-9 grid place-items-center rounded-[10px] bg-transparent border-0 text-ink-3 cursor-pointer hover:bg-(--fill-ctl) hover:text-ink-hi">
                  <IconChevronRight size={16} />
                </button>
              </div>
              <div className="overflow-hidden">
                <AnimatePresence mode="popLayout" initial={false} custom={dir}>
                  <motion.div
                    key={`${view}-${view === "days" ? `${y}-${m}` : view === "months" ? y : Math.floor(y / 12)}`}
                    custom={dir}
                    initial={{ opacity: 0, x: dir * 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: dir * -24 }}
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  >
                    {grid}
                  </motion.div>
                </AnimatePresence>
              </div>
              {precision === "day" && (
                <div className="flex gap-2 mt-3 pt-3 border-t border-(--line-2)">
                  {[["Today", 0], ["Yesterday", 1]].map(([t, off]) => {
                    const d = new Date(now);
                    d.setDate(d.getDate() - (off as number));
                    return (
                      <button key={t} type="button" onClick={() => pick(d)} className="h-8 px-3 rounded-[9px] bg-(--fill-ctl) border border-(--line-3) text-[12px] text-ink-2 cursor-pointer hover:text-ink-hi hover:border-(--line-5)">
                        {t}
                      </button>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        host,
      )}
    </>
  );
}
