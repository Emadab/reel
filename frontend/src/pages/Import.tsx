import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type DragEvent } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import type { ImportJob, ImportRow } from "../api/types";
import { IconUpload } from "../components/Icons";
import { Poster } from "../components/Poster";
import { useToast } from "../components/Toasts";
import { Badge, Button, ErrorLine, MonoTag, PageHeader, Segmented, cx } from "../components/ui";
import { formatWatchDate, rating } from "../lib/format";

type Source = "letterboxd" | "imdb";
const STATUS: Record<ImportRow["status"], string> = { matched: "matched", ambiguous: "pick one", unmatched: "no match", pending: "matching" };

function ManualSearch({ onPick }: { onPick: (id: number) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ tmdb_id: number; title: string; year: number | null }[] | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (q.trim().length >= 2) setResults((await api.search(q)).results);
        }}
      >
        <label className="flex-1 flex">
          <span className="absolute w-px h-px overflow-hidden [clip-path:inset(50%)]">Search TMDB</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search TMDB…" className="flex-1 min-w-0 h-11 px-3 rounded-[10px] border border-(--line-4) bg-(--fill-input) text-[13px] text-ink-hi" />
        </label>
        <Button type="submit" className="h-11 px-3 text-[13px]">Find</Button>
      </form>
      {results?.slice(0, 4).map((r) => (
        <button key={r.tmdb_id} type="button" onClick={() => onPick(r.tmdb_id)} className="text-left min-h-11 px-3 rounded-[10px] bg-transparent border border-(--line-3) text-[13px] cursor-pointer hover:bg-(--fill-ctl)">
          {r.title} <span className="font-mono text-ink-3">{r.year}</span>
        </button>
      ))}
      {results && !results.length && <span className="font-mono text-[12px] text-ink-4">No matches on TMDB</span>}
    </div>
  );
}

function Row({ job, row, i }: { job: ImportJob; row: ImportRow; i: number }) {
  const qc = useQueryClient();
  const patch = async (body: { tmdb_id?: number; include?: boolean }) => {
    await api.patchImportRow(job.id, i, body);
    qc.invalidateQueries({ queryKey: ["import", job.id] });
  };
  const match = row.options?.find((o) => o.tmdb_id === row.tmdb_id);
  const raw = row.raw;
  return (
    <tr className="border-b border-(--divider) align-top">
      <td className="py-3 pr-3"><MonoTag>{STATUS[row.status]}</MonoTag></td>
      <td className="py-3 pr-3 w-[44px]">
        {match ? <Poster film={{ ...match, poster: null, poster_art: { bg: "#1A1D24" } }} size="thumb" className="w-9" layout={false} /> : <span className="block w-9 aspect-[2/3] rounded-[6px] bg-(--fill-ctl)" />}
      </td>
      <td className="py-3 pr-3 text-[13px]">
        <div>{raw.title}{raw.year && <span className="font-mono text-ink-3"> · {raw.year}</span>}</div>
        <div className="font-mono text-[12px] text-ink-4">
          {formatWatchDate(raw.watched_on, raw.date_precision)}
          {raw.rating != null && <span className="text-ink-star"> · ★ {rating(raw.rating)}</span>}
        </div>
      </td>
      <td className="py-3 pr-3 text-[13px] min-w-[220px]">
        {row.status === "matched" && match && <span>{match.title} <span className="font-mono text-ink-3">{match.year}</span></span>}
        {row.status === "matched" && !match && <span className="text-ink-3">Picked manually</span>}
        {row.status === "ambiguous" && (
          <fieldset className="m-0 p-0 border-0 flex flex-col gap-1">
            <legend className="absolute w-px h-px overflow-hidden [clip-path:inset(50%)]">Pick the right film for {raw.title}</legend>
            {row.options?.map((o) => (
              <label key={o.tmdb_id} className="flex items-center gap-2 min-h-9 cursor-pointer">
                <input type="radio" name={`row-${i}`} checked={row.tmdb_id === o.tmdb_id} onChange={() => patch({ tmdb_id: o.tmdb_id })} className="accent-accent size-4" />
                {o.title} <span className="font-mono text-ink-3">{o.year}</span>
              </label>
            ))}
          </fieldset>
        )}
        {row.status === "unmatched" && <ManualSearch onPick={(id) => patch({ tmdb_id: id })} />}
        {row.status === "pending" && <span className="text-ink-4">…</span>}
      </td>
      <td className="py-3 text-right">
        <label className="inline-flex items-center justify-center size-11 cursor-pointer">
          <span className="absolute w-px h-px overflow-hidden [clip-path:inset(50%)]">Include {raw.title}</span>
          <input type="checkbox" disabled={!row.tmdb_id} checked={!!row.include} onChange={(e) => patch({ include: e.target.checked })} className="size-[18px] accent-accent" />
        </label>
      </td>
    </tr>
  );
}

