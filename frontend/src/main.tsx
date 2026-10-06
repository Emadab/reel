import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import type { Kind } from "./api/media";
import { MediaGate } from "./components/MediaGate";
import { Shell } from "./components/Shell";
import { ToastProvider } from "./components/Toasts";
import { PaletteProvider } from "./features/search/palette";
import { installDesktopBehaviour } from "./lib/desktop";
import { Library } from "./pages/Library";
import "./theme.css";
import "./app.css";

const FilmDetail = lazy(() => import("./pages/FilmDetail"));
const Timeline = lazy(() => import("./pages/Timeline"));
const Stats = lazy(() => import("./pages/Stats"));
const ForYou = lazy(() => import("./pages/ForYou"));
const TasteMap = lazy(() => import("./pages/TasteMap"));
const Settings = lazy(() => import("./pages/Settings"));
const Import = lazy(() => import("./pages/Import"));
const MediaLibrary = lazy(() => import("./pages/media/MediaLibrary"));
const MediaDetail = lazy(() => import("./pages/media/MediaDetail"));
const MediaCalendar = lazy(() => import("./pages/media/MediaCalendar"));
const MediaTimeline = lazy(() => import("./pages/media/MediaTimeline"));
const MediaStats = lazy(() => import("./pages/media/MediaStats"));
const MediaForYou = lazy(() => import("./pages/media/MediaForYou"));
const MediaTasteMap = lazy(() => import("./pages/media/MediaTasteMap"));
const MediaImport = lazy(() => import("./pages/media/MediaImport"));

installDesktopBehaviour();

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } } });

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
    children: [
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
    ],
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
