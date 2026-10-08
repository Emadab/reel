import { Link } from "react-router";
import type { Recommendations } from "../api/types";

export function joinAnd(xs: string[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** The strip under every For you page: how well the recommender predicts you, where its candidates came from. */
export function RecHealth({ health: h, recent, mapTo }: { health: Recommendations["health"]; recent: string; mapTo: string }) {
  const sources = h.sources.length ? joinAnd(h.sources) : "TMDB";
  return (
    <section aria-label="Recommender health" className="flex flex-wrap gap-8 items-center py-5 px-6 rounded-[20px] border border-(--line-2)">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[11px] tracking-[0.1em] text-ink-3">HELD-OUT HIT RATE · TOP 20</span>
        <span className="text-[15px]">
          {h.hit_at_20 != null ? (
            <>
              {h.hit_at_20} of your last {h.holdout_n} {recent} <span className="text-ink-3">(v1 found {h.baseline_hit_at_20})</span>
            </>
          ) : (
            <span className="text-ink-3">needs 20 rated {recent}</span>
          )}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[11px] tracking-[0.1em] text-ink-3">CANDIDATES</span>
        <span className="text-[15px]">{h.candidate_count} from {sources}</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[11px] tracking-[0.1em] text-ink-3">WILDCARD SHARE</span>
        <span className="text-[15px]">{Math.round(h.wildcard_share * 100)}% of slots</span>
      </div>
      <Link to={mapTo} title="See where suggestions sit among what you've rated" className="ml-auto max-[639px]:ml-0 flex items-center h-11 box-content px-4 rounded-[12px] border border-(--line-5) no-underline text-[14px]">
        See why on the taste map
      </Link>
    </section>
  );
}
