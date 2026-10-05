import { motion } from "framer-motion";
import type { CSSProperties } from "react";
import type { Motif, PosterArtColors } from "../api/types";
import { cx } from "./ui";

export type PosterFilm = {
  tmdb_id: number;
  title: string;
  year?: number | null;
  poster?: string | null;
  poster_sm?: string | null;
  poster_art?: PosterArtColors;
  palette?: string[];
};

/** Every place a poster appears, with the values from the reference screens. */
type Size = "wall" | "last" | "detail" | "top" | "timeline" | "mini" | "rec" | "thumb" | "side";
const SPEC: Record<Size, {
  radius: number; pad: number; title: number; lh: number; year?: number; yearOpacity?: number;
  motif?: boolean; motifScale?: number; archOpacity?: number; sunOpacity?: number; small?: boolean;
}> = {
  wall: { radius: 12, pad: 14, title: 15, lh: 1.15, year: 11, yearOpacity: 0.85, motif: true },
  last: { radius: 10, pad: 10, title: 11, lh: 1.15, motif: true },
  detail: { radius: 16, pad: 18, title: 20, lh: 1.1, year: 12, yearOpacity: 1, motif: true, archOpacity: 0.4 },
  top: { radius: 16, pad: 18, title: 22, lh: 1.1, year: 12, yearOpacity: 1, motif: true, motifScale: 80 / 72, sunOpacity: 0.2 },
  timeline: { radius: 10, pad: 10, title: 12, lh: 1.15, small: true },
  mini: { radius: 12, pad: 12, title: 13, lh: 1.15 },
  rec: { radius: 10, pad: 10, title: 11, lh: 1.15 },
  thumb: { radius: 6, pad: 0, title: 0, lh: 1 },
  side: { radius: 8, pad: 0, title: 0, lh: 1 },
};

function MotifShape({ motif, fg, spec }: { motif: Motif; fg: string; spec: (typeof SPEC)[Size] }) {
  if (motif === "sun")
    return <div className="absolute rounded-full aspect-square" style={{ right: "-18%", top: "16%", width: `${72 * (spec.motifScale ?? 1)}%`, opacity: spec.sunOpacity ?? 0.18, background: fg }} />;
  if (motif === "band") return <div className="absolute left-0 right-0" style={{ top: "42%", height: "13%", opacity: 0.16, background: fg }} />;
  return (
    <div
      className="absolute"
      style={{ left: "16%", right: "16%", top: "20%", height: "46%", borderRadius: "999px 999px 0 0", opacity: spec.archOpacity ?? 0.32, border: `2px solid ${fg}` }}
    />
  );
}

export function posterBg(f: PosterFilm): string {
  return f.poster_art?.bg ?? f.palette?.[2] ?? "#1A1D24";
}

/**
 * The poster image when cached, else the generative PosterArt. `layout` gives the image a shared
 * layoutId so it morphs into the detail hero poster.
 */
export function Poster({
  film, size, shadow, className, style, layout = true, eager,
}: {
  film: PosterFilm;
  size: Size;
  shadow?: string | false;
  className?: string;
  style?: CSSProperties;
  layout?: boolean;
  eager?: boolean;
}) {
  const s = SPEC[size];
  const bg = posterBg(film);
  const fg = film.poster_art?.fg ?? "#ECEEF3";
  const motif = film.poster_art?.motif ?? (["sun", "band", "arch"] as Motif[])[Math.abs(film.tmdb_id) % 3];
  const src = size === "thumb" || size === "side" || size === "rec" || size === "timeline" || size === "last" ? film.poster_sm ?? film.poster : film.poster ?? film.poster_sm;
  const boxShadow = shadow === false ? undefined : shadow ?? (size === "wall" ? `0 22px 44px -22px ${bg}` : undefined);
  const common = cx("poster-art relative overflow-hidden shrink-0 aspect-[2/3] box-border", className);
  const css: CSSProperties = { borderRadius: s.radius, background: bg, boxShadow, ...style };

  if (src) {
    return (
      <motion.div layoutId={layout ? `poster-${film.tmdb_id}` : undefined} className={common} style={css}>
        <img
          src={src} alt="" loading={eager ? "eager" : "lazy"} decoding="async" draggable={false}
          className="poster-img absolute inset-0 size-full object-cover"
          ref={(el) => {
            if (el?.complete && el.naturalWidth) el.dataset.loaded = "";
          }}
          onLoad={(e) => (e.currentTarget.dataset.loaded = "")}
        />
      </motion.div>
    );
  }
  if (!s.title) return <motion.div layoutId={layout ? `poster-${film.tmdb_id}` : undefined} className={common} style={css} aria-hidden />;
  return (
    <motion.div
      layoutId={layout ? `poster-${film.tmdb_id}` : undefined}
      className={cx(common, "flex flex-col", s.year ? "justify-between" : "justify-end")}
      style={{ ...css, padding: s.pad }}
      aria-hidden
    >
      {s.motif && <MotifShape motif={motif} fg={fg} spec={s} />}
      {s.year != null && (
        <span className="relative font-mono" style={{ fontSize: s.year, opacity: s.yearOpacity, color: fg }}>
          {film.year}
        </span>
      )}
      <span className="relative font-display font-semibold [text-wrap:balance]" style={{ fontSize: s.title, lineHeight: s.lh, color: fg }}>
        {film.title}
      </span>
    </motion.div>
  );
}
