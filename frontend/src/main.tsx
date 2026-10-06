import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { api } from "./api/client";
import { mediaApi, type Kind } from "./api/media";
import { MediaGate } from "./components/MediaGate";
import { RouteError, reloadOnceForNewBuild } from "./components/RouteError";
import { Shell } from "./components/Shell";
import { ToastProvider } from "./components/Toasts";
import { PaletteProvider } from "./features/search/palette";
import { installDesktopBehaviour } from "./lib/desktop";
import { Library } from "./pages/Library";
import "./theme.css";
import "./app.css";

const loadFilmDetail = () => import("./pages/FilmDetail");
const FilmDetail = lazy(loadFilmDetail);
const Timeline = lazy(() => import("./pages/Timeline"));
const Stats = lazy(() => import("./pages/Stats"));
const ForYou = lazy(() => import("./pages/ForYou"));
const TasteMap = lazy(() => import("./pages/TasteMap"));
const Settings = lazy(() => import("./pages/Settings"));
const Import = lazy(() => import("./pages/Import"));
const MediaLibrary = lazy(() => import("./pages/media/MediaLibrary"));
const loadMediaDetail = () => import("./pages/media/MediaDetail");
const MediaDetail = lazy(loadMediaDetail);
const MediaCalendar = lazy(() => import("./pages/media/MediaCalendar"));
const MediaTimeline = lazy(() => import("./pages/media/MediaTimeline"));
const MediaStats = lazy(() => import("./pages/media/MediaStats"));
const MediaForYou = lazy(() => import("./pages/media/MediaForYou"));
const MediaTasteMap = lazy(() => import("./pages/media/MediaTasteMap"));
const MediaImport = lazy(() => import("./pages/media/MediaImport"));

installDesktopBehaviour();
window.addEventListener("vite:preloadError", (e) => reloadOnceForNewBuild() && e.preventDefault());

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } } });

// Pointing at (or tabbing to) a film or item link loads its page's code and data, so the click opens it at once and
// the poster can morph into the hero instead of the page showing a skeleton first.
const warm = (e: Event) => {
  const m = (e.target as Element | null)?.closest?.("a[href]")?.getAttribute("href")?.match(/^\/(film|shows|books|games)\/(\d+)/);
  if (!m) return;
  const id = Number(m[2]);
  if (m[1] === "film") {
    void loadFilmDetail();
    void qc.prefetchQuery({ queryKey: ["movie", id], queryFn: () => api.movie(id) });
  } else {
    void loadMediaDetail();
    void qc.prefetchQuery({ queryKey: ["media", "item", id], queryFn: () => mediaApi.item(id) });
  }
};
document.addEventListener("pointerover", warm);
document.addEventListener("focusin", warm);

const page = (el: React.ReactNode) => <Suspense fallback={null}>{el}</Suspense>;

const movies = (el: React.ReactNode) => page(<MediaGate kind="movie">{el}</MediaGate>);

// shows, books and games: the same sections as movies under their own prefix, each behind its flag
const media = (kind: Kind, base: string) => [
  { path: base, element: page(<MediaGate kind={kind}><MediaLibrary kind={kind} /></MediaGate>) },
  { path: `${base}/calendar`, element: page(<MediaGate kind={kind}><MediaCalendar kind={kind} /></MediaGate>) },
  { path: `${base}/timeline/:year?`, element: page(<MediaGate kind={kind}><MediaTimeline kind={kind} /></MediaGate>) },
  { path: `${base}/stats`, element: page(<MediaGate kind={kind}><MediaStats kind={kind} /></MediaGate>) },
  { path: `${base}/for-you`, element: page(<MediaGate kind={kind}><MediaForYou kind={kind} /></MediaGate>) },
  { path: `${base}/map`, element: page(<MediaGate kind={kind}><MediaTasteMap kind={kind} /></MediaGate>) },
  { path: `${base}/import`, element: page(<MediaGate kind={kind}><MediaImport kind={kind} /></MediaGate>) },
  { path: `${base}/:id`, element: page(<MediaGate kind={kind}><MediaDetail kind={kind} /></MediaGate>) },
];

const router = createBrowserRouter([
  {
    element: (
      <PaletteProvider>
        <Shell />
      </PaletteProvider>
    ),
    errorElement: <RouteError />,
    children: [{ errorElement: <RouteError />, children: [
      { path: "/", element: movies(<Library />) },
      { path: "/film/:tmdbId", element: movies(<FilmDetail />) },
      { path: "/timeline/:year?", element: movies(<Timeline />) },
      { path: "/stats", element: movies(<Stats />) },
      { path: "/for-you", element: movies(<ForYou />) },
      { path: "/map", element: movies(<TasteMap />) },
      { path: "/settings", element: page(<Settings />) },
      { path: "/import", element: movies(<Import />) },
      ...media("show", "/shows"),
      ...media("book", "/books"),
      ...media("game", "/games"),
      { path: "*", element: movies(<Library />) },
    ] }],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 260, damping: 30 }}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);
