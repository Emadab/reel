import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { WatchOut } from "../../api/types";

export type PaletteFilm = { tmdb_id: number; title: string; year: number | null; watch_count?: number; on_watchlist?: boolean; director?: string | null };

type State =
  | { kind: "closed" }
  | { kind: "palette"; logFor?: PaletteFilm; query?: string }
  | { kind: "edit"; watch: WatchOut; film: PaletteFilm };

type Api = {
  openPalette: (opts?: { logFor?: PaletteFilm; query?: string }) => void;
  openEdit: (watch: WatchOut, film: PaletteFilm) => void;
  close: () => void;
};

// The actions never change, so pages that only open the palette don't re-render (a whole poster wall) when it opens.
const Ctx = createContext<Api>(null!);
const StateCtx = createContext<State>({ kind: "closed" });
export const usePalette = () => useContext(Ctx);
export const usePaletteState = () => useContext(StateCtx);

export function PaletteProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: "closed" });
  const openPalette = useCallback((opts?: { logFor?: PaletteFilm; query?: string }) => setState({ kind: "palette", ...opts }), []);
  const openEdit = useCallback((watch: WatchOut, film: PaletteFilm) => setState({ kind: "edit", watch, film }), []);
  const close = useCallback(() => setState({ kind: "closed" }), []);
  const api = useMemo(() => ({ openPalette, openEdit, close }), [openPalette, openEdit, close]);
  return (
    <Ctx.Provider value={api}>
      <StateCtx.Provider value={state}>{children}</StateCtx.Provider>
    </Ctx.Provider>
  );
}
