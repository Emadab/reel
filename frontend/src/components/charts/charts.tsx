import { mix } from "../Glow";
import { monthShort, parseDate } from "../../lib/format";

const accent = "var(--color-accent)";

/** Heatmap: 53 Monday-first weeks from `start`, 14 px cells, gap 3. Level 0 / 1 / 2+. */
export function Heatmap({ start, end, days }: { start: string; end: string; days: { date: string; count: number }[] }) {
  const counts = new Map(days.map((d) => [d.date, d.count]));
  const s = parseDate(start);
  const e = parseDate(end).getTime();
  const lvl1 = mix(accent, 55, "#07080C");
  const weeks: { key: string; label: string; n: number; future: boolean }[][] = [];
  const monthLabels: string[] = [];
  let lastMonth = -1;
  for (let w = 0; w < 53; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date(s.getFullYear(), s.getMonth(), s.getDate() + w * 7 + d);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      col.push({ key, label: `${monthShort(dt.getMonth())} ${dt.getDate()}`, n: counts.get(key) ?? 0, future: dt.getTime() > e });
    }
    const m = new Date(s.getFullYear(), s.getMonth(), s.getDate() + w * 7).getMonth();
    monthLabels.push(m !== lastMonth ? monthShort(m) : "");
    lastMonth = m;
    weeks.push(col);
  }
  return (
    <div className="overflow-x-auto scroll-quiet">
      <div className="flex flex-col gap-[6px] w-max">
        <div className="flex gap-[3px] font-mono text-[11px] text-ink-4 pl-[30px]" aria-hidden>
          {monthLabels.map((ml, i) => (
            <span key={i} className="w-[14px] whitespace-nowrap overflow-visible">{ml}</span>
          ))}
        </div>
        <div className="flex gap-[3px]">
          <div className="w-[27px] flex flex-col gap-[3px] font-mono text-[10px] text-ink-4" aria-hidden>
            {["Mon", "", "Wed", "", "Fri", "", "Sun"].map((d, i) => <span key={i} className="h-[14px] leading-[14px]">{d}</span>)}
          </div>
          {weeks.map((col, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              {col.map((d) => {
                const tip = `${d.label}: ${d.n === 0 ? "no films" : d.n === 1 ? "1 film" : `${d.n} films`}`;
                return (
                  <span
                    key={d.key}
                    title={d.future ? undefined : tip}
                    className="size-[14px] rounded-[3px] hover:outline-[1.5px] hover:outline-white hover:outline-offset-1"
                    style={{ background: d.future ? "transparent" : d.n === 0 ? "var(--fill-cell-empty)" : d.n === 1 ? lvl1 : accent }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function HeatmapLegend({ unit = "films" }: { unit?: string }) {
  return (
    <div className="flex items-center gap-[6px] text-[12px] text-ink-3" aria-hidden>
      <span>none</span>
      <span className="size-[13px] rounded-[3px] bg-(--fill-cell-empty)" />
      <span className="size-[13px] rounded-[3px]" style={{ background: mix(accent, 55, "#07080C") }} />
      <span className="size-[13px] rounded-[3px] bg-accent" />
      <span>2 {unit}</span>
    </div>
  );
}

/** Radar: viewBox -30 0 380 300, centre (160,150), R 105, rings at 25/50/75/100%. */
export function Radar({ genres }: { genres: { name: string; value: number }[] }) {
  const cx = 160, cy = 150, R = 105;
  const n = genres.length;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v];
  };
  const poly = (v: number) => genres.map((_, i) => pt(i, v).map((x) => x.toFixed(1)).join(",")).join(" ");
  return (
    <svg viewBox="-30 0 380 300" role="img" aria-label={`Genre profile: ${genres.map((g) => `${g.name} ${Math.round(g.value * 100)}%`).join(", ")}`} className="w-full h-auto">
      {[0.25, 0.5, 0.75, 1].map((r) => <polygon key={r} points={poly(r)} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={1} />)}
      {genres.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x.toFixed(1)} y2={y.toFixed(1)} stroke="rgba(255,255,255,0.09)" strokeWidth={1} />;
      })}
      <polygon points={genres.map((g, i) => pt(i, g.value).map((x) => x.toFixed(1)).join(",")).join(" ")} fill={mix(accent, 22)} stroke={accent} strokeWidth={2} strokeLinejoin="round" />
      {genres.map((g, i) => {
        const [x, y] = pt(i, g.value);
        return (
          <circle key={g.name} cx={x.toFixed(1)} cy={y.toFixed(1)} r={4} fill={accent} stroke="#101218" strokeWidth={2} data-tip={`${g.name}: ${Math.round(g.value * 100)}% of your top genre`} />
        );
      })}
      {genres.map((g, i) => {
        const [x, y] = pt(i, 1.2);
        const anchor = Math.abs(x - cx) < 4 ? "middle" : x > cx ? "start" : "end";
        return <text key={g.name} x={x.toFixed(1)} y={y.toFixed(1)} textAnchor={anchor} dominantBaseline="middle" fill="#C3C8D1" fontSize={12} fontFamily="Geist, sans-serif">{g.name}</text>;
      })}
    </svg>
  );
}

export function BarList({ rows }: { rows: { name: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ol className="list-none m-0 p-0 flex flex-col gap-[10px]">
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-center">
          <span className="text-[14px] truncate">{r.name}</span>
          <span className="font-mono text-[13px] text-ink-2b">{r.count}</span>
          <span className="col-span-full h-1 rounded-[4px] bg-(--fill-tag)">
            <span className="block h-1 rounded-[4px] bg-accent" style={{ width: `${Math.round((r.count / max) * 100)}%` }} />
          </span>
        </li>
      ))}
    </ol>
  );
}

/** 10 half-star bins, plot height 170 + counts. */
export function RatingHistogram({ bins }: { bins: { bin: number; count: number }[] }) {
  const max = Math.max(1, ...bins.map((b) => b.count));
  const label = (r: number) => (r % 1 ? r.toFixed(1) : String(r));
  return (
    <>
      <div className="flex-1 grid grid-cols-10 gap-[6px] items-end min-h-[220px]">
        {bins.map((b) => (
          <div key={b.bin} title={`${b.bin} out of 10: ${b.count} films`} className="group flex flex-col justify-end items-stretch gap-[6px] h-full">
            <span className="font-mono text-[11px] text-center text-ink-2b">{b.count}</span>
            <span
              className="rounded-[4px_4px_0_0] group-hover:brightness-125"
              style={{ height: Math.max(2, Math.round((b.count / max) * 170)), background: b.count ? accent : "rgba(255,255,255,0.08)" }}
            />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-10 gap-[6px] border-t border-(--line-4) pt-2" aria-hidden>
        {bins.map((b) => <span key={b.bin} className="font-mono text-[11px] text-center text-ink-4">{label(b.bin)}</span>)}
      </div>
    </>
  );
}

/** "View as table" alternative for charts. */
export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="max-h-[300px] overflow-y-auto scroll-quiet">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>{head.map((h) => <th key={h} className="text-left font-mono text-[11px] tracking-[0.08em] text-ink-3 font-normal py-2 border-b border-(--line-3)">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className="py-[6px] border-b border-(--divider)">{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
