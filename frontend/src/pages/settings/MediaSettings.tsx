import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { request } from "../../api/client";
import type { Flag, SettingsOut } from "../../api/types";
import { useToast } from "../../components/Toasts";
import { Button, Panel, SectionTitle, cx } from "../../components/ui";
import { MODE_ORDER, MODES } from "../../lib/mode";

type MediaSettingsOut = SettingsOut & {
  rawg_configured: boolean; google_books_configured: boolean; hardcover_configured: boolean; contact_email: string;
  notify_desktop: boolean; ntfy_topic: string; quiet_hours: string;
};
const input = "h-11 px-[14px] rounded-[12px] border border-(--line-4) bg-(--fill-input) text-ink-hi text-[14px] min-w-0 flex-1 placeholder:text-ink-4";
const ACCENT_NAMES: Record<string, string> = { "#7FDBFF": "Ice", "#C6F36B": "Lime", "#FFB86B": "Amber", "#C9A7FF": "Violet" };

const FLAGS: { flag: Flag; label: string; hint: string }[] = [
  { flag: "media.shows", label: "TV series", hint: "Episodes, up next, seasons. Data from TMDB and TVmaze." },
  { flag: "media.books", label: "Books", hint: "Reading progress, shelves, rereads. Data from Open Library." },
  { flag: "media.games", label: "Games", hint: "Playthroughs, hours, backlog planner. Data from RAWG (needs a key)." },
  { flag: "announcements", label: "Announcements", hint: "New episodes, seasons and releases: a bell, a calendar, desktop and phone alerts." },
];

/** A switch: a real button with aria-pressed, 44 px tall like every control. */
function Toggle({ on, label, hint, onChange }: { on: boolean; label: string; hint: ReactNode; onChange: (on: boolean) => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)} className="w-full flex items-center gap-4 min-h-11 py-2 bg-transparent border-0 text-left">
      <span className="flex-1 flex flex-col gap-[3px]">
        <span className="text-[14px] font-medium">{label}</span>
        <span className="text-[12px] text-ink-4">{hint}</span>
      </span>
      <span className={cx("relative w-[42px] h-6 rounded-full shrink-0 transition-colors", on ? "bg-accent shadow-[0_0_14px_-2px_var(--color-accent)]" : "bg-white/12")}>
        <span className={cx("absolute top-[3px] size-[18px] rounded-full bg-ink-hi transition-[left] duration-200", on ? "left-[21px]" : "left-[3px]")} />
      </span>
    </button>
  );
}

function TextSetting({ label, hint, value, secret, configured, onSave }: {
  label: string; hint: ReactNode; value?: string; secret?: boolean; configured?: boolean; onSave: (v: string) => Promise<void>;
}) {
  const [v, setV] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const id = `ms-${label.replace(/\W+/g, "-").toLowerCase()}`;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await onSave(v.trim());
      if (secret) setV("");
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
        <input
          id={id} type={secret ? "password" : "text"} autoComplete="off" spellCheck={false} value={v} onChange={(e) => setV(e.target.value)} className={input}
          placeholder={secret ? (configured ? "Saved. Paste a new one to replace it" : "Paste it here") : "Not set"}
        />
        <Button type="submit" disabled={busy || (secret && !v.trim())}>{busy ? "Saving…" : "Save"}</Button>
      </div>
      <div className="flex flex-wrap gap-3 items-baseline text-[12px] text-ink-4">
        {secret && (configured ? <span className="font-mono text-score">Saved</span> : <span className="font-mono">Not set</span>)}
        <span>{hint}</span>
      </div>
      {err && <p className="m-0 font-mono text-[12px] text-wild">{err}</p>}
    </form>
  );
}

/** Settings for every mode alike: which media are on, their keys, accents and notifications (design extension).
 * `movieKeys` are the TMDB and OMDb forms, which live in Settings.tsx. */
