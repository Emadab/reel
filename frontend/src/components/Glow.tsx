import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const Ctx = createContext<(c: string | null) => void>(() => {});

/** Pages set the ambient glow colour (Library: the last-watched film); the shell draws it. */
export function useAmbientGlow(color: string | null | undefined) {
  const set = useContext(Ctx);
  useEffect(() => {
    set(color ?? null);
    return () => set(null);
  }, [color, set]);
}

export function GlowProvider({ children }: { children: (glow: string | null) => ReactNode }) {
  const [glow, setGlow] = useState<string | null>(null);
  return <Ctx.Provider value={setGlow}>{children(glow)}</Ctx.Provider>;
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
