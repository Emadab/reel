import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { cx } from "./ui";

// Exposed by backend/desktop.py (class Chrome) on the frameless desktop window.
type Chrome = {
  minimize(): Promise<void>;
  toggle_maximize(): Promise<boolean>;
  is_maximized(): Promise<boolean>;
  close(): Promise<void>;
  drag(hit: number): Promise<void>;
};
const chrome = () => (window as Window & { pywebview?: { api?: Partial<Chrome> } }).pywebview?.api as Chrome | undefined;

// Win32 hit-test codes: Windows runs the real move/resize loop (snap, multi-monitor, cursor)
const HT = { caption: 2, left: 10, right: 11, top: 12, topLeft: 13, topRight: 14, bottom: 15, bottomLeft: 16, bottomRight: 17 };
const EDGES: [number, string][] = [
  [HT.top, "top-0 inset-x-2 h-1 cursor-ns-resize"],
  [HT.bottom, "bottom-0 inset-x-2 h-1 cursor-ns-resize"],
  [HT.left, "left-0 inset-y-2 w-1 cursor-ew-resize"],
  [HT.right, "right-0 inset-y-2 w-1 cursor-ew-resize"],
  [HT.topLeft, "top-0 left-0 size-2 cursor-nwse-resize"],
  [HT.topRight, "top-0 right-0 size-2 cursor-nesw-resize"],
  [HT.bottomLeft, "bottom-0 left-0 size-2 cursor-nesw-resize"],
  [HT.bottomRight, "bottom-0 right-0 size-2 cursor-nwse-resize"],
];

/** True inside the desktop window (pywebview), where the page draws its own title bar and scroll rail. */
export function useDesktop() {
  const [on, setOn] = useState(() => document.documentElement.dataset.desktop === "1");
  useEffect(() => {
    const ready = () => setOn(true);
    window.addEventListener("pywebviewready", ready);
    return () => window.removeEventListener("pywebviewready", ready);
  }, []);
  return on;
}

function Ctl({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      onClick={onClick}
      className="group w-11 h-full grid place-items-center border-0 bg-transparent p-0 text-ink-3 cursor-default"
    >
      <span
        className={cx(
          "size-[30px] grid place-items-center rounded-[9px] transition-[background-color,color,box-shadow] duration-150",
          "group-hover:text-ink-hi group-active:scale-[.92]",
          danger
            ? "group-hover:bg-[#E5484D] group-hover:shadow-[0_6px_18px_-6px_#E5484D]"
            : "group-hover:bg-(--fill-ctl) group-hover:shadow-[inset_0_0_0_1px_var(--line-3)]",
        )}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" aria-hidden>
          {children}
        </svg>
      </span>
    </button>
  );
}

/**
 * The desktop window's own title bar (design extension). It floats over the page: the sidebar and the page's glow
 * run up under it. Once the page scrolls, a soft fading blur settles in and the page's title takes the centre.
 */
export function TitleBar() {
  const on = useDesktop();
  const [max, setMax] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const loc = useLocation();

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const sync = () => void chrome()?.is_maximized?.().then(setMax);
    const ready = sync;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(sync, 100);
    };
    if (chrome()?.is_maximized) sync();
    window.addEventListener("pywebviewready", ready);
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pywebviewready", ready);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // the page heading moves into the bar once it scrolls out of view
  useEffect(() => {
    if (!on) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      setScrolled(document.body.scrollTop > 4);
      const h1 = document.querySelector("main h1");
      const r = h1?.getBoundingClientRect();
      setTitle(h1 && r && r.bottom < 44 ? h1.textContent : null);
    };
    const onScroll = () => {
      frame ||= requestAnimationFrame(check);
    };
    check();
    document.body.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.body.removeEventListener("scroll", onScroll);
    };
  }, [on, loc.pathname]);

  if (!on) return null;
  const toggle = () => void chrome()?.toggle_maximize().then(setMax);
  const grab = (hit: number) => (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    if (hit === HT.caption && e.detail === 2) toggle();
    else void chrome()?.drag(hit);
  };

  return (
    <>
      <header onMouseDown={grab(HT.caption)} className="fixed top-0 inset-x-0 z-[60] h-(--tb) flex items-stretch justify-end select-none">
        {/* progressive blur: dense at the top edge, gone by the bottom, so content dissolves under the controls */}
        <div
          aria-hidden
          className={cx(
            "absolute inset-x-0 top-0 h-[64px] pointer-events-none bg-[rgba(7,8,12,0.62)] backdrop-blur-[18px] transition-opacity duration-300",
            "[mask-image:linear-gradient(to_bottom,black_45%,transparent)]",
            scrolled ? "opacity-100" : "opacity-0",
          )}
        />
        <span
          aria-hidden
          className={cx(
            "absolute left-1/2 top-1/2 max-w-[40%] truncate font-display font-semibold text-[13px] tracking-[0.01em] text-ink-2 pointer-events-none",
            "transition-[opacity,transform] duration-300 ease-[cubic-bezier(.2,.7,.2,1)]",
            title ? "opacity-100 -translate-x-1/2 -translate-y-1/2" : "opacity-0 -translate-x-1/2 -translate-y-[10%]",
          )}
        >
          {title}
        </span>
        <div className="relative flex items-stretch pr-1">
          <Ctl label="Minimize" onClick={() => void chrome()?.minimize()}>
            <path d="M1 5.5h8" />
          </Ctl>
          <Ctl label={max ? "Restore" : "Maximize"} onClick={toggle}>
            {max ? (
              <>
                <rect x="1" y="3" width="6" height="6" rx="1.2" />
                <path d="M3 1.5h4.3A1.2 1.2 0 0 1 8.5 2.7V7" />
              </>
            ) : (
              <rect x="1" y="1" width="8" height="8" rx="1.8" />
            )}
          </Ctl>
          <Ctl label="Close" danger onClick={() => void chrome()?.close()}>
            <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
          </Ctl>
        </div>
      </header>
      {!max && EDGES.map(([hit, pos]) => <div key={hit} aria-hidden onMouseDown={grab(hit)} className={cx("fixed z-[70]", pos)} />)}
    </>
  );
}
