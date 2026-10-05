import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "./ui";

/**
 * A native modal <dialog>: the browser traps focus, makes the page inert, closes on Esc and returns focus to
 * the trigger. Styling follows the command palette (scrim blur 10 px + rgba(4,5,8,.62)).
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
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // showModal() moves focus to the dialog itself; put it in the first field so typing works at once
      requestAnimationFrame(() => d.querySelector<HTMLElement>("input, textarea, button")?.focus());
    }
    if (!open && d.open) d.close();
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
      {open && children}
    </dialog>
  );
}
