import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type DragEvent } from "react";
import { Link } from "react-router";
import { mediaApi, type ImportRow, type Kind, type MediaImportJob } from "../../api/media";
import { IconUpload } from "../../components/Icons";
import { useToast } from "../../components/Toasts";
import { Badge, Button, ErrorLine, MonoTag, PageHeader, Segmented, cx } from "../../components/ui";
import { formatWatchDate, rating } from "../../lib/format";
import { MODES, SOURCE_NAME, statusLabel } from "../../lib/mode";
import { pagePad } from "./parts";

const STATUS: Record<ImportRow["status"], string> = { matched: "matched", ambiguous: "pick one", unmatched: "no match", pending: "matching" };
const SOURCES: Record<Kind, { id: string; label: string; file: string; how: string }[]> = {
  book: [
    { id: "goodreads", label: "Goodreads", file: "goodreads_library_export.csv", how: "goodreads.com → My Books → Import and export → Export library" },
    { id: "storygraph", label: "StoryGraph", file: "your StoryGraph export CSV", how: "app.thestorygraph.com → Manage account → Export StoryGraph library" },
  ],
  show: [{ id: "imdb_tv", label: "IMDb", file: "IMDb ratings.csv", how: "imdb.com → Your ratings → ⋯ → Export. Only the TV rows are used; films stay with the movie import." }],
  game: [],
};

