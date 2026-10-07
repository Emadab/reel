import { motion } from "framer-motion";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ComponentProps, type ReactNode } from "react";
import { Link } from "react-router";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cx("font-mono text-[11px] border border-(--line-5) rounded-[6px] px-[6px] py-[2px] leading-[normal]", className)}>
      {children}
    </kbd>
  );
}

export function VisuallyHidden({ children, ...p }: ComponentProps<"span">) {
  return (
    <span {...p} className="absolute w-px h-px overflow-hidden [clip-path:inset(50%)] whitespace-nowrap">
      {children}
    </span>
  );
}

const primary = "flex items-center gap-2 h-11 px-[18px] rounded-[14px] bg-accent text-on-accent font-semibold text-[14px] cursor-pointer border-0 whitespace-nowrap disabled:opacity-60 disabled:cursor-default no-underline";
const secondary = "flex items-center gap-2 h-11 px-[18px] rounded-[14px] border border-(--line-5) bg-(--fill-ctl) text-ink text-[14px] cursor-pointer hover:bg-white/10 whitespace-nowrap no-underline";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary"; hero?: boolean };
export function Button({ variant = "secondary", hero, className, type = "button", ...p }: BtnProps) {
  return <button type={type} {...p} className={cx(variant === "primary" ? primary : secondary, hero && "h-[46px]", className)} />;
}

export function ButtonLink({ variant = "secondary", className, ...p }: ComponentProps<typeof Link> & { variant?: "primary" | "secondary" }) {
  return <Link {...p} className={cx(variant === "primary" ? primary : secondary, className)} />;
}