export function MediaSettings({ s, movieKeys }: { s: SettingsOut; movieKeys: ReactNode }) {
  const m = s as MediaSettingsOut;
  const qc = useQueryClient();
  const toast = useToast();
  const put = async (body: Record<string, unknown>) => {
    const next = await request<SettingsOut>("PUT", "/settings", { body });
    qc.setQueryData(["settings"], next);
    void qc.invalidateQueries({ queryKey: ["media"] });
    return next;
  };
  const modes = MODE_ORDER.filter((k) => !MODES[k].flag || s.flags[MODES[k].flag!]);
  return (
    <>
      <Panel className="flex flex-col gap-3">
        <SectionTitle>Modes</SectionTitle>
        <p className="m-0 text-[13px] text-ink-4">Each medium gets its own mode in the sidebar (Ctrl 1–4).</p>
        <div className="flex flex-col divide-y divide-(--divider)">
          {FLAGS.map((f) => (
            <Toggle key={f.flag} on={!!s.flags[f.flag]} label={f.label} hint={f.hint} onChange={(on) => put({ flags: { [f.flag]: on } })} />
          ))}
        </div>
      </Panel>

      <Panel className="flex flex-col gap-6">
        <SectionTitle>Keys</SectionTitle>
        {movieKeys}
        {s.flags["media.games"] && (
          <TextSetting label="RAWG key" secret configured={m.rawg_configured} hint="Games search and details. Free at rawg.io/apidocs."
            onSave={async (v) => { await put({ rawg_key: v }); toast({ text: "RAWG key saved" }); }} />
        )}
        {s.flags["media.books"] && (
          <>
            <TextSetting label="Hardcover token (optional)" secret configured={m.hardcover_configured} hint="Series, release dates and any book details other sources miss. hardcover.app → Settings → API."
              onSave={async (v) => { await put({ hardcover_token: v }); toast({ text: "Hardcover token saved" }); }} />
            <TextSetting label="Google Books key (optional)" secret configured={m.google_books_configured} hint="Fills in missing descriptions and page counts."
              onSave={async (v) => { await put({ google_books_key: v }); toast({ text: "Google Books key saved" }); }} />
          </>
        )}
        {(s.flags["media.shows"] || s.flags["media.books"]) && (
          <TextSetting label="Contact email (optional)" value={m.contact_email} hint="Sent only to Open Library and TVmaze, who ask apps to identify themselves. It raises Open Library's rate limit."
            onSave={async (v) => { await put({ contact_email: v }); toast({ text: "Saved" }); }} />
        )}
        <p className="m-0 text-[12px] text-ink-4">Keys are stored in backend/.env and never sent back to this page.</p>
      </Panel>

      <Panel className="flex flex-col gap-5">
        <SectionTitle>Mode accents</SectionTitle>
        {modes.map((k) => {
          const current = (k === "movie" ? s.accent : s.mode_accents?.[k] ?? MODES[k].accent!).toUpperCase();
          return (
            <div key={k} className="flex flex-wrap items-center gap-4">
              <span className="w-[72px] text-[14px]">{MODES[k].label}</span>
              <div role="radiogroup" aria-label={`${MODES[k].label} accent`} className="flex gap-3">
                {s.accents.map((c) => (
                  <button
                    key={c} type="button" role="radio" aria-checked={c.toUpperCase() === current} aria-label={ACCENT_NAMES[c] ?? c}
                    onClick={() => put(k === "movie" ? { accent: c } : { mode_accents: { [k]: c } })}
                    className={cx("size-11 rounded-full border-0 cursor-pointer", c.toUpperCase() === current && "outline-2 outline-white outline-offset-[3px]")}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </Panel>

      {s.flags.announcements && (
        <Panel className="flex flex-col gap-5">
          <SectionTitle>Notifications</SectionTitle>
          <Toggle on={m.notify_desktop} label="Desktop notifications" hint="Windows notifications for releases and for shows you mark 'Alert me at air time'." onChange={(on) => put({ notify_desktop: on })} />
          <TextSetting label="Phone alerts via ntfy (optional)" value={m.ntfy_topic} hint={<>Install the ntfy app, subscribe to a topic name only you know, and enter it here.</>}
            onSave={async (v) => { await put({ ntfy_topic: v }); toast({ text: v ? "Phone alerts on" : "Phone alerts off" }); }} />
          <TextSetting label="Quiet hours (optional)" value={m.quiet_hours} hint="Like 23:00-08:00. Alerts wait, then arrive as one summary."
            onSave={async (v) => { await put({ quiet_hours: v }); toast({ text: "Saved" }); }} />
        </Panel>
      )}

      <Panel className="flex flex-col gap-3">
        <SectionTitle>Data sources</SectionTitle>
        <ul className="m-0 pl-5 flex flex-col gap-2 text-[14px] text-ink-2b leading-[1.55]">
          <li>Film data and images from <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">TMDB</a>; IMDb, Rotten Tomatoes and Metacritic scores from <a href="https://www.omdbapi.com" target="_blank" rel="noreferrer">OMDb</a> when a key is set.</li>
          {s.flags["media.shows"] && <li>Show data from <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">TMDB</a>; air times from <a href="https://www.tvmaze.com" target="_blank" rel="noreferrer">TVmaze</a>, licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA</a>.</li>}
          {s.flags["media.books"] && <li>Book data and covers from <a href="https://openlibrary.org" target="_blank" rel="noreferrer">Open Library</a>, with <a href="https://hardcover.app" target="_blank" rel="noreferrer">Hardcover</a> and Google Books when keys are set.</li>}
          {s.flags["media.games"] && <li>Game data from <a href="https://rawg.io" target="_blank" rel="noreferrer">RAWG</a>.</li>}
          {s.flags.announcements && <li>Phone alerts through <a href="https://ntfy.sh" target="_blank" rel="noreferrer">ntfy.sh</a>.</li>}
        </ul>
      </Panel>
    </>
  );
}
