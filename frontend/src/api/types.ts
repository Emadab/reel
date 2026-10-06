// Response shapes of the FastAPI backend (ARCHITECTURE §3).
export type DatePrecision = "day" | "month" | "year" | "unknown";
export type Motif = "sun" | "band" | "arch";
export type PosterArtColors = { bg: string; fg?: string; motif?: Motif };

export type FilmCard = {
  tmdb_id: number;
  title: string;
  year: number | null;
  director: string | null;
  runtime: number | null;
  poster: string | null;
  poster_sm: string | null;
  palette: string[];
  poster_art: PosterArtColors;
  genres: string[];
  my_rating: number | null;
  watch_count: number;
  on_watchlist: boolean;
  last_watched: { date: string; precision: DatePrecision } | null;
  added_at?: string;
};

export type WatchOut = {
  id: number;
  tmdb_id: number;
  watched_on: string;
  date_precision: DatePrecision;
  rating: number | null;
  is_rewatch: boolean;
  location: string | null;
  with_whom: string | null;
  notes: string | null;
};

export type WatchIn = Omit<WatchOut, "id"> & { source?: "manual" | "onboarding" };
export type WatchPatch = Partial<Omit<WatchOut, "id" | "tmdb_id">>;

export type CardWithWatch = FilmCard & { watch: WatchOut };

export type Library = {
  counts: { watched: number; watchlist: number; rewatches: number };
  totals: { films: number; watches: number; hours: number };
  last_watched: CardWithWatch | null;
  items: FilmCard[];
  next_cursor: number | null;
};

export type Facets = { genres: string[]; decades: number[]; directors: string[] };

export type CastMember = { id?: number; name: string; character: string | null; photo?: string | null };

export type Neighbor = { film: FilmCard; kind: "watched" | "suggested"; score: number | null };

export type MovieDetail = FilmCard & {
  overview: string | null;
  tagline?: string | null;
  keywords: string[];
  cast: CastMember[];
  crew_highlights: { cinematography?: string[]; music?: string[]; writer?: string[]; editing?: string[]; producer?: string[] };
  votes?: { tmdb: number | null; imdb: number | null };
  awards?: string | null;
  original_title?: string | null;
  facts?: {
    certification?: string | null; budget?: number | null; revenue?: number | null; box_office?: string | null;
    countries?: string[]; languages?: string[]; studios?: string[]; status?: string | null; homepage?: string | null;
  };
  collection?: { name: string; films: FilmCard[] } | null;
  language: string | null;
  release_date: string | null;
  backdrop: string | null;
  trailer_key: string | null;
  imdb_id?: string | null;
  on_glow?: string;
  scores: { tmdb: string | null; imdb: string | null; rt: string | null; metacritic: string | null };
  watches: WatchOut[];
  neighbors: Neighbor[];
  fetched_at: string;
  images_pending?: boolean;
};

export type SearchResult = {
  tmdb_id: number;
  title: string;
  year: number | null;
  director: string | null;
  poster_sm?: string | null;
  poster_art: PosterArtColors;
  watch_count: number;
  on_watchlist: boolean;
};
export type SearchResponse = { results: SearchResult[]; took_ms: number };

export type Timeline = {
  year: number;
  totals: { watches: number; approx: number; hours: number };
  months: { month: number; films: CardWithWatch[]; approx: CardWithWatch[] }[];
  year_only: CardWithWatch[];
};
export type YearBar = { year: number; total: number; approx: number };

export type Stats = {
  kpis: {
    films: number;
    watches: number;
    rewatched: number;
    hours: number;
    viewing_days: number;
    first_year: number | null;
    avg_rating: number | null;
  };
  genres: { name: string; value: number; count?: number }[];
  directors: { name: string; count: number }[];
  actors: { name: string; count: number }[];
  ratings: { bin: number; count: number }[];
  mean: number | null;
  heatmap: { start: string; end: string; days: { date: string; count: number }[] };
};

export type Reaction = "like" | "not_interested" | "added_watchlist" | null;
export type Rec = FilmCard & {
  score: number | null;
  is_wildcard: boolean;
  because: FilmCard[];
  reasons: string[];
  why: string | null;
  overview?: string | null;
  glow: string | null;
  reaction?: Reaction;
};

export type Recommendations = {
  model: { version: string; ratings_used: number; reactions_used: number; computed_at: string } | null;
  onboarding: boolean;
  computing: boolean;
  top: Rec | null;
  items: Rec[];
  health: {
    hit_at_20: number | null;
    baseline_hit_at_20: number | null;
    holdout_n: number;
    candidate_count: number;
    sources: string[];
    wildcard_share: number;
  };
};

export type MapPoint = {
  tmdb_id: number;
  title: string;
  x: number;
  y: number;
  kind: "watched" | "suggested" | "candidate";
  rating?: number | null;
  color?: string;
  bg?: string;
  poster_sm?: string | null;
  score?: number;
  is_wildcard?: boolean;
  alpha?: number;
};
export type TasteMap = {
  film_count: number;
  points: MapPoint[];
  clusters: { label: string; x: number; y: number }[];
  default_selected: number | null;
};
export type Explain = {
  film: Rec;
  nearest: { film: FilmCard; similarity: number }[];
  note: string;
};

export type Flag = "media.movies" | "media.shows" | "media.books" | "media.games" | "announcements";

export type SettingsOut = {
  accent: string;
  accents: string[];
  data_dir: string;
  tmdb_configured: boolean;
  tmdb_connected: boolean | null;
  omdb_configured: boolean;
  flags: Record<Flag, boolean>;
  mode_accents?: Partial<Record<"movie" | "show" | "book" | "game", string>>;
  restart_required?: boolean;
};

export type ImportRow = {
  raw: { title: string; year: string | null; watched_on: string; date_precision: DatePrecision; rating: number | null };
  status: "pending" | "matched" | "ambiguous" | "unmatched";
  tmdb_id?: number | null;
  options?: { tmdb_id: number; title: string; year: number | null; poster_sm: string | null }[];
  include?: boolean;
};
export type ImportJob = {
  id: number;
  source: string;
  committed: boolean;
  state: string;
  progress: { done: number; total: number };
  summary: { matched: number; ambiguous: number; unmatched: number; included: number };
  rows: ImportRow[];
};
