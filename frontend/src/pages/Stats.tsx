import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { useStats } from "../api/hooks";
import type { Stats as StatsT } from "../api/types";
import { BarList, DataTable, Heatmap, HeatmapLegend, Radar, RatingHistogram } from "../components/charts/charts";
import { ErrorLine, PageHeader, Segmented, SectionTitle } from "../components/ui";
import { num, parseDate, today } from "../lib/format";

function kpis(s: StatsT, all: boolean, year: number) {
  const k = s.kpis;
  const perFilm = k.films ? (k.hours * 60) / k.films : 0;
  const t0 = today();
  const elapsed = year === t0.getFullYear() ? Math.max(1, (t0.getTime() - new Date(year, 0, 1).getTime()) / 86400000) : 365;
  const gap = k.viewing_days ? elapsed / k.viewing_days : Infinity;
  return [
    { label: "FILMS", value: num(k.films), sub: `${num(k.watches)} watches, ${k.rewatched ? `${num(k.rewatched)} rewatched` : "none rewatched"}` },
    {
      label: "HOURS",
      value: all ? num(k.hours) : k.hours.toFixed(1),
      sub: all ? `about ${num(k.hours / 24)} days of film` : `about ${Math.floor(perFilm / 60)} h ${Math.round(perFilm % 60)} m per film`,
    },
    {
      label: "VIEWING DAYS",
      value: num(k.viewing_days),
      sub: all ? (k.first_year ? `since ${k.first_year}` : "no exact dates yet") : `one film a ${gap <= 10 ? "week" : gap <= 21 ? "fortnight" : "month"}`,
    },
    { label: "AVERAGE RATING", value: k.avg_rating != null ? k.avg_rating.toFixed(1) : "–", sub: "out of 10" },
  ];
}

function ChartPanel({ title, extra, right, table, children, className = "" }: { title: string; extra?: ReactNode; right?: ReactNode; table?: ReactNode; children: ReactNode; className?: string }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`p-6 rounded-[22px] bg-(--fill-glass) border border-(--line-2) flex flex-col ${className}`}>
      <div className="flex flex-wrap justify-between items-baseline gap-3">
        <SectionTitle>
          {title}
          {extra}
        </SectionTitle>
        <div className="flex items-center gap-3">
          {right}
          {table && (
            <button type="button" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)} className="font-mono text-[11px] text-ink-4 bg-transparent border-0 underline underline-offset-2 cursor-pointer p-0 leading-none hover:text-ink-3">
              {asTable ? "View as chart" : "View as table"}
            </button>
          )}
        </div>
      </div>
      {asTable ? table : children}
    </section>
  );
}

export default function Stats() {
  const [sp, setSp] = useSearchParams();
  const year = today().getFullYear();
  const range = sp.get("range") ?? "all";
  const all = range === "all";
  const { data: s, error } = useStats(range);

  return (
    <main className="flex flex-col gap-7 pt-9 px-12 pb-16 max-[1023px]:pt-7 max-[1023px]:px-6 max-[639px]:pt-5 max-[639px]:px-4 max-[639px]:pb-24 box-border min-w-0">
      <PageHeader title="Stats">
        <Segmented
          label="Range"
          value={all ? "all" : String(year)}
          onChange={(v) => setSp(v === "all" ? {} : { range: v }, { replace: true })}
          options={[{ id: "all", label: "All time" }, { id: String(year), label: String(year) }]}
          className="[&>button]:px-4"
        />
      </PageHeader>
      {error && <ErrorLine error={error} />}
      {s && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-4">
            {kpis(s, all, all ? year : Number(range)).map((k) => (
              <div key={k.label} className="p-[22px] rounded-[20px] bg-(--fill-glass) border border-(--line-2) flex flex-col gap-[10px]">
                <span className="font-mono text-[11px] tracking-[0.1em] text-ink-3">{k.label}</span>
                <span className="font-display font-medium text-[40px] leading-none">{k.value}</span>
                <span className="text-[13px] text-ink-4">{k.sub}</span>
              </div>
            ))}
          </div>

          <ChartPanel
            title="Viewing days"
            extra={<span className="font-sans font-normal text-[14px] text-ink-3"> · last 12 months · {s.heatmap.days.length} days</span>}
            right={<HeatmapLegend />}
            className="gap-4"
            table={<DataTable head={["DATE", "FILMS"]} rows={s.heatmap.days.map((d) => [parseDate(d.date).toDateString(), d.count])} />}
          >
            <Heatmap {...s.heatmap} />
          </ChartPanel>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-4">
            <ChartPanel title="Genres" className="gap-[10px]" table={<DataTable head={["GENRE", "SHARE OF TOP"]} rows={s.genres.map((g) => [g.name, `${Math.round(g.value * 100)}%`])} />}>
              {s.genres.length >= 3 ? <Radar genres={s.genres} /> : <p className="m-0 font-mono text-[13px] text-ink-4">Log films from a few more genres to draw this.</p>}
            </ChartPanel>

            <section className="p-6 rounded-[22px] bg-(--fill-glass) border border-(--line-2) flex flex-col gap-[22px]">
              <div className="flex flex-col gap-3">
                <SectionTitle>Top directors</SectionTitle>
                {s.directors.length ? <BarList rows={s.directors} /> : <p className="m-0 font-mono text-[13px] text-ink-4">Nothing yet</p>}
              </div>
              <div className="flex flex-col gap-3">
                <SectionTitle>Top actors</SectionTitle>
                {s.actors.length ? <BarList rows={s.actors} /> : <p className="m-0 font-mono text-[13px] text-ink-4">Nothing yet</p>}
              </div>
            </section>

            <ChartPanel
              title="Your ratings"
              className="gap-4"
              right={<span className="font-mono text-[12px] text-ink-3">mean {s.mean != null ? s.mean.toFixed(1) : "–"}</span>}
              table={<DataTable head={["RATING", "FILMS"]} rows={s.ratings.map((b) => [String(b.bin), b.count])} />}
            >
              <RatingHistogram bins={s.ratings} />
            </ChartPanel>
          </div>
        </>
      )}
    </main>
  );
}
