import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useSettings } from "../api/hooks";
import { mediaApi, useNotifications, type Note } from "../api/media";
import { relativeTime } from "../lib/format";
import { IconBell } from "./Icons";
import { cx } from "./ui";

/** The notification centre (announcements flag): new episodes, seasons, releases. Hidden while the flag is off. */
export function NotificationBell() {
  const { data: settings } = useSettings();
  const on = !!settings?.flags?.announcements;
  const { data } = useNotifications(on);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const qc = useQueryClient();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!on) return null;
  const unseen = data?.unseen ?? 0;
  const seen = async (ids?: number[]) => {
    await mediaApi.seen(ids);
    void qc.invalidateQueries({ queryKey: ["media", "notifications"] });
  };
  const openNote = (n: Note) => {
    setOpen(false);
    if (!n.seen) void seen([n.id]);
    if (n.path) nav(n.path);
  };
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={unseen ? `Notifications, ${unseen} new` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx("relative size-11 rounded-[12px] border grid place-items-center", open ? "bg-(--fill-nav-active) border-(--line-4) text-ink-hi" : "border-(--line-1) text-ink-3 hover:bg-(--fill-ctl)")}
      >
        <IconBell size={18} />
        {unseen > 0 && (
          <motion.span key={unseen} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 600, damping: 30 }} className="absolute -right-1 -top-1 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-on-accent font-mono text-[10.5px] grid place-items-center shadow-[0_0_10px_var(--color-accent)]">
            {unseen > 9 ? "9+" : unseen}
          </motion.span>
        )}
      </button>
      <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.2, ease: [0.2, 0.7, 0.2, 1] } }}
          exit={{ opacity: 0, y: 6, scale: 0.97, transition: { duration: 0.12, ease: "easeIn" } }}
          style={{ transformOrigin: "bottom left" }}
          role="dialog" aria-label="Notifications" className="absolute left-0 bottom-[calc(100%+10px)] max-[1023px]:left-[calc(100%+10px)] max-[1023px]:bottom-0 z-40 w-[340px] max-h-[460px] flex flex-col rounded-[16px] bg-[rgba(20,22,30,0.94)] border border-(--line-4) backdrop-blur-[24px] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.8)] overflow-hidden">
          <div className="flex items-center justify-between px-4 h-12 border-b border-(--line-1)">
            <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-ink-3">Notifications</span>
            {unseen > 0 && (
              <button type="button" onClick={() => seen()} className="h-11 px-1 bg-transparent border-0 text-[12px] text-ink-3 hover:text-ink-hi">Mark all read</button>
            )}
          </div>
          <ol className="list-none m-0 p-2 overflow-y-auto scroll-quiet flex flex-col gap-[2px]">
            {!data?.items.length && <li className="px-3 py-6 font-mono text-[12px] text-ink-4 text-center">Nothing new yet</li>}
            {data?.items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openNote(n)}
                  className="w-full flex gap-3 items-start text-left px-3 py-[10px] min-h-11 rounded-[10px] bg-transparent border-0 hover:bg-(--fill-ctl)"
                >
                  <span className={cx("mt-[6px] size-[7px] rounded-full shrink-0", n.seen ? "bg-transparent" : "bg-accent shadow-[0_0_8px_var(--color-accent)]")} />
                  <span className="flex-1 min-w-0 flex flex-col gap-[3px]">
                    <span className="text-[14px] font-medium truncate">{n.title}</span>
                    <span className="text-[13px] text-ink-3">{n.text}</span>
                  </span>
                  <span className="font-mono text-[11px] text-ink-4 shrink-0">{relativeTime(n.created_at)}</span>
                </button>
              </li>
            ))}
          </ol>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
