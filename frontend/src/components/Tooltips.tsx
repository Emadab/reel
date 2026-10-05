import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Tip = { text: string; x: number; y: number; below: boolean; host: Element };

/**
 * Replaces the browser's own tooltips everywhere: any element with `title` (or `data-tip`) gets a glass bubble in the
 * app's style after a short hover. The title moves to `data-tip` on first hover so the native one never appears.
 */
export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const find = (t: EventTarget | null) => {
      let el = t instanceof Element ? t : null;
      while (el && el !== document.body) {
        if (el.tagName !== "IFRAME" && el.hasAttribute("title") && el.getAttribute("title")) {
          el.setAttribute("data-tip", el.getAttribute("title")!);
          el.removeAttribute("title");
        }
        if (el.hasAttribute("data-tip")) return el;
        el = el.parentElement;
      }
      return null;
    };
    const show = (el: Element, delay: number) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) return;
        const below = r.top < 52;
        setTip({ text: el.getAttribute("data-tip") ?? "", x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below, host: el });
      }, delay);
    };
    const hide = () => {
      clearTimeout(timer.current);
      setTip(null);
    };
    const over = (e: PointerEvent) => {
      const el = find(e.target);
      if (el) show(el, 380);
      else hide();
    };
    const focus = (e: FocusEvent) => {
      const el = find(e.target);
      if (el && (e.target as Element).matches(":focus-visible")) show(el, 120);
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide);
    document.addEventListener("scroll", hide, true);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("scroll", hide, true);
    };
  }, []);

  // keep it on screen: clamp the bubble's centre between the edges
  const x = tip ? Math.min(window.innerWidth - 16, Math.max(16, tip.x)) : 0;
  // inside an open <dialog> the bubble must live in the dialog (top layer) to be seen
  const target = (tip?.host.closest("dialog[open]") as Element | null) ?? document.body;
  return createPortal(
    <AnimatePresence>
      {tip && (
        <motion.div
          key={tip.text + tip.x + tip.y}
          role="tooltip"
          initial={{ opacity: 0, y: tip.below ? -4 : 4, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ type: "spring", stiffness: 600, damping: 32 }}
          className="fixed z-[200] pointer-events-none max-w-[280px] px-[10px] py-[6px] rounded-[9px] text-[12px] leading-[1.4] text-ink bg-[rgba(18,20,27,0.94)] border border-(--line-4) backdrop-blur-[14px] shadow-[0_12px_30px_-12px_rgba(0,0,0,0.9)] [text-wrap:balance] text-center"
          style={{ left: x, top: tip.y, translate: `-50% ${tip.below ? "0" : "-100%"}` }}
        >
          {tip.text}
        </motion.div>
      )}
    </AnimatePresence>,
    target,
  );
}
