import { Link } from "react-router";
import { useBacklog, type Kind } from "../../api/media";
import { Poster } from "../../components/Poster";
import { SectionTitle } from "../../components/ui";
import { MODES } from "../../lib/mode";
import { asFilm, itemPath } from "./parts";

/** This mode's backlog, shortest estimated time left first (books at a flat reading pace, games from RAWG). */
export function BacklogPlanner({ kind }: { kind: Kind }) {
  const data = useBacklog().data?.filter((d) => d.kind === kind);
  if (!data?.length) return null;
  return (
    <section className="flex flex-col gap-4" aria-label="Backlog planner">
      <div className="flex justify-between items-baseline gap-4 flex-wrap">
        <SectionTitle>Backlog planner</SectionTitle>
        <span className="font-mono text-[12px] text-ink-3">{MODES[kind].noun[1]} · shortest first</span>
      </div>
      <ol className="list-none m-0 p-0 flex gap-4 overflow-x-auto scroll-quiet pb-2 -mb-2">
        {data.slice(0, 12).map((d, i) => (
          <li key={d.id} className="shrink-0">
            <Link to={itemPath(d)} className="mini-poster w-[132px] flex flex-col gap-2 no-underline text-inherit hover:text-inherit">
              <div className="relative">
                <Poster film={asFilm(d)} size="mini" layout={false} shadow={false} />
                <span className="absolute left-2 top-2 font-mono text-[11px] px-[7px] py-[2px] rounded-[6px] bg-[rgba(7,8,12,0.62)] backdrop-blur-[10px] text-ink-2">#{i + 1}</span>
              </div>
              <span className="text-[13px] font-medium truncate">{d.title}</span>
              <span className="font-mono text-[11px] text-ink-4">
                {d.hours_left == null ? "no estimate" : `~${d.hours_left} h left`}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
