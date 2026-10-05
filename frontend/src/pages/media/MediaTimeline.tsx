import { useEffect, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMediaTimeline, useMediaYears, type Kind, type MediaTimeline as T, type TimelineEntry } from "../../api/media";
import { YearBars } from "../../components/charts/YearBars";
import { IconChevronLeft, IconChevronRight } from "../../components/Icons";
import { Poster, posterBg } from "../../components/Poster";
import { IconButton, PageHeader, SectionTitle } from "../../components/ui";
import { MONTHS, dayLabel, num, rating, today } from "../../lib/format";
import { MODES } from "../../lib/mode";
import { asFilm, itemPath } from "./parts";

const ACTIVITY: Record<Kind, [string, string]> = { show: ["episode", "episodes"], book: ["reading session", "reading sessions"], game: ["session", "sessions"] };
const FINISH: Record<Kind, string> = { show: "completed", book: "finished", game: "beaten" };

function Entry({ e, approx }: { e: TimelineEntry; approx?: boolean }) {
  return (
    <Link to={itemPath(e)} className="timeline-poster flex flex-col gap-2 w-28 no-underline text-inherit hover:text-inherit" aria-label={`${e.title}, ${dayLabel(e.run.finished_on, e.run.precision)}`}>
      <Poster
        film={asFilm(e)} size="timeline" layout={false} shadow={`0 20px 36px -18px ${posterBg(asFilm(e))}`}
        style={approx ? { outline: "1.5px dashed rgba(236,238,243,0.55)", outlineOffset: 3 } : undefined}
      />
      <div className="flex justify-between font-mono text-[12px]">
        <span className="text-ink">{dayLabel(e.run.finished_on, e.run.precision)}</span>
        {e.run.rating != null && <span className="text-ink-star">★ {rating(e.run.rating)}</span>}
      </div>
    </Link>
  );
}

function Column({ kind, title, items, approx = [], activity, opacity = 1, now, isLast }: {
  kind: Kind; title: string; items: TimelineEntry[]; approx?: TimelineEntry[]; activity?: number; opacity?: number; now?: number | null; isLast?: boolean;
}) {
  const n = items.length + approx.length;
  const sub = [n ? `${n} ${FINISH[kind]}` : null, activity ? `${activity} ${ACTIVITY[kind][activity === 1 ? 0 : 1]}` : null].filter(Boolean).join(" · ") || "nothing yet";
  return (
    <div className="flex flex-col gap-[18px] pr-7 min-w-[120px] box-content" style={{ opacity }} data-now={now != null || undefined}>
      <div className="flex flex-col gap-1 pl-[2px]">
        <span className="font-display font-medium text-[20px] whitespace-nowrap">{title}</span>
        <span className="font-mono text-[11px] text-ink-4">{sub}</span>
      </div>
      <div className="relative h-[14px]">
        <div className="absolute left-0 top-[6px] h-[2px] bg-(--line-3)" style={{ right: isLast ? 0 : -28 }} />
        <div className="absolute left-0 top-0 w-[2px] h-[14px] bg-[rgba(255,255,255,0.28)]" />
        {now != null && (
          <div className="absolute top-[-4px] flex items-center gap-[6px]" style={{ left: `max(14px, ${now * 100}%)` }}>
            <span className="size-[10px] rounded-full bg-accent shadow-[0_0_14px_var(--color-accent)]" />
            <span className="font-mono text-[11px] text-accent">TODAY</span>
          </div>
        )}
      </div>
      <div className="flex gap-[14px] items-start">
        {items.map((e) => <Entry key={e.run.id} e={e} />)}
        {approx.map((e) => <Entry key={e.run.id} e={e} approx />)}
      </div>
    </div>
  );
}

function subline(kind: Kind, d: T, current: boolean): string {
  const t = d.totals;
  const amount = kind === "book" ? `${num(t.pages ?? 0)} pages read` : `${(t.hours ?? 0).toFixed(1)} hours${kind === "show" ? ` · ${num(t.episodes ?? 0)} episodes` : ""}`;
  return [`${t.finished} ${FINISH[kind]}`, t.approx ? `${t.approx} with approximate dates` : null, `${amount}${current ? " so far" : ""}`].filter(Boolean).join(" · ");
}

