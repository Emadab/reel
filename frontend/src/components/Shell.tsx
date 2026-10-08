import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, type ComponentType } from "react";
import { NavLink, useLocation, useOutlet } from "react-router";
import { CommandPalette, EditWatchDialog } from "../features/search/CommandPalette";
import { usePalette } from "../features/search/palette";
import { trackPath } from "../lib/history";
import { MODES, useMode, type Mode } from "../lib/mode";
import { AmbientGlow } from "./Glow";
import { useSettings } from "../api/hooks";
import { IconCalendar, IconForYou, IconLibrary, IconSearch, IconSettings, IconStats, IconTasteMap, IconTimeline } from "./Icons";
import { NotificationBell } from "./NotificationBell";
import { ModeSwitcher, useModeAccent } from "./ModeSwitcher";
import { ScrollRail } from "./ScrollRail";
import { TitleBar } from "./TitleBar";
import { Tooltips } from "./Tooltips";
import { Kbd, cx } from "./ui";

type NavItem = { to: string; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number }>; end?: boolean; media?: boolean; announcements?: boolean };
const NAV_ALL: NavItem[] = [
  { to: "/", label: "Library", icon: IconLibrary, end: true, media: true },
  { to: "/timeline", label: "Timeline", icon: IconTimeline, media: true },
  { to: "/stats", label: "Stats", icon: IconStats, media: true },
  { to: "/for-you", label: "For you", icon: IconForYou, media: true },
  { to: "/map", label: "Taste map", icon: IconTasteMap, media: true },
  { to: "/calendar", label: "Calendar", icon: IconCalendar, media: true, announcements: true },
];
/** The same sections in every mode, under the mode's prefix (movies keep the original routes). */
function navFor(mode: Mode, announcements: boolean): NavItem[] {
  if (mode === "movie") return NAV_ALL.filter((n) => !n.announcements);
  const base = MODES[mode].base;
  return NAV_ALL.filter((n) => n.media && (!n.announcements || announcements) && !(mode === "book" && n.to === "/calendar")).map((n) => ({ ...n, to: n.to === "/" ? base : base + n.to }));
}
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className={cx("flex items-center gap-[10px] px-[10px]", compact && "max-[1023px]:px-0 max-[1023px]:justify-center")}>
      <div className="size-[26px] rounded-[8px] border-[1.5px] border-accent grid place-items-center box-border shrink-0">
        <div className="size-2 rounded-full bg-accent shadow-[0_0_12px_var(--color-accent)]" />
      </div>
      <span className="font-display font-semibold text-[17px] tracking-[0.02em] max-[1023px]:hidden">Reel</span>
    </div>
  );
}

