import { useEffect, useSyncExternalStore } from "react";

// A tiny store, not state in the shell: a page setting its glow repaints the glow, not the whole app.
let glow: string | null = null;
const subs = new Set<() => void>();
const setGlow = (c: string | null) => {
  if (c === glow) return;
  glow = c;
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));

/** Pages set the ambient glow colour (Library: the last-watched film); the shell draws it. */
export function useAmbientGlow(color: string | null | undefined) {
  useEffect(() => {
    const c = color ?? null;
    setGlow(c);
    return () => void (glow === c && setGlow(null)); // a page leaving after the next one arrived keeps the new glow
  }, [color]);
}

/** The shell's ambient glow; it cross-fades between films (see .ambient-glow in app.css). */
export function AmbientGlow() {
  const c = useSyncExternalStore(subscribe, () => glow);
  return (
    <div
      aria-hidden
      className="ambient-glow absolute top-[-320px] right-[-180px] w-[980px] h-[680px] pointer-events-none"
      style={{ "--glow-c": c ?? "transparent" } as React.CSSProperties}
    />
  );
}

/** `rgba(c, a)` for a hex colour. */
export function alpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function mix(color: string, pct: number, other = "transparent"): string {
  return `color-mix(in oklch, ${color} ${pct}%, ${other})`;
}
