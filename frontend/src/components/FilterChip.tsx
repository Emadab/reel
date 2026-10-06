import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";
import { IconChevronDown } from "./Icons";
import { cx } from "./ui";

type Option = { value: string; label: string };

/** Dropdown chip (DESIGN_SYSTEM: Filter chip). Opens a glass popover of checkable 40 px rows. */
export function FilterChip({
  label, options, selected, onChange, multi = false, searchable = false, align = "left",
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (v: string[]) => void;
  multi?: boolean;
  searchable?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shown = options.filter((o) => o.label.toLowerCase().includes(filter.toLowerCase())).slice(0, 80);
  const toggle = (v: string) => {
    if (!multi) {
      onChange(selected[0] === v ? [] : [v]);
      setOpen(false);
      return;
    }
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          "flex items-center gap-[6px] h-10 px-[14px] rounded-[12px] border text-[13px] cursor-pointer whitespace-nowrap",
          selected.length && !label.startsWith("Sort") ? "border-(--line-6) bg-(--fill-ctl) text-ink" : "border-(--line-3) bg-[rgba(255,255,255,0.03)] text-ink-2",
        )}
      >
        {label}
        <IconChevronDown size={12} className={cx("transition-transform duration-200 ease-[cubic-bezier(.2,.7,.2,1)]", open && "rotate-180")} />
      </button>
      <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -4, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.18, ease: [0.2, 0.7, 0.2, 1] } }}
          exit={{ opacity: 0, y: -4, scale: 0.97, transition: { duration: 0.12, ease: "easeIn" } }}
          style={{ transformOrigin: align === "right" ? "top right" : "top left" }}
          className={cx(
            "absolute top-[calc(100%+6px)] z-30 min-w-[220px] max-w-[300px] p-2 rounded-[16px] bg-[rgba(20,22,30,0.92)] border border-(--line-4) backdrop-blur-[24px] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.8)]",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {searchable && (
            <input
              autoFocus
              aria-label={`Filter ${label.toLowerCase()}`}
              placeholder="Search…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full h-10 mb-1 px-3 rounded-[10px] border border-(--line-4) bg-(--fill-input) text-ink-hi text-[13px] box-border outline-none placeholder:text-ink-4"
            />
          )}
          <ul id={id} role="listbox" aria-multiselectable={multi} className="list-none m-0 p-0 max-h-[320px] overflow-y-auto">
            {shown.map((o) => {
              const on = selected.includes(o.value);
              return (
                <li key={o.value} role="option" aria-selected={on}>
                  <button
                    type="button"
                    onClick={() => toggle(o.value)}
                    className="w-full h-10 flex items-center gap-[10px] px-[10px] rounded-[10px] bg-transparent hover:bg-(--fill-ctl) border-0 text-[13px] text-left cursor-pointer text-ink"
                  >
                    <span
                      aria-hidden
                      className={cx("size-4 rounded-[5px] border grid place-items-center shrink-0", on ? "bg-accent border-accent" : "border-(--line-6)", !multi && "rounded-full")}
                    >
                      {on && <span className={cx("bg-on-accent", multi ? "w-2 h-[2px]" : "size-[6px] rounded-full")} />}
                    </span>
                    <span className="truncate">{o.label}</span>
                  </button>
                </li>
              );
            })}
            {!shown.length && <li className="px-[10px] py-3 text-[13px] text-ink-4">Nothing to filter yet</li>}
          </ul>
          {multi && selected.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="w-full h-10 mt-1 rounded-[10px] bg-transparent border-0 text-[13px] text-ink-3 hover:bg-(--fill-ctl) cursor-pointer">
              Clear
            </button>
          )}
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
