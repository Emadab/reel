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

installDesktopBehaviour();

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } } });

const page = (el: React.ReactNode) => <Suspense fallback={null}>{el}</Suspense>;

// shows, books and games: the same sections as movies under their own prefix, each behind its flag
const media = (kind: Kind, base: string) => [
  { path: base, element: page(<MediaGate kind={kind}><MediaLibrary kind={kind} /></MediaGate>) },
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
      { path: "/", element: <Library /> },
      { path: "/film/:tmdbId", element: page(<FilmDetail />) },
      { path: "/timeline/:year?", element: page(<Timeline />) },
      { path: "/stats", element: page(<Stats />) },
      { path: "/for-you", element: page(<ForYou />) },
      { path: "/map", element: page(<TasteMap />) },
      { path: "/settings", element: page(<Settings />) },
      { path: "/import", element: page(<Import />) },
      ...media("show", "/shows"),
      ...media("book", "/books"),
      ...media("game", "/games"),
      { path: "*", element: <Library /> },
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
