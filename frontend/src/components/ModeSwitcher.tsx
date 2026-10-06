import { motion } from "framer-motion";
import { useEffect, useRef, type ComponentType } from "react";
import { useLocation, useNavigate } from "react-router";
import { useSettings } from "../api/hooks";
import { MODE_ORDER, MODES, switchPath, useMode, type Mode } from "../lib/mode";
import { IconBook, IconFilm, IconGame, IconTV } from "./Icons";
import { cx } from "./ui";

const ICON: Record<Mode, ComponentType<{ size?: number }>> = { movie: IconFilm, show: IconTV, book: IconBook, game: IconGame };

/** Modes whose flag is on. With only one, the switcher stays hidden. */
export function useModes(): Mode[] {
  const { data } = useSettings();
  return MODE_ORDER.filter((m) => data?.flags?.[MODES[m].flag]);
}

/** The accent follows the mode; a mode switch cross-fades it (see --color-accent's @property in app.css). */
export function useModeAccent() {
  const { data } = useSettings();
  const mode = useMode();
  const prev = useRef(mode);
  const accent = data?.mode_accents?.[mode] ?? MODES[mode].accent;
  useEffect(() => {
    if (!accent) return;
    const root = document.documentElement;
    if (prev.current !== mode) {
      root.dataset.modeFade = "";
      setTimeout(() => delete root.dataset.modeFade, 700);
    }
    prev.current = mode;
    root.dataset.mode = mode;
    root.style.setProperty("--color-accent", accent);
  }, [accent, mode]);
}

/**
 * Workspace switcher (like Zen browser): Movies, Shows, Books, Games. Every page then shows only that medium.
 * Ctrl 1–4 switches from anywhere.
 */
export function ModeSwitcher() {
  const modes = useModes();
  const mode = useMode();
  const nav = useNavigate();
  const loc = useLocation();
  const go = (m: Mode) => m !== mode && nav(switchPath(loc.pathname, m));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const m = modes[Number(e.key) - 1];
      if (m && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        if (m !== mode) nav(switchPath(loc.pathname, m));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modes, mode, nav, loc.pathname]);

  if (modes.length < 2) return null;
  return (
    <div className="flex flex-col items-center gap-2 self-start ml-[10px] max-[1023px]:self-center max-[1023px]:ml-0">
      <span className="pl-[0.18em] font-mono text-[10.5px] tracking-[0.18em] uppercase text-[color-mix(in_oklch,var(--color-accent)_80%,white)] max-[1023px]:hidden">
        Mode · {MODES[mode].label}
      </span>
      <div role="group" aria-label="Mode" className="flex max-[1023px]:flex-col rounded-[14px] border border-(--line-1) bg-(--fill-ctl) overflow-hidden">
        {modes.map((m, i) => {
          const Icon = ICON[m];
          const on = m === mode;
          return (
            <button
              key={m}
              type="button"
              aria-label={`${MODES[m].label} mode`}
              aria-pressed={on}
              title={`${MODES[m].label} · Ctrl ${i + 1}`}
              onClick={() => go(m)}
              className={cx(
                "relative size-11 grid place-items-center border-0 bg-transparent",
                on ? "text-accent bg-[color-mix(in_oklch,var(--color-accent)_14%,transparent)]" : "text-ink-3 hover:bg-white/5 hover:text-ink-2",
              )}
            >
              {on && <motion.span layoutId="mode-bar" transition={{ type: "spring", stiffness: 520, damping: 38 }} aria-hidden className="absolute inset-x-[10px] bottom-0 h-[2px] rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)] max-[1023px]:inset-x-auto max-[1023px]:inset-y-[10px] max-[1023px]:left-0 max-[1023px]:w-[2px] max-[1023px]:h-auto" />}
              <Icon size={18} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
