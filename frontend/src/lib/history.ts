import { useEffect, useRef } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router";

// The previous in-app page, so the detail page's back pill can say where it goes.
const LABELS: [RegExp, string][] = [
  [/^\/$/, "Library"],
  [/^\/timeline/, "Timeline"],
  [/^\/stats/, "Stats"],
  [/^\/for-you/, "For you"],
  [/^\/map/, "Taste map"],
  [/^\/film\//, "Back"],
  [/^\/settings/, "Settings"],
  [/^\/import/, "Import"],
  [/^\/shows$/, "Shows"],
  [/^\/books$/, "Books"],
  [/^\/games$/, "Games"],
];

let previous: string | null = null;
let current: string | null = null;

export function trackPath(path: string) {
  if (path === current) return;
  previous = current;
  current = path;
}

/** Pages render before the shell records their path, so `here` tells us which slot holds the previous page. */
export function backTarget(here: string): { label: string; back: boolean } {
  const prev = current === here ? previous : current;
  if (!prev) return { label: "Library", back: false };
  const label = LABELS.find(([re]) => re.test(prev))?.[1] ?? "Back";
  return { label, back: true };
}

const STICKY = "reel.library.";
const read = (key: string) => {
  try {
    return localStorage.getItem(STICKY + key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(STICKY + key, value);
  } catch {
    /* storage blocked: filters just won't stick */
  }
};

/**
 * A library's filters, sort and view (its search params), kept per medium: opening the library with a bare URL,
 * from the sidebar or after switching mode, brings back the last ones you chose, even after a restart.
 */
export function useStickySearch(key: string, path: string) {
  const [sp, setSp] = useSearchParams();
  const loc = useLocation();
  const arrived = useNavigationType() !== "REPLACE"; // the page's own filter changes all replace
  // a library still fading out sees the next page's URL: only its own page's params are its filters
  const own = loc.pathname === path;
  const handled = useRef<string | null>(null);
  const saved = own && arrived && handled.current !== loc.key && !sp.toString() ? read(key) : null;
  useEffect(() => {
    if (!own) return;
    handled.current = loc.key;
    if (saved) return void setSp(new URLSearchParams(saved), { replace: true });
    const keep = new URLSearchParams(sp);
    keep.delete("log"); // a one-off "log this film" link, not a filter
    write(key, keep.toString());
  }, [key, own, loc.key, sp, saved, setSp]);
  return [saved ? new URLSearchParams(saved) : sp, setSp] as const;
}
