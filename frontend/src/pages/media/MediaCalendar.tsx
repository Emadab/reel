import { Link } from "react-router";
import { useCalendar, type CalendarEntry, type Kind } from "../../api/media";
import { Poster } from "../../components/Poster";
import { PageHeader, cx } from "../../components/ui";
import { formatFullDate, today } from "../../lib/format";
import { MODES } from "../../lib/mode";
import { asFilm, itemPath, pagePad } from "./parts";

function dayLabel(day: string): string {
  const t = today();
  const d = new Date(`${day}T00:00:00`);
  const diff = Math.round((d.getTime() - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) / 86_400_000);
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  return diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday" : diff > 1 && diff < 7 ? weekday : formatFullDate(day);
}

function time(at: string): string | null {
  return at.length > 10 ? new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;
}

/** What's coming: episodes of your shows, release dates of wishlisted books and games, grouped by day. */
export default function MediaCalendar({ kind }: { kind: Kind }) {
  const { data, isLoading } = useCalendar(kind);
  const days = new Map<string, CalendarEntry[]>();
  for (const e of data ?? []) days.set(e.day, [...(days.get(e.day) ?? []), e]);
  const upcoming = (data ?? []).filter((e) => !e.aired).length;
  return (
    <main className={cx("flex flex-col gap-8 pt-9 pb-16 max-[1023px]:pt-7 max-[639px]:pt-5 max-[639px]:pb-24 box-border min-w-0", pagePad)}>
      <PageHeader title="Calendar" subline={data ? `${upcoming} coming up · the next 90 days` : " "} />
      {isLoading ? (
        <div className="skeleton h-[320px] rounded-[22px]" />
      ) : days.size === 0 ? (
        <p className="m-0 py-20 text-center font-mono text-[13px] text-ink-3b">
          Nothing scheduled. {kind === "show" ? "Shows you're watching or have on your watchlist appear here." : `Wishlisted ${MODES[kind].noun[1]} with a release date appear here.`}
        </p>
      ) : (
        <ol className="list-none m-0 p-0 flex flex-col gap-7">
          {[...days].map(([day, entries]) => {
            const past = entries.every((e) => e.aired);
            return (
              <li key={day} className={cx("grid grid-cols-[160px_1fr] max-[639px]:grid-cols-1 gap-x-8 gap-y-3", past && "opacity-55")}>
                <div className="flex flex-col gap-1 pt-[6px]">
                  <span className="font-display font-medium text-[18px]">{dayLabel(day)}</span>
                  <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-ink-4">{day}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {entries.map((e) => (
                    <Link
                      key={`${e.item.id}-${e.label}-${e.at}`}
                      to={itemPath(e.item)}
                      className="mini-poster flex items-center gap-4 p-3 rounded-[16px] bg-(--fill-card) border border-(--line-1) no-underline text-ink hover:text-ink hover:border-(--line-4)"
                    >
                      <Poster film={asFilm(e.item)} size="thumb" className="w-10" layout={false} shadow={false} />
                      <span className="flex-1 min-w-0 flex flex-col gap-[3px]">
                        <span className="text-[15px] font-medium truncate">{e.item.title}</span>
                        <span className="text-[13px] text-ink-3 truncate">{[e.label, e.title].filter(Boolean).join(" · ")}</span>
                      </span>
                      {time(e.at) && <span className="font-mono text-[12px] text-accent shrink-0">{time(e.at)}</span>}
                    </Link>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
