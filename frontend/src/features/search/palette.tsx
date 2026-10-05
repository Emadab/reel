import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { WatchOut } from "../../api/types";

export type PaletteFilm = { tmdb_id: number; title: string; year: number | null; watch_count?: number; on_watchlist?: boolean; director?: string | null };

type State =
  | { kind: "closed" }
  | { kind: "palette"; logFor?: PaletteFilm; query?: string }
  | { kind: "edit"; watch: WatchOut; film: PaletteFilm };

type Api = {
  state: State;
  openPalette: (opts?: { logFor?: PaletteFilm; query?: string }) => void;
  openEdit: (watch: WatchOut, film: PaletteFilm) => void;
  close: () => void;
};

const Ctx = createContext<Api>(null!);
export const usePalette = () => useContext(Ctx);

export function PaletteProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: "closed" });
  const openPalette = useCallback((opts?: { logFor?: PaletteFilm; query?: string }) => setState({ kind: "palette", ...opts }), []);
  const openEdit = useCallback((watch: WatchOut, film: PaletteFilm) => setState({ kind: "edit", watch, film }), []);
  const close = useCallback(() => setState({ kind: "closed" }), []);
  const value = useMemo(() => ({ state, openPalette, openEdit, close }), [state, openPalette, openEdit, close]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