/** Desktop sidebar (≥1024), icon rail (640–1023) and bottom tab bar (<640). */
function Sidebar() {
  const { openPalette } = usePalette();
  const loc = useLocation();
  const mode = useMode();
  const { data: settings } = useSettings();
  const NAV = navFor(mode, !!settings?.flags?.announcements);
  const home = mode === "movie" ? "/" : MODES[mode].base;
  // the film detail page belongs to the Library section (and an item's page to its mode's library)
  const libraryish = mode === "movie" ? loc.pathname === "/" || loc.pathname.startsWith("/film/") : loc.pathname === home || /^\/\w+\/\d+$/.test(loc.pathname);
  return (
    <>
      {/* the wrapper carries the full-height border; the nav inside is sticky */}
      <div className="max-[639px]:hidden flex-[1_1_220px] max-[1023px]:flex-[0_0_72px] max-w-full border-r border-(--line-nav) relative z-[1] bg-bg">
      <nav
        aria-label="Primary"
        className="sticky top-0 h-screen overflow-y-auto overscroll-contain [scrollbar-width:none] flex flex-col gap-7 pb-7 pt-[calc(28px+var(--tb))] px-[18px] max-[1023px]:px-[14px] max-[1023px]:gap-5 box-border *:shrink-0"
      >
        <Logo compact />
        <button
          type="button"
          onClick={() => openPalette()}
          aria-label="Search"
          data-tip-rail={`Search · ${isMac ? "⌘K" : "Ctrl K"}`}
          className="flex items-center gap-[10px] h-11 box-content px-3 rounded-[12px] bg-(--fill-ctl) border border-(--line-1) text-ink-3 text-[14px] cursor-pointer max-[1023px]:justify-center max-[1023px]:px-0"
        >
          <IconSearch size={18} />
          <span className="flex-1 text-left whitespace-nowrap max-[1023px]:hidden">Search</span>
          <Kbd className="text-ink-3 max-[1023px]:hidden">{isMac ? "⌘K" : "Ctrl K"}</Kbd>
        </button>
        <div className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={label}
              data-tip-rail={label}
              className={({ isActive }) => {
                const active = isActive || (to === home && libraryish);
                return cx(
                  "relative isolate flex items-center gap-3 h-11 px-3 rounded-[12px] no-underline text-[14px] max-[1023px]:justify-center max-[1023px]:px-0 transition-[background-color,color] duration-150",
                  active ? "text-ink-hi font-medium hover:text-ink-hi" : "text-ink-3 hover:bg-(--fill-ctl) hover:text-ink-2",
                );
              }}
              {...(to === home && libraryish ? { "aria-current": "page" as const } : {})}
            >
              {({ isActive }) => (
                <>
                  {/* the active pill slides between sections */}
                  {(isActive || (to === home && libraryish)) && (
                    <motion.span layoutId="nav-active" aria-hidden className="absolute inset-0 -z-10 rounded-[12px] bg-(--fill-nav-active)" transition={{ type: "spring", stiffness: 520, damping: 40 }} />
                  )}
                  <Icon size={18} />
                  <span className="flex-1 max-[1023px]:hidden">{label}</span>
                  {(isActive || (to === home && libraryish)) && <span className="size-[6px] rounded-full bg-accent max-[1023px]:hidden" />}
                </>
              )}
            </NavLink>
          ))}
        </div>
        <div className="mt-auto flex flex-col gap-4">
          <ModeSwitcher />
          <div className="flex gap-2 ml-[10px] max-[1023px]:ml-0 max-[1023px]:flex-col max-[1023px]:items-center">
          <NavLink
            to="/settings"
            aria-label="Settings"
            title="Settings"
            className={({ isActive }) =>
              cx("size-11 rounded-[12px] border grid place-items-center no-underline",
                isActive ? "bg-(--fill-nav-active) border-(--line-4) text-ink-hi" : "border-(--line-1) text-ink-3 hover:bg-(--fill-ctl)")
            }
          >
            <IconSettings size={18} />
          </NavLink>
          <NotificationBell />
          </div>
          <p className="m-0 px-[10px] text-[10px] leading-[1.45] text-ink-4 opacity-45 max-[1023px]:hidden">
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
        </div>
      </nav>
      </div>

      {/* phone: bottom tab bar + floating search */}
      <nav aria-label="Primary" className="min-[640px]:hidden fixed bottom-0 inset-x-0 z-40 h-16 flex items-stretch justify-around glass border-x-0 border-b-0 bg-[rgba(12,14,19,0.82)]">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cx("flex-1 flex flex-col items-center justify-center gap-1 text-[11px] no-underline", isActive || (to === home && libraryish) ? "text-ink-hi" : "text-ink-3")
            }
          >
            <Icon size={20} />
            {label}
          </NavLink>
        ))}
      </nav>
      <button
        type="button"
        aria-label="Search"
        onClick={() => openPalette()}
        className="min-[640px]:hidden fixed right-4 bottom-[80px] z-40 size-14 rounded-full bg-accent text-on-accent grid place-items-center border-0 shadow-[0_12px_30px_-10px_var(--color-accent)]"
      >
        <IconSearch size={22} strokeWidth={2} />
      </button>
    </>
  );
}

export function Shell() {
  const loc = useLocation();
  const outlet = useOutlet();
  const { openPalette } = usePalette();
  useModeAccent();
  // pages fade up as they arrive (.page-in, a compositor animation that the mounting page can't stall); not the first
  const key = /^\/(shows|books|games)(\/|$)/.test(loc.pathname) ? loc.pathname.split("/").slice(0, 3).join("/") : loc.pathname.split("/").slice(0, 2).join("/") + (loc.pathname.startsWith("/film/") ? loc.pathname : "");
  const firstKey = useRef(key);
  const navigated = useRef(false);
  if (key !== firstKey.current) navigated.current = true;
  useEffect(() => trackPath(loc.pathname), [loc.pathname]);
  useEffect(() => {
    window.scrollTo(0, 0); // a block body: scrollTo() returns a Promise in newer Chromium
    document.body.scrollTo(0, 0); // the desktop window scrolls the body (under the title bar)
  }, [loc.pathname]);

  // ?log=:tmdbId opens the palette with the log form for that film
  useEffect(() => {
    const id = new URLSearchParams(loc.search).get("log");
    if (id) openPalette({ logFor: { tmdb_id: Number(id), title: "", year: null } });
  }, [loc.search, openPalette]);

  return (
    <div className="min-h-screen bg-bg text-ink font-sans flex lg:flex-wrap relative overflow-clip">
      <AmbientGlow />
      <TitleBar />
      <ScrollRail />
      <Sidebar />
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={key}
          className={cx("flex-[999_1_560px] max-[1023px]:flex-1 min-w-0 flex flex-col relative pt-(--tb)", navigated.current && "page-in")}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
        >
          {outlet}
        </motion.div>
      </AnimatePresence>
      <CommandPalette />
      <Tooltips />
      <EditWatchDialog />
    </div>
  );
}