export function IconButton({ label, on, shrink, className, children, type = "button", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; on?: boolean; shrink?: boolean }) {
  return (
    <button
      type={type}
      aria-label={label}
      {...p}
      className={cx(
        "size-11 rounded-[12px] border grid place-items-center cursor-pointer",
        !shrink && "shrink-0",
        on ? "bg-accent border-accent text-on-accent" : "border-(--line-4) bg-transparent text-ink hover:bg-white/10",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Segmented control: outer pad 4 / gap 4 / radius 14; items 36 tall, radius 10, 13px. */
export function Segmented<T extends string>({
  label, value, options, onChange, variant = "default", className,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  variant?: "default" | "form";
  className?: string;
}) {
  const form = variant === "form";
  const pill = useId();
  return (
    <div
      role="group"
      aria-label={label}
      className={cx("flex gap-1 p-1 rounded-[14px] border", form ? "bg-(--fill-input) border-(--line-3)" : "bg-(--fill-ctl) border-(--line-1)", className)}
    >
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            className={cx(
              "relative isolate px-[14px] border-0 rounded-[10px] text-[13px] cursor-pointer whitespace-nowrap bg-transparent",
              form ? "h-[34px]" : "h-9",
              on ? (form ? "text-on-accent" : "text-ink-hi") : cx(form ? "text-ink-2 hover:text-ink" : "text-ink-3 hover:text-ink-2"),
            )}
          >
            {/* the selection slides to the pressed option */}
            {on && <motion.span layoutId={pill} aria-hidden className={cx("absolute inset-0 -z-10 rounded-[10px]", form ? "bg-ink" : "bg-(--fill-seg-active)")} transition={{ type: "spring", stiffness: 560, damping: 42 }} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function PillTab({ on, label, count, onClick }: { on: boolean; label: string; count?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={cx(
        "h-10 px-4 rounded-full text-[14px] cursor-pointer border",
        on ? "bg-ink border-ink text-on-accent" : "bg-transparent border-(--line-4) text-ink-2",
      )}
    >
      {label}{" "}
      {count != null && <span className="font-mono text-[12px] opacity-70">{count.toLocaleString("en-US")}</span>}
    </button>
  );
}

export function TagChip({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return (
    <span className={cx("h-[30px] box-content flex items-center px-3 rounded-full border text-[13px]", strong ? "border-(--line-5) text-ink-2" : "border-(--line-4) text-ink-2b")}>
      {children}
    </span>
  );
}

export function MonoTag({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11px] px-2 py-[3px] rounded-[6px] bg-(--fill-tag) text-ink-2b">{children}</span>;
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11px] px-[9px] py-1 rounded-full border border-(--line-6) text-ink-2 whitespace-nowrap">{children}</span>;
}

export function Eyebrow({ children, className, style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <span className={cx("font-mono text-[11px] tracking-[0.1em] text-ink-3 uppercase", className)} style={style}>
      {children}
    </span>
  );
}

type PanelVariant = "glass" | "card" | "tile" | "outline" | "hero";
const panel: Record<PanelVariant, string> = {
  glass: "rounded-[22px] bg-(--fill-glass) border border-(--line-2) backdrop-blur-[24px] p-6",
  card: "rounded-[22px] bg-(--fill-card) border border-(--line-1) p-[18px]",
  tile: "rounded-[20px] bg-(--fill-glass) border border-(--line-2) p-[22px]",
  outline: "rounded-[22px] border border-(--line-2)",
  hero: "rounded-[26px] bg-(--fill-glass) border border-(--line-3) backdrop-blur-[24px] p-7",
};
export function Panel({ variant = "glass", className, ...p }: ComponentProps<"section"> & { variant?: PanelVariant }) {
  return <section {...p} className={cx(panel[variant], className)} />;
}

export function PageHeader({ title, subline, children, className }: { title: ReactNode; subline?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <header className={cx("flex flex-wrap items-end justify-between gap-5", className)}>
      <div className="flex flex-col gap-2 min-w-0">
        <h1 className="m-0 font-display font-semibold text-[40px] max-[639px]:text-[30px] tracking-[-0.01em]">{title}</h1>
        {subline != null && <p className="m-0 font-mono text-[13px] text-ink-3b">{subline}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </header>
  );
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx("m-0 font-display font-medium text-[18px]", className)}>{children}</h2>;
}

export function TextInput({ label, hideLabel = true, className, ...p }: ComponentProps<"input"> & { label: string; hideLabel?: boolean }) {
  const id = p.id ?? `in-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      {hideLabel ? <label htmlFor={id} className="absolute w-px h-px overflow-hidden [clip-path:inset(50%)]">{label}</label> : <label htmlFor={id} className="text-[12px] text-ink-3">{label}</label>}
      <input
        id={id}
        {...p}
        className="h-11 px-[14px] rounded-[12px] border border-(--line-4) bg-(--fill-input) text-ink-hi text-[14px] [color-scheme:dark] placeholder:text-ink-4 outline-none focus-visible:outline-2 focus-visible:outline-accent"
      />
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <p className="m-0 font-mono text-[13px] text-ink-4 animate-pulse">{label}…</p>;
}

export function ErrorLine({ error, onSettings }: { error: unknown; onSettings?: boolean }) {
  const msg = error instanceof Error ? error.message : "Something went wrong";
  return (
    <p className="m-0 font-mono text-[13px] text-wild">
      {msg}
      {onSettings && /token|settings/i.test(msg) && (
        <>
          {" "}
          <Link to="/settings" className="text-wild underline">Open settings</Link>
        </>
      )}
    </p>
  );
}

const introPlayed = new Set<string>();
/** True for the first ~1 s after `key`'s wall first has content this session: posters stagger in once, never on
 *  filter changes or on coming back (where they'd hide the poster morphing home). */
export function useIntro(key: string, ready: boolean) {
  const [on, setOn] = useState(() => !introPlayed.has(key));
  useEffect(() => {
    if (!on || !ready) return;
    introPlayed.add(key);
    const t = setTimeout(() => setOn(false), 1000);
    return () => clearTimeout(t);
  }, [key, on, ready]);
  return on && ready;
}

/**
 * Cards that arrive pop in one after another (design extension): every card on a wall's first visit this session,
 * then each batch that paging adds, counted from the batch's own first card. Coming back renders the wall still,
 * so the poster can morph home. Returns props for each card's wrapper.
 */
export function usePop(key: string, count: number) {
  const intro = useIntro(key, count > 0);
  const s = useRef<{ first: number; starts: number[]; seen: number } | null>(null);
  if (!s.current && count > 0) s.current = { first: intro ? 0 : count, starts: [intro ? 0 : count], seen: count };
  else if (s.current && count !== s.current.seen) {
    if (count > s.current.seen) s.current.starts.push(s.current.seen);
    else s.current.starts = s.current.starts.filter((b) => b < count);
    s.current.seen = count;
  }
  const { first = Infinity, starts = [] } = s.current ?? {};
  return (i: number): { className: string; style?: CSSProperties } => {
    const start = starts.findLast((b) => b <= i);
    if (i < first || start == null) return { className: "min-w-0" };
    return { className: "min-w-0 card-pop", style: { "--pop": Math.min(i - start, 24) } as CSSProperties };
  };
}

const windowShown = new Map<string, number>();
/**
 * Seamless paging for a wall that's already in memory: renders `step` more cards each time the sentinel comes
 * within 1200 px of the viewport, and remembers how far you got so coming back restores the same scroll.
 */
export function useWindowed<T>(key: string, items: T[], step = 48) {
  const [shown, setShown] = useState(() => windowShown.get(key) ?? step);
  const sentinel = useRef<HTMLDivElement>(null);
  const more = items.length > shown;
  useEffect(() => {
    windowShown.set(key, shown);
  }, [key, shown]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setShown((n) => n + step), { rootMargin: "1200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more, step, shown]);
  return { visible: more ? items.slice(0, shown) : items, sentinel, more };
}

