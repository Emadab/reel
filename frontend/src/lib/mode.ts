// Workspace modes (like Zen browser workspaces): Movies, Shows, Books, Games. The mode comes from the URL;
// movies keep their original routes ("/", "/timeline", …), other media live under "/shows", "/books", "/games".
import { useLocation } from "react-router";
import type { Kind } from "../api/media";
import type { Flag } from "../api/types";

export type Mode = "movie" | Kind;

type ModeInfo = {
  label: string;
  base: string;
  flag: Flag;
  accent: string; // default; Settings → Mode accents overrides it
  noun: [string, string]; // one, many
  add: string;
};

export const MODES: Record<Mode, ModeInfo> = {
  movie: { label: "Movies", base: "", flag: "media.movies", accent: "#7FDBFF", noun: ["film", "films"], add: "Log a watch" },
  show: { label: "Shows", base: "/shows", flag: "media.shows", accent: "#C9A7FF", noun: ["show", "shows"], add: "Add a show" },
  book: { label: "Books", base: "/books", flag: "media.books", accent: "#FFB86B", noun: ["book", "books"], add: "Add a book" },
  game: { label: "Games", base: "/games", flag: "media.games", accent: "#C6F36B", noun: ["game", "games"], add: "Add a game" },
};
export const MODE_ORDER: Mode[] = ["movie", "show", "book", "game"];

export function modeOf(pathname: string): Mode {
  const seg = pathname.split("/")[1];
  return seg === "shows" ? "show" : seg === "books" ? "book" : seg === "games" ? "game" : "movie";
}

export const useMode = (): Mode => modeOf(useLocation().pathname);

/** The same section in another mode: /timeline → /shows/timeline; detail pages go to the library. */
export function switchPath(pathname: string, to: Mode): string {
  const from = modeOf(pathname);
  const rest = from === "movie" ? pathname : pathname.slice(MODES[from].base.length) || "/";
  const section = ["/timeline", "/stats", "/for-you", "/map", "/calendar"].find((s) => rest.startsWith(s)) ?? "/";
  if (to === "movie") return section === "/calendar" ? "/" : section;
  return section === "/" ? MODES[to].base : MODES[to].base + section;
}

// ---- tracking vocabulary per medium (REEL_EXPANSION §5.3) ----

export const STATUS_LABEL: Record<string, string> = {
  watching: "Watching", caught_up: "Up to date", completed: "Completed", on_hold: "On hold", dropped: "Dropped",
  reading: "Reading", paused: "Paused", finished: "Finished", did_not_finish: "Did not finish", dipping: "Dipping in",
  playing: "Playing", shelved: "Shelved", beaten: "Beaten", abandoned: "Abandoned", retired: "Retired",
  wishlist: "Wishlist", backlog: "Backlog", not_interested: "Not interested",
};

/** What the shared shelves are called per medium. */
export const SHELF_LABEL: Record<Kind, Record<string, string>> = {
  show: { wishlist: "Watchlist" },
  book: { wishlist: "Want to read", backlog: "To read (owned)" },
  game: { wishlist: "Wishlist", backlog: "Backlog" },
};

export function statusLabel(kind: Kind, s: string | null): string {
  if (!s) return "Not started";
  return SHELF_LABEL[kind][s] ?? STATUS_LABEL[s] ?? s;
}

/** Library tabs: label and the displayed statuses each one gathers. */
export const TABS: Record<Kind, { id: string; label: string; statuses: string[] }[]> = {
  show: [
    { id: "watching", label: "Watching", statuses: ["watching"] },
    { id: "caught_up", label: "Up to date", statuses: ["caught_up"] },
    { id: "watchlist", label: "Watchlist", statuses: ["wishlist"] },
    { id: "completed", label: "Completed", statuses: ["completed"] },
    { id: "paused", label: "On hold", statuses: ["on_hold"] },
    { id: "dropped", label: "Dropped", statuses: ["dropped"] },
  ],
  book: [
    { id: "reading", label: "Reading", statuses: ["reading", "dipping"] },
    { id: "want", label: "Want to read", statuses: ["wishlist"] },
    { id: "backlog", label: "To read", statuses: ["backlog"] },
    { id: "finished", label: "Finished", statuses: ["finished"] },
    { id: "paused", label: "Paused", statuses: ["paused"] },
    { id: "dnf", label: "Did not finish", statuses: ["did_not_finish"] },
  ],
  game: [
    { id: "playing", label: "Playing", statuses: ["playing"] },
    { id: "backlog", label: "Backlog", statuses: ["backlog"] },
    { id: "wishlist", label: "Wishlist", statuses: ["wishlist"] },
    { id: "beaten", label: "Beaten", statuses: ["beaten", "completed"] },
    { id: "shelved", label: "Shelved", statuses: ["shelved"] },
    { id: "abandoned", label: "Abandoned", statuses: ["abandoned", "retired"] },
  ],
};

/** The first state a run starts in, and the verb for it. */
export const START: Record<Kind, { status: string; verb: string; again: string }> = {
  show: { status: "watching", verb: "Start watching", again: "Start a rewatch" },
  book: { status: "reading", verb: "Start reading", again: "Start a reread" },
  game: { status: "playing", verb: "Start playing", again: "Start a replay" },
};

/** Shows derive watching / up to date / completed from episodes; the status menu only offers the states you set. */
export const USER_SET: Record<Kind, Set<string> | null> = {
  show: new Set(["watching", "on_hold", "dropped"]),
  book: null,
  game: null,
};

export const SOURCE_NAME: Record<Kind, string> = { show: "TMDB", book: "Open Library", game: "RAWG" };
