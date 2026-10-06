import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A native modal <dialog>: the browser traps focus, makes the page inert, closes on Esc and returns focus to
 * the trigger. Styling follows the command palette (scrim blur 10 px + rgba(4,5,8,.62)). Closing fades the panel
 * and scrim out (120 ms) before the dialog leaves the top layer; the last content stays on screen meanwhile.
 */
export function Dialog({
  open, onClose, label, children, className, top = 72,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  className?: string;
  top?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const shown = useRef(children);
  if (open) shown.current = children;
  const [leaving, setLeaving] = useState(false);
  const exit = useRef<Animation[]>([]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open) {
      exit.current.forEach((a) => a.cancel()); // reopened mid-exit
      exit.current = [];
      setLeaving(false);
      if (!d.open) {
        d.showModal();
        // showModal() moves focus to the dialog itself; put it in the first field so typing works at once
        requestAnimationFrame(() => d.querySelector<HTMLElement>("input, textarea, button")?.focus());
      }
      return;
    }
    if (!d.open) return;
    if (reduced()) return void d.close();
    setLeaving(true);
    const opts = { duration: 120, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" } as const;
    exit.current = [
      d.animate([{ opacity: 1, scale: 1 }, { opacity: 0, scale: 0.98 }], opts),
      d.animate([{ opacity: 1 }, { opacity: 0 }], { ...opts, pseudoElement: "::backdrop" }),
    ];
    void Promise.all(exit.current.map((a) => a.finished)).then(
      () => {
        d.close();
        exit.current.forEach((a) => a.cancel());
        exit.current = [];
        setLeaving(false);
      },
      () => {}, // cancelled by a reopen
    );
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose(); // click on the scrim
      }}
      className={cx("reel-dialog", className)}
      style={{ marginTop: top }}
    >
      {(open || leaving) && shown.current}
    </dialog>
  );
}
