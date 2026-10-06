import { useSearchParams } from "react-router";
import { useAllStats, useMediaStats, type AllStats, type Kind, type MediaStats as S } from "../../api/media";
import { useSettings } from "../../api/hooks";
import { BarList, DataTable, Heatmap, HeatmapLegend, Radar, RatingHistogram } from "../../components/charts/charts";
import { ErrorLine, PageHeader, Segmented, SectionTitle, cx } from "../../components/ui";
import { num, parseDate, today } from "../../lib/format";
import { MODES } from "../../lib/mode";
import { ChartPanel } from "../Stats";
import { pagePad } from "./parts";

const pct = (v: number | null) => (v == null ? "–" : `${Math.round(v * 100)}%`);

function kpis(kind: Kind, s: S) {
  const k = s.kpis;
  const [one, many] = MODES[kind].noun;
  const finish = { show: "COMPLETED", book: "FINISHED", game: "BEATEN" }[kind];
  const drop = { show: "dropped", book: "did not finish", game: "dropped" }[kind];
  const amount =
    kind === "book"
      ? { label: "PAGES READ", value: num(k.pages ?? 0), sub: k.finished ? `about ${num(Math.round((k.pages ?? 0) / Math.max(k.finished, 1)))} per book finished` : "log progress to count pages" }
      : { label: kind === "show" ? "HOURS WATCHED" : "HOURS PLAYED", value: num(Math.round(k.hours ?? 0)), sub: kind === "show" ? `${num(k.episodes ?? 0)} episodes` : `across ${num(k.items)} ${k.items === 1 ? one : many}` };
  return [
    { label: finish, value: num(k.finished), sub: `${num(k.in_progress)} in progress · ${num(k.items)} in your library` },
    amount,
    { label: kind === "book" ? "DNF RATE" : "DROP RATE", value: pct(k.drop_rate), sub: `${num(k.dropped)} ${drop}` },
    { label: "AVERAGE RATING", value: k.avg_rating != null ? k.avg_rating.toFixed(1) : "–", sub: `${num(k.active_days)} active days` },
  ];
}

