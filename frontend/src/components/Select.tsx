import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { IconCheck, IconChevronDown } from "./Icons";
import { cx } from "./ui";

type Option = { value: string; label: string };

/** A form select in the app's glass style. The list is a native popover, so it opens above dialogs (which clip
 * their contents), closes on Esc or a click outside, and never sits under the page. */
export function Select({ label, value, options, onChange, placeholder = "Choose…", className }: {
  label: string; value: string; options: Option[]; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    const p = pop.current;
    if (!p) return;
    const onToggle = (e: Event) => setOpen((e as ToggleEvent).newState === "open");
    p.addEventListener("toggle", onToggle);
    return () => p.removeEventListener("toggle", onToggle);
  }, []);

  useEffect(() => {
    if (!open) return;
    // the list is placed once; if the page moves under it, close it rather than leave it floating
    const close = (e: Event) => !pop.current?.contains(e.target as Node) && pop.current?.hidePopover();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    pop.current?.focus();
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  const show = () => {
    const b = btn.current, p = pop.current;
    if (!b || !p) return;
    p.showPopover();
    const r = b.getBoundingClientRect();
    const h = Math.min(p.scrollHeight, 320);
    const below = window.innerHeight - r.bottom;
    p.style.left = `${r.left}px`;
    p.style.minWidth = `${r.width}px`;
    p.style.top = `${below < h + 12 && r.top > below ? r.top - h - 6 : r.bottom + 6}px`;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
  };
  const pick = (v: string) => {
    onChange(v);
    pop.current?.hidePopover();
    btn.current?.focus();
  };
  const onListKey = (e: KeyboardEvent) => {
    const last = options.length - 1;
    const move: Record<string, number> = { ArrowDown: Math.min(active + 1, last), ArrowUp: Math.max(active - 1, 0), Home: 0, End: last };
    if (e.key in move) {
      e.preventDefault();
      setActive(move[e.key]);
    } else if ((e.key === "Enter" || e.key === " ") && options[active]) {
      e.preventDefault();
      pick(options[active].value);
    } else if (e.key === "Tab") {
      pop.current?.hidePopover();
    }
  };

  return (
    <div className={cx("flex flex-col gap-2 text-[12px] text-ink-3", className)}>
      <span id={`${id}-label`}>{label}</span>
      <button
        ref={btn} type="button" aria-haspopup="listbox" aria-expanded={open} aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => (open ? pop.current?.hidePopover() : show())}
        onKeyDown={(e) => {
          if (["ArrowDown", "ArrowUp"].includes(e.key)) {
            e.preventDefault();
            show();
          }
        }}
        className={cx(
          "h-11 w-full flex items-center justify-between gap-3 px-[14px] rounded-[12px] border bg-(--fill-input) text-[14px] text-left cursor-pointer",
          "outline-none focus-visible:outline-2 focus-visible:outline-accent hover:border-(--line-6)",
          open ? "border-(--line-6)" : "border-(--line-5)",
        )}
      >
        <span id={`${id}-value`} className={cx("truncate", current ? "text-ink-hi" : "text-ink-4")}>{current?.label ?? placeholder}</span>
        <IconChevronDown size={12} className={cx("shrink-0 text-ink-3 transition-transform duration-200 ease-[cubic-bezier(.2,.7,.2,1)]", open && "rotate-180")} />
      </button>
      <div
        ref={pop} popover="auto" role="listbox" tabIndex={-1} aria-labelledby={`${id}-label`}
        aria-activedescendant={open ? `${id}-${active}` : undefined} onKeyDown={onListKey}
        className="fixed inset-auto m-0 max-w-[min(360px,calc(100vw-32px))] max-h-[320px] overflow-y-auto p-2 rounded-[16px] bg-[rgba(20,22,30,0.92)] border border-(--line-4) backdrop-blur-[24px] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.8)] text-ink outline-none pop"
      >
        {options.map((o, i) => {
          const on = o.value === value;
          return (
            <div
              key={o.value} id={`${id}-${i}`} role="option" aria-selected={on}
              onClick={() => pick(o.value)} onMouseMove={() => setActive(i)}
              className={cx("h-11 flex items-center gap-[10px] px-3 rounded-[10px] text-[14px] cursor-pointer", i === active && "bg-(--fill-ctl)")}
            >
              <span className="flex-1 truncate">{o.label}</span>
              {on && <IconCheck size={14} className="shrink-0 text-accent" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