export default function Import() {
  const [source, setSource] = useState<Source>("letterboxd");
  const [jobId, setJobId] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [done, setDone] = useState<{ created: number; skipped: number } | null>(null);
  const [committing, setCommitting] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const job = useQuery({
    queryKey: ["import", jobId],
    queryFn: () => api.importJob(jobId!),
    enabled: jobId != null,
    refetchInterval: (q) => (q.state.data && q.state.data.state !== "done" && q.state.data.state !== "failed" ? 1000 : false),
  });

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setErr(null);
    setDone(null);
    try {
      const r = await api.importUpload(source, files);
      setJobId(r.job_id);
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

  return (
    <main className="flex flex-col gap-7 pt-9 px-12 pb-16 max-[1023px]:pt-7 max-[1023px]:px-6 max-[639px]:pt-5 max-[639px]:px-4 max-[639px]:pb-24 box-border min-w-0">
      <PageHeader title="Import" subline={source === "letterboxd" ? "Letterboxd export: the zip, or diary.csv + ratings.csv" : "IMDb: your ratings.csv export"}>
        <Segmented<Source> label="Source" value={source} onChange={setSource} options={[{ id: "letterboxd", label: "Letterboxd" }, { id: "imdb", label: "IMDb" }]} />
      </PageHeader>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cx(
          "h-[200px] rounded-[22px] border border-dashed grid place-items-center text-center cursor-pointer transition-colors",
          drag ? "border-accent bg-[color-mix(in_srgb,var(--color-accent)_6%,transparent)]" : "border-(--line-5) hover:bg-(--fill-glass)",
        )}
      >
        <span className="flex flex-col items-center gap-3">
          <IconUpload size={22} className="text-ink-3" />
          <span className="text-[15px]">Drop your {source === "letterboxd" ? "Letterboxd export" : "IMDb ratings.csv"} here, or click to choose</span>
          <span className="font-mono text-[12px] text-ink-4">
            {source === "letterboxd" ? "letterboxd.com → Settings → Import & Export → Export your data" : "imdb.com → Your ratings → ⋯ → Export"}
          </span>
        </span>
        <input type="file" className="hidden" multiple={source === "letterboxd"} accept=".zip,.csv,text/csv" onChange={(e) => upload([...(e.target.files ?? [])])} />
      </label>

      {err != null && <ErrorLine error={err} onSettings />}
      {done && (
        <p className="m-0 text-[15px]">
          Imported {done.created} watches{done.skipped ? ` (${done.skipped} were already there)` : ""}. Posters keep downloading in the background.{" "}
          <Link to="/">Open your library</Link>
        </p>
      )}

      {j && (
        <section className="flex flex-col">
          {matching && (
            <p className="m-0 mb-4 font-mono text-[13px] text-ink-3b">
              Matching {j.progress.done} of {j.progress.total} on TMDB…
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left font-mono text-[11px] tracking-[0.08em] text-ink-3">
                  {["STATUS", "", "FROM THE FILE", "MATCH", "INCLUDE"].map((h, i) => (
                    <th key={i} className={cx("font-normal pb-2 border-b border-(--line-3)", i === 4 && "text-right")}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {j.rows.map((r, i) => <Row key={i} job={j} row={r} i={i} />)}
              </tbody>
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
                variant="primary"
                disabled={!!matching || !j.summary.included || committing}
                onClick={async () => {
                  setCommitting(true);
                  try {
                    const r = await api.commitImport(j.id);
                    setDone(r);
                    setJobId(null);
                    qc.invalidateQueries();
                    toast({ text: `Imported ${r.created} watches` });
                  } catch (e) {
                    setErr(e);
                  } finally {
                    setCommitting(false);
                  }
                }}
              >
                {committing ? "Importing…" : `Import ${j.summary.included} watches`}
              </Button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