function Tiles({ tiles }: { tiles: { label: string; value: string; sub: string }[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-4">
      {tiles.map((k) => (
        <div key={k.label} className="p-[22px] rounded-[20px] bg-(--fill-glass) border border-(--line-2) flex flex-col gap-[10px]">
          <span className="font-mono text-[11px] tracking-[0.1em] text-ink-3">{k.label}</span>
          <span className="font-display font-medium text-[40px] leading-none">{k.value}</span>
          <span className="text-[13px] text-ink-4">{k.sub}</span>
        </div>
      ))}
    </div>
  );
}

/** Every enabled medium side by side (movies read-only): finishes, time, pages, drop and DNF rates. */
function AllMedia({ data }: { data: AllStats }) {
  const max = Math.max(...data.rows.map((r) => r.hours ?? 0), 1);
  return (
    <>
      <Tiles tiles={[
        { label: "HOURS, ALL MEDIA", value: num(Math.round(data.hours)), sub: `about ${num(Math.round(data.hours / 24))} days` },
        ...data.rows.map((r) => ({ label: r.label.toUpperCase(), value: num(r.finished), sub: r.finished_label })),
      ]} />
      <section className="p-6 rounded-[22px] bg-(--fill-glass) border border-(--line-2) flex flex-col gap-4">
        <SectionTitle>Side by side</SectionTitle>
        <div className="flex flex-col">
          {data.rows.map((r) => (
            <div key={r.kind} className="grid grid-cols-[110px_1fr_auto] max-[639px]:grid-cols-1 items-center gap-x-5 gap-y-2 py-[14px] border-b border-(--divider) last:border-0">
              <span className="text-[15px] font-medium">{r.label}</span>
              <span className="h-[6px] rounded-full bg-white/[0.06] overflow-hidden">
                <span className="block h-full rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]" style={{ width: `${((r.hours ?? 0) / max) * 100}%` }} />
              </span>
              <span className="font-mono text-[12px] text-ink-3 whitespace-nowrap">
                {[r.hours != null && `${num(Math.round(r.hours))} h`, r.pages != null && `${num(r.pages)} pages`, r.drop_rate != null && `${pct(r.drop_rate)} ${r.drop_label}`].filter(Boolean).join(" · ")}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export default function MediaStats({ kind }: { kind: Kind }) {
  const [sp, setSp] = useSearchParams();
  const year = today().getFullYear();
  const range = sp.get("range") ?? "all";
  const view = sp.get("view") === "all" ? "all" : "one";
  const { data: settings } = useSettings();
  const { data: s, error } = useMediaStats(kind, range);
  const all = useAllStats(range, view === "all");
  const multi = Object.entries(settings?.flags ?? {}).filter(([f, on]) => on && f.startsWith("media.")).length >= 1;
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    setSp(next, { replace: true });
  };
  const noun = MODES[kind].noun[1];

  return (
    <main className={cx("flex flex-col gap-7 pt-9 pb-16 max-[1023px]:pt-7 max-[639px]:pt-5 max-[639px]:pb-24 box-border min-w-0", pagePad)}>
      <PageHeader title="Stats">
        {multi && (
          <Segmented label="Scope" value={view} onChange={(v) => set("view", v === "all" ? "all" : null)}
            options={[{ id: "one", label: MODES[kind].label }, { id: "all", label: "All media" }]} className="[&>button]:px-4" />
        )}
        <Segmented label="Range" value={range === "all" ? "all" : String(year)} onChange={(v) => set("range", v === "all" ? null : v)}
          options={[{ id: "all", label: "All time" }, { id: String(year), label: String(year) }]} className="[&>button]:px-4" />
      </PageHeader>
      {error && <ErrorLine error={error} />}
      {view === "all" ? (
        all.data ? <AllMedia data={all.data} /> : all.error ? <ErrorLine error={all.error} /> : <div className="skeleton h-[200px] rounded-[22px]" />
      ) : (
        s && (
          <>
            <Tiles tiles={kpis(kind, s)} />
            <ChartPanel
              title="Active days"
              extra={<span className="font-sans font-normal text-[14px] text-ink-3"> · last 12 months · {s.heatmap.days.length} days</span>}
              right={<HeatmapLegend unit={kind === "show" ? "episodes" : "updates"} />}
              className="gap-4"
              table={<DataTable head={["DATE", "ACTIVITY"]} rows={s.heatmap.days.map((d) => [parseDate(d.date).toDateString(), d.count])} />}
            >
              <Heatmap {...s.heatmap} />
            </ChartPanel>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-4">
              <ChartPanel title="Genres" className="gap-[10px]" table={<DataTable head={["GENRE", "SHARE OF TOP"]} rows={s.genres.map((g) => [g.name, `${Math.round(g.value * 100)}%`])} />}>
                {s.genres.length >= 3 ? <Radar genres={s.genres.map((g) => ({ ...g, name: g.name.length > 13 ? `${g.name.slice(0, 12)}…` : g.name }))} /> : <p className="m-0 font-mono text-[13px] text-ink-4">Add {noun} from a few more genres to draw this.</p>}
              </ChartPanel>
              <section className="p-6 rounded-[22px] bg-(--fill-glass) border border-(--line-2) flex flex-col gap-[22px]">
                {s.people.map((p) => (
                  <div key={p.title} className="flex flex-col gap-3">
                    <SectionTitle>{p.title}</SectionTitle>
                    {p.rows.length ? <BarList rows={p.rows} /> : <p className="m-0 font-mono text-[13px] text-ink-4">Nothing yet</p>}
                  </div>
                ))}
              </section>
              <ChartPanel
                title="Your ratings" className="gap-4"
                right={<span className="font-mono text-[12px] text-ink-3">mean {s.mean != null ? s.mean.toFixed(1) : "–"}</span>}
                table={<DataTable head={["RATING", noun.toUpperCase()]} rows={s.ratings.map((b) => [String(b.bin), b.count])} />}
              >
                <RatingHistogram bins={s.ratings} />
              </ChartPanel>
            </div>
          </>
        )
      )}
    </main>
  );
}
