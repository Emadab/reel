import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { api } from "../api/client";
import { useSettings } from "../api/hooks";
import type { SettingsOut } from "../api/types";
import { useToast } from "../components/Toasts";
import { Button, ButtonLink, PageHeader, Panel, SectionTitle, cx } from "../components/ui";
import { MediaSettings } from "./settings/MediaSettings";

const input = "h-11 px-[14px] rounded-[12px] border border-(--line-4) bg-(--fill-input) text-ink-hi text-[14px] min-w-0 flex-1 placeholder:text-ink-4";

function KeyForm({ label, hint, configured, onSave, status }: { label: string; hint: ReactNode; configured: boolean; onSave: (v: string) => Promise<void>; status?: ReactNode }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const id = label.replace(/\W+/g, "-").toLowerCase();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await onSave(v.trim());
      setV("");
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[13px] font-medium">{label}</label>
      <div className="flex flex-wrap gap-[10px]">
        <input id={id} type="password" autoComplete="off" spellCheck={false} placeholder={configured ? "Saved. Paste a new one to replace it" : "Paste it here"} value={v} onChange={(e) => setV(e.target.value)} className={input} />
        <Button type="submit" disabled={busy || !v.trim()}>{busy ? "Checking…" : "Save"}</Button>
      </div>
      <div className="flex flex-wrap gap-3 items-baseline text-[12px] text-ink-4">
        {status}
        <span>{hint}</span>
      </div>
      {err && <p className="m-0 font-mono text-[12px] text-wild">{err}</p>}
    </form>
  );
}

export default function Settings() {
  const { data: s } = useSettings();
  const qc = useQueryClient();
  const toast = useToast();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [dataDir, setDataDir] = useState("");
  const [restoring, setRestoring] = useState(false);
  const apply = (next: SettingsOut) => qc.setQueryData(["settings"], next);

  return (
    <main className="flex flex-col gap-7 pt-9 px-12 pb-16 max-[1023px]:pt-7 max-[1023px]:px-6 max-[639px]:pt-5 max-[639px]:px-4 max-[639px]:pb-24 box-border min-w-0 max-w-[1000px]">
      <PageHeader title="Settings" />
      {s && (
        <>
          <MediaSettings
            s={s}
            movieKeys={
              <>
                <KeyForm
                  label="TMDB API Read Access Token"
                  configured={s.tmdb_configured}
                  status={
                    connected ?? s.tmdb_connected ? <span className="font-mono text-score">Connected</span> : s.tmdb_configured ? (
                      <button type="button" className="font-mono text-ink-3 bg-transparent border-0 p-0 underline cursor-pointer" onClick={async () => setConnected(!!(await api.testTmdb()).tmdb_connected)}>
                        Test connection
                      </button>
                    ) : <span className="font-mono text-wild">Not set</span>
                  }
                  hint={<>The long token from themoviedb.org → Settings → API. It is stored in backend/.env and never sent to this page.</>}
                  onSave={async (v) => {
                    const next = await api.putSettings({ tmdb_token: v });
                    apply(next);
                    setConnected(true);
                    qc.invalidateQueries();
                    toast({ text: "TMDB connected" });
                  }}
                />
                <KeyForm
                  label="OMDb key (optional)"
                  configured={s.omdb_configured}
                  status={s.omdb_configured ? <span className="font-mono text-score">Saved</span> : null}
                  hint="Adds IMDb, Rotten Tomatoes and Metacritic scores on detail pages. Free at omdbapi.com."
                  onSave={async (v) => {
                    apply(await api.putSettings({ omdb_key: v }));
                    toast({ text: "OMDb key saved" });
                  }}
                />
              </>
            }
          />

          <Panel className="flex flex-col gap-4">
            <SectionTitle>Data folder</SectionTitle>
            <p className="m-0 font-mono text-[13px] text-ink-2b break-all">{s.data_dir}</p>
            <form
              className="flex flex-wrap gap-[10px]"
              onSubmit={async (e) => {
                e.preventDefault();
                const next = await api.putSettings({ data_dir: dataDir.trim() });
                apply(next);
                setDataDir("");
                toast({ text: next.restart_required ? "Saved. Restart Reel to use the new folder." : "Unchanged" });
              }}
            >
              <label htmlFor="data-dir" className="absolute w-px h-px overflow-hidden [clip-path:inset(50%)]">New data folder</label>
              <input id="data-dir" placeholder="A new folder path (takes effect after a restart)" value={dataDir} onChange={(e) => setDataDir(e.target.value)} className={input} />
              <Button type="submit" disabled={!dataDir.trim()}>Move here</Button>
            </form>
            <p className="m-0 text-[12px] text-ink-4">Moving doesn't copy anything. Back up first, then restore into the new folder.</p>
          </Panel>

          <Panel className="flex flex-col gap-4">
            <SectionTitle>Backup and restore</SectionTitle>
            <p className="m-0 text-[14px] text-ink-2b">One zip holds everything: the database, cached posters and the trained models.</p>
            <div className="flex flex-wrap gap-[10px]">
              <a href="/api/system/backup" download className="flex items-center gap-2 h-11 px-[18px] rounded-[14px] bg-accent text-on-accent font-semibold text-[14px] no-underline hover:text-on-accent">
                Back up now
              </a>
              <label className={cx("flex items-center gap-2 h-11 px-[18px] rounded-[14px] border border-(--line-5) bg-(--fill-ctl) text-[14px] cursor-pointer hover:bg-white/10", restoring && "opacity-60")}>
                {restoring ? "Restoring…" : "Restore from a backup…"}
                <input
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  disabled={restoring}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f || !window.confirm(`Replace everything in Reel with ${f.name}? This can't be undone.`)) return;
                    setRestoring(true);
                    try {
                      await api.restore(f);
                      qc.invalidateQueries();
                      toast({ text: "Restored" });
                    } catch (x) {
                      toast({ text: x instanceof Error ? x.message : "Restore failed" });
                    } finally {
                      setRestoring(false);
                    }
                  }}
                />
              </label>
              <ButtonLink to="/import">Import history</ButtonLink>
            </div>
          </Panel>

          <Panel className="flex flex-col gap-3">
            <SectionTitle>About</SectionTitle>
            <p className="m-0 text-[14px] text-ink-2b leading-[1.6]">
              Reel is a personal diary for films, shows, books and games that runs entirely on this machine. Film and show data and images come from{" "}
              <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">The Movie Database (TMDB)</a>.
            </p>
            <p className="m-0 text-[13px] text-ink-4">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
          </Panel>
        </>
      )}
    </main>
  );
}
