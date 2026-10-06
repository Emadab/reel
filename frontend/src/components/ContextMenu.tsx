import { motion } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./ui";

export type MenuEntry =
  | { label: ReactNode; onSelect: () => void; danger?: boolean; keepOpen?: boolean }
  | "sep";
export type MenuAt = { x: number; y: number };

/** Right-click (or the context-menu key) on a card: open at the pointer. */
export function useContextMenu() {
  const [at, setAt] = useState<MenuAt | null>(null);
  const onContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault();
    setAt({ x: e.clientX, y: e.clientY });
  };
  return { at, onContextMenu, close: () => setAt(null) };
}

/**
 * A card's context menu (design extension), in the glass vocabulary of the detail page's menus: opens at the
 * pointer, stays inside the window, arrow keys move between rows, Esc / click outside / scroll closes it.
 */
export function ContextMenu({ at, title, items, onClose }: { at: MenuAt; title: string; items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(at.x, innerWidth - r.width - 8)), y: Math.max(8, Math.min(at.y, innerHeight - r.height - 8)) });
  }, [at, items.length]);

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const shut = () => close.current();
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && shut();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        back?.focus({ preventScroll: true });
        return shut();
      }
      if (e.key === "Tab") return e.preventDefault();
      const rows = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
      const i = rows.indexOf(document.activeElement as HTMLButtonElement);
      const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: rows.length - 1 }[e.key];
      if (to == null || !rows.length) return;
      e.preventDefault();
      rows[(to + rows.length) % rows.length].focus();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("contextmenu", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", shut, true);
    window.addEventListener("resize", shut);
    window.addEventListener("blur", shut);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("contextmenu", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", shut, true);
      window.removeEventListener("resize", shut);
      window.removeEventListener("blur", shut);
    };
  }, []);

  return createPortal(
    <motion.div
      ref={ref}
      role="menu"
      aria-label={title}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.12 }}
      style={{ left: pos.x, top: pos.y, transformOrigin: "top left" }}
      className="fixed z-50 w-[260px] p-2 rounded-[16px] bg-[rgba(20,22,30,0.92)] border border-(--line-4) backdrop-blur-[24px] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.8)]"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation(); // portal events bubble to the card, which would reopen the menu
      }}
    >
      <div className="px-3 pt-1 pb-2 font-mono text-[11px] tracking-[0.08em] uppercase text-ink-4 truncate">{title}</div>
      {items.map((it, i) =>
        it === "sep" ? (
          <div key={i} role="separator" className="h-px my-1 mx-2 bg-(--line-3)" />
        ) : (
          <button
            key={i}
            role="menuitem"
            type="button"
            onClick={() => {
              it.onSelect();
              if (!it.keepOpen) onClose();
            }}
            className={cx(
              "w-full h-11 flex items-center gap-2 px-3 rounded-[10px] bg-transparent hover:bg-(--fill-ctl) focus-visible:bg-(--fill-ctl) border-0 text-[14px] text-left cursor-pointer outline-none",
              it.danger ? "text-wild" : "text-ink",
            )}
          >
            {it.label}
          </button>
        ),
      )}
    </motion.div>,
    document.body,
  );
}