export default function MediaTimeline({ kind }: { kind: Kind }) {
  const nav = useNavigate();
  const t0 = today();
  const year = Number(useParams().year) || t0.getFullYear();
  const tl = useMediaTimeline(kind, year);
  const years = useMediaYears(kind);
  const strip = useRef<HTMLElement>(null);
  const base = `${MODES[kind].base}/timeline`;
  const ys = years.data ?? [];
  const first = ys[0]?.year ?? year;
  const last = Math.max(ys[ys.length - 1]?.year ?? year, t0.getFullYear());
  const isCurrent = year === t0.getFullYear();
  const d = tl.data;

  useEffect(() => {
    const el = strip.current;
    if (!el || !d) return;
    const nowCol = el.querySelector<HTMLElement>("[data-now]");
    el.scrollLeft = nowCol ? Math.max(0, nowCol.offsetLeft + nowCol.offsetWidth - el.clientWidth + 48) : 0;
  }, [d, year]);

  return (
    <main className="flex flex-col gap-9 pt-9 pb-16 max-[1023px]:pt-7 max-[639px]:pt-5 max-[639px]:pb-24 min-w-0">
      <PageHeader title={year} subline={d ? subline(kind, d, isCurrent) : " "} className="px-12 max-[1023px]:px-6 max-[639px]:px-4">
        <div className="flex gap-2">
          <IconButton label="Previous year" disabled={year <= first} onClick={() => nav(`${base}/${year - 1}`)} className="bg-(--fill-glass)! disabled:opacity-40 disabled:cursor-default">
            <IconChevronLeft size={16} />
          </IconButton>
          <IconButton label="Next year" disabled={year >= last} onClick={() => nav(`${base}/${year + 1}`)} className="bg-(--fill-glass)! disabled:opacity-40 disabled:cursor-default">
            <IconChevronRight size={16} />
          </IconButton>
        </div>
      </PageHeader>

      <section ref={strip} aria-label={`${MODES[kind].label} by month`} className="overflow-x-auto scroll-quiet px-12 pb-3 max-[1023px]:px-6 max-[639px]:px-4">
        {d && (
          <div className="flex w-max relative">
            {d.months.map((m, i) => {
              const future = year > t0.getFullYear() || (isCurrent && i > t0.getMonth());
              const isNow = isCurrent && i === t0.getMonth();
              const dim = new Date(year, i + 1, 0).getDate();
              return (
                <Column key={m.month} kind={kind} title={MONTHS[i]} items={m.items} approx={m.approx} activity={m.activity}
                  opacity={future ? 0.35 : 1} now={isNow ? (t0.getDate() - 1) / dim : null} isLast={i === 11 && !d.year_only.length} />
              );
            })}
            {d.year_only.length > 0 && <Column kind={kind} title={`Sometime in ${year}`} items={[]} approx={d.year_only} isLast />}
          </div>
        )}
      </section>

      <section aria-label="All years" className="mx-12 max-[1023px]:mx-6 max-[639px]:mx-4 p-[26px] max-[639px]:p-5 rounded-[22px] bg-(--fill-glass) border border-(--line-2) backdrop-blur-[24px] flex flex-col gap-[22px]">
        <div className="flex flex-wrap justify-between items-baseline gap-[14px]">
          <SectionTitle>Every year</SectionTitle>
          <div className="flex gap-[18px] text-[12px] text-ink-3">
            <span className="flex items-center gap-2"><span className="size-3 rounded-[3px] bg-accent" />exact day</span>
            <span className="flex items-center gap-2"><span className="size-3 rounded-[3px] box-border border-[1.5px] border-dashed border-accent" />month or year only</span>
          </div>
        </div>
        {ys.length ? (
          <YearBars years={ys} selected={year} onPick={(y) => nav(`${base}/${y}`)} />
        ) : (
          <p className="m-0 font-mono text-[13px] text-ink-4">Finish a {MODES[kind].noun[0]} and your years appear here.</p>
        )}
      </section>
    </main>
  );
}