function ManualSearch({ kind, onPick }: { kind: Kind; onPick: (extId: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ ext_id: string; title: string; year: number | null; subtitle: string | null }[] | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (q.trim().length >= 2) setResults((await mediaApi.search(kind, q)).results); }}>
        <label className="flex-1 flex">
          <span className="absolute w-px h-px overflow-hidden [clip-path:inset(50%)]">Search {SOURCE_NAME[kind]}</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${SOURCE_NAME[kind]}…`} className="flex-1 min-w-0 h-11 px-3 rounded-[10px] border border-(--line-4) bg-(--fill-input) text-[13px] text-ink-hi" />
        </label>
        <Button type="submit" className="h-11 px-3 text-[13px]">Find</Button>
      </form>
      {results?.slice(0, 4).map((r) => (
        <button key={r.ext_id} type="button" onClick={() => onPick(r.ext_id)} className="text-left min-h-11 px-3 rounded-[10px] bg-transparent border border-(--line-3) text-[13px] cursor-pointer hover:bg-(--fill-ctl)">
          {r.title} <span className="font-mono text-ink-3">{[r.year, r.subtitle].filter(Boolean).join(" · ")}</span>
        </button>
      ))}
      {results && !results.length && <span className="font-mono text-[12px] text-ink-4">No matches on {SOURCE_NAME[kind]}</span>}
    </div>
  );
}

function Row({ kind, job, row, i }: { kind: Kind; job: MediaImportJob; row: ImportRow; i: number }) {
  const qc = useQueryClient();
  const patch = async (body: { ext_id?: string; include?: boolean }) => {
    await mediaApi.patchImportRow(job.id, i, body);
    void qc.invalidateQueries({ queryKey: ["media-import", job.id] });
  };
  const match = row.options?.find((o) => o.ext_id === row.ext_id);
  const raw = row.raw;
  return (
    <tr className="border-b border-(--divider) align-top">
      <td className="py-3 pr-3"><MonoTag>{STATUS[row.status]}</MonoTag></td>
      <td className="py-3 pr-3 text-[13px]">
        <div>{raw.title}{raw.author && <span className="text-ink-3"> · {raw.author}</span>}</div>
        <div className="font-mono text-[12px] text-ink-4">
          {statusLabel(kind, raw.status)}
          {raw.date && raw.precision === "day" && ` · ${formatWatchDate(raw.date, "day")}`}
          {raw.rating != null && <span className="text-ink-star"> · ★ {rating(raw.rating)}</span>}
        </div>
      </td>
      <td className="py-3 pr-3 text-[13px] min-w-[240px]">
        {row.status === "matched" && (match ? <span>{match.title} <span className="font-mono text-ink-3">{match.year}</span></span> : <span className="text-ink-3">Matched by ISBN</span>)}
        {row.status === "ambiguous" && (
          <fieldset className="m-0 p-0 border-0 flex flex-col gap-1">
            <legend className="absolute w-px h-px overflow-hidden [clip-path:inset(50%)]">Pick the right one for {raw.title}</legend>
            {row.options?.map((o) => (
              <label key={o.ext_id} className="flex items-center gap-2 min-h-9 cursor-pointer">
                <input type="radio" name={`row-${i}`} checked={row.ext_id === o.ext_id} onChange={() => patch({ ext_id: o.ext_id })} className="accent-accent size-4" />
                {o.title} <span className="font-mono text-ink-3">{[o.year, o.subtitle].filter(Boolean).join(" · ")}</span>
              </label>
            ))}
          </fieldset>
        )}
        {row.status === "unmatched" && <ManualSearch kind={kind} onPick={(id) => patch({ ext_id: id })} />}
        {row.status === "pending" && <span className="text-ink-4">…</span>}
      </td>
      <td className="py-3 text-right">
        <label className="inline-flex items-center justify-center size-11 cursor-pointer">
          <span className="absolute w-px h-px overflow-hidden [clip-path:inset(50%)]">Include {raw.title}</span>
          <input type="checkbox" disabled={!row.ext_id} checked={!!row.include} onChange={(e) => patch({ include: e.target.checked })} className="size-[18px] accent-accent" />
        </label>
      </td>
    </tr>
  );
}

/** Goodreads / StoryGraph (books) and IMDb (shows) imports, reviewed before anything is added. */
export default function MediaImport({ kind }: { kind: Kind }) {
  const sources = SOURCES[kind];
  const [source, setSource] = useState(sources[0]?.id ?? "");
  const [jobId, setJobId] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [done, setDone] = useState<{ created: number; skipped: number } | null>(null);
  const [committing, setCommitting] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const job = useQuery({
    queryKey: ["media-import", jobId],
    queryFn: () => mediaApi.importJob(jobId!),
    enabled: jobId != null,
    refetchInterval: (q) => (q.state.data && q.state.data.state !== "done" && q.state.data.state !== "failed" ? 1000 : false),
  });
  const src = sources.find((s) => s.id === source);
  const noun = MODES[kind].noun[1];
  const upload = async (files: File[]) => {
    if (!files[0]) return;
    setErr(null);
    setDone(null);
    try {
      setJobId((await mediaApi.importUpload(source, files[0])).job_id);
    } catch (e) {
      setErr(e);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    void upload([...e.dataTransfer.files]);
  };
  const j = job.data;
  const matching = j && j.state !== "done";
  if (!src) return null;

  return (
    <main className={cx("flex flex-col gap-7 pt-9 pb-16 max-[1023px]:pt-7 max-[639px]:pt-5 max-[639px]:pb-24 box-border min-w-0", pagePad)}>
      <PageHeader title="Import" subline={`${src.label}: ${src.file}`}>
        {sources.length > 1 && <Segmented label="Source" value={source} onChange={setSource} options={sources.map((s) => ({ id: s.id, label: s.label }))} />}
      </PageHeader>

      <label
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cx("h-[200px] rounded-[22px] border border-dashed grid place-items-center text-center cursor-pointer transition-colors",
          drag ? "border-accent bg-[color-mix(in_srgb,var(--color-accent)_6%,transparent)]" : "border-(--line-5) hover:bg-(--fill-glass)")}
      >
        <span className="flex flex-col items-center gap-3 px-4">
          <IconUpload size={22} className="text-ink-3" />
          <span className="text-[15px]">Drop {src.file} here, or click to choose</span>
          <span className="font-mono text-[12px] text-ink-4">{src.how}</span>
        </span>
        <input type="file" className="hidden" accept=".csv,text/csv" onChange={(e) => upload([...(e.target.files ?? [])])} />
      </label>

      {err != null && <ErrorLine error={err} onSettings />}
      {done && (
        <p className="m-0 text-[15px]">
          Imported {done.created} {noun}{done.skipped ? ` (${done.skipped} were already there)` : ""}. <Link to={MODES[kind].base}>Open your {noun}</Link>
        </p>
      )}

      {j && (
        <section className="flex flex-col">
          {matching && <p className="m-0 mb-4 font-mono text-[13px] text-ink-3b">Matching {j.progress.done} of {j.progress.total} on {SOURCE_NAME[kind]}…</p>}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left font-mono text-[11px] tracking-[0.08em] text-ink-3">
                  {["STATUS", "FROM THE FILE", "MATCH", "INCLUDE"].map((h, i) => (
                    <th key={i} className={cx("font-normal pb-2 border-b border-(--line-3)", i === 3 && "text-right")}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>{j.rows.map((r, i) => <Row key={i} kind={kind} job={j} row={r} i={i} />)}</tbody>
            </table>
          </div>
          {!j.committed && (
            <div className="sticky bottom-0 max-[639px]:bottom-16 mt-4 flex flex-wrap items-center justify-between gap-4 py-4 px-5 rounded-[20px] bg-[rgba(12,14,19,0.9)] border border-(--line-3) backdrop-blur-[24px]">
              <div className="flex flex-wrap gap-2">
                <Badge>{j.summary.matched} matched</Badge>
                <Badge>{j.summary.ambiguous} to pick</Badge>
                <Badge>{j.summary.unmatched} no match</Badge>
              </div>
              <Button
                variant="primary" disabled={!!matching || !j.summary.included || committing}
                onClick={async () => {
                  setCommitting(true);
                  try {
                    const r = await mediaApi.commitImport(j.id);
                    setDone(r);
                    setJobId(null);
                    void qc.invalidateQueries({ queryKey: ["media"] });
                    toast({ text: `Imported ${r.created} ${noun}` });
                  } catch (e) {
                    setErr(e);
                  } finally {
                    setCommitting(false);
                  }
                }}
              >
                {committing ? "Importing…" : `Import ${j.summary.included} ${noun}`}
              </Button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
