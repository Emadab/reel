import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { mediaApi, useFollows, useItem, useMediaMut, type Episode, type Goal, type ItemDetail, type Kind, type RunOut, type RunPrecision } from "../../api/media";
import { Dialog } from "../../components/Dialog";
import { mix } from "../../components/Glow";
import { IconCalendar, IconCheck, IconChevronDown, IconChevronLeft, IconMore, IconPlus } from "../../components/Icons";
import { Poster, posterBg } from "../../components/Poster";
import { RatingInput } from "../../components/Rating";
import { useToast } from "../../components/Toasts";
import { Button, ErrorLine, Eyebrow, MonoTag, SectionTitle, Segmented, TagChip, cx } from "../../components/ui";
import { DateOrUnknown, PrecisionPicker, fromUnknown } from "../../components/WhenFields";
import { onColor } from "../../lib/color";
import { formatFullDate, formatWatchDate, iso, rating, relativeTime, today } from "../../lib/format";
import { backTarget } from "../../lib/history";
import { MODES, SHELF_LABEL, START, STATUS_LABEL, USER_SET, statusLabel } from "../../lib/mode";
import { asFilm, fraction, Meter, pagePad, progressText } from "./parts";

const ITEM_STATUS: Record<string, string> = { released: "Released", upcoming: "Upcoming", returning: "Returning series", ended: "Ended", canceled: "Canceled" };
const FINAL = new Set(["completed", "finished", "beaten", "dropped", "abandoned", "did_not_finish", "retired"]);
const GOALS: { id: Goal; label: string }[] = [{ id: "main", label: "Main story" }, { id: "main_extras", label: "Main + extras" }, { id: "completionist", label: "Completionist" }];

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", esc);
    };
  }, [open, close]);
  return ref;
}

const menuItem = "w-full h-11 flex items-center gap-2 px-3 rounded-[10px] bg-transparent hover:bg-(--fill-ctl) border-0 text-[14px] text-left cursor-pointer text-ink no-underline hover:text-ink";
const menuBox = "absolute left-0 top-[calc(100%+8px)] z-30 w-[260px] p-2 rounded-[16px] bg-[rgba(20,22,30,0.92)] border border-(--line-4) backdrop-blur-[24px] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.8)]";

/** The status control: only the transitions the backend allows (shows: only the ones you set yourself), plus shelves. */
function StatusMenu({ item }: { item: ItemDetail }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const toast = useToast();
  const setStatus = useMediaMut((s: string) => mediaApi.setStatus(item.id, s));
  const shelf = useMediaMut((s: string) => mediaApi.patch(item.id, { shelf: s }));
  const userSet = USER_SET[item.kind];
  const next = item.allowed.filter((s) => !userSet || userSet.has(s));
  const shelves = (item.kind === "show" ? ["wishlist", "not_interested"] : ["wishlist", "backlog", "not_interested"]).filter((s) => s !== item.shelf);
  const active = item.runs.length > 0 && item.status && !FINAL.has(item.status) && !(item.shelf && item.status === item.shelf);
  const run = async (fn: () => Promise<unknown>, text: string) => {
    setOpen(false);
    try {
      await fn();
      toast({ text });
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "Couldn't change that" });
    }
  };
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 h-[46px] px-[18px] rounded-[14px] bg-white/8 border border-(--line-5) text-ink text-[14px] cursor-pointer backdrop-blur-[16px] hover:bg-white/10"
      >
        <span className="size-2 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]" />
        {item.in_library ? statusLabel(item.kind, item.status) : "Not in your library"}
        <IconChevronDown size={12} />
      </button>
      {open && (
        <div role="menu" className={menuBox}>
          {next.map((s) => (
            <button key={s} role="menuitem" type="button" className={menuItem} onClick={() => run(() => setStatus.mutateAsync(s), `Marked ${STATUS_LABEL[s].toLowerCase()}`)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
          {!active &&
            shelves.map((s) => (
              <button key={s} role="menuitem" type="button" className={menuItem} onClick={() => run(() => shelf.mutateAsync(s), `Moved to ${statusLabel(item.kind, s).toLowerCase()}`)}>
                {s === "not_interested" ? "Not interested" : `Move to ${SHELF_LABEL[item.kind][s] ?? STATUS_LABEL[s]}`}
              </button>
            ))}
          {item.shelf && !active && (
            <button role="menuitem" type="button" className={menuItem} onClick={() => run(() => shelf.mutateAsync(""), "Removed from the shelf")}>
              Take off {statusLabel(item.kind, item.shelf).toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function providerLinks(item: ItemDetail): [string, string][] {
  const x = item.external_ids;
  const out: [string, string | null][] =
    item.kind === "show"
      ? [["TMDB", x.tmdb_tv && `https://www.themoviedb.org/tv/${x.tmdb_tv}`], ["IMDb", x.imdb && `https://www.imdb.com/title/${x.imdb}/`], ["TVmaze", x.tvmaze && `https://www.tvmaze.com/shows/${x.tvmaze}`]]
      : item.kind === "book"
        ? [["Open Library", x.openlibrary && `https://openlibrary.org/works/${x.openlibrary}`], ["Hardcover", x.hardcover && `https://hardcover.app/books/${x.hardcover}`]]
        : [["RAWG", x.rawg_slug && `https://rawg.io/games/${x.rawg_slug}`], ["Website", item.details.website ?? null]];
  return out.filter(([, v]) => v) as [string, string][];
}

function MoreMenu({ item }: { item: ItemDetail }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const nav = useNavigate();
  const toast = useToast();
  const refresh = useMediaMut(() => mediaApi.refresh(item.id));
  const endless = useMediaMut(() => mediaApi.patch(item.id, { endless: !item.endless }));
  const remove = useMediaMut(() => mediaApi.remove(item.id));
  const follow = useMediaMut((b: { notify?: boolean; priority?: boolean }) => mediaApi.follow(item.id, b));
  const follows = useFollows(!!item.follow && item.kind === "book");
  const followTarget = useMediaMut(async (b: { on: boolean; kind: "author" | "series"; id: string; name: string }): Promise<unknown> => {
    const row = follows.data?.find((f) => f.target_kind === b.kind && f.target_id === b.id);
    return b.on ? mediaApi.addFollow({ target_kind: b.kind, target_id: b.id, name: b.name }) : row ? mediaApi.removeFollow(row.id) : Promise.resolve();
  });
  const authors: [string, string][] = (item.details.author_ids ?? []).map((id: string, i: number) => [id, item.details.authors?.[i] ?? "author"]);
  const series: { id: string; name: string }[] = item.details.series ?? [];
  const isFollowed = (kind: string, id: string) => !!follows.data?.some((f) => f.target_kind === kind && f.target_id === id);
  useEffect(() => setConfirm(false), [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="size-[46px] grid place-items-center rounded-[14px] bg-white/8 border border-(--line-5) text-ink cursor-pointer backdrop-blur-[16px] hover:bg-white/10"
      >
        <IconMore size={18} />
      </button>
      {open && (
        <div role="menu" className={menuBox}>
          <button
            role="menuitem" type="button" className={menuItem} disabled={refresh.isPending}
            onClick={async () => {
              await refresh.mutateAsync(undefined);
              setOpen(false);
              toast({ text: "Data refreshed" });
            }}
          >
            {refresh.isPending ? "Refreshing…" : "Refresh data"}
          </button>
          {item.follow && item.kind === "show" && (
            <button role="menuitemcheckbox" aria-checked={item.follow.priority} type="button" className={menuItem} onClick={() => follow.mutate({ priority: !item.follow!.priority })}>
              {item.follow.priority ? "Stop air-time alerts" : "Alert me at air time"}
            </button>
          )}
          {item.follow && (
            <button role="menuitemcheckbox" aria-checked={!item.follow.notify} type="button" className={menuItem} onClick={() => follow.mutate({ notify: !item.follow!.notify })}>
              {item.follow.notify ? "Mute news about this" : "Unmute news"}
            </button>
          )}
          {item.follow &&
            authors.map(([id, name]) => (
              <button key={id} role="menuitemcheckbox" aria-checked={isFollowed("author", id)} type="button" className={menuItem}
                onClick={() => followTarget.mutate({ on: !isFollowed("author", id), kind: "author", id, name })}>
                {isFollowed("author", id) ? `Unfollow ${name}` : `Follow ${name}`}
              </button>
            ))}
          {item.follow &&
            series.map((x) => (
              <button key={x.id} role="menuitemcheckbox" aria-checked={isFollowed("series", x.id)} type="button" className={menuItem}
                onClick={() => followTarget.mutate({ on: !isFollowed("series", x.id), kind: "series", id: x.id, name: x.name })}>
                {isFollowed("series", x.id) ? `Unfollow ${x.name}` : `Follow the ${x.name} series`}
              </button>
            ))}
          {item.kind === "game" && (
            <button role="menuitem" type="button" className={menuItem} onClick={() => { endless.mutate(undefined); setOpen(false); }}>
              {item.endless ? "Has an ending" : "Endless game (no ending)"}
            </button>
          )}
          {providerLinks(item).map(([label, href]) => (
            <a key={label} role="menuitem" className={menuItem} href={href} target="_blank" rel="noreferrer">Open on {label}</a>
          ))}
          {item.in_library &&
            (confirm ? (
              <div className="flex items-center gap-2 px-3 h-11 text-[13px]">
                Remove it and its history?
                <button
                  type="button" className="ml-auto h-11 px-1 bg-transparent border-0 text-wild font-medium cursor-pointer"
                  onClick={async () => {
                    await remove.mutateAsync(undefined);
                    toast({ text: <>Removed <em>{item.title}</em> from your library</> });
                    nav(MODES[item.kind].base);
                  }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <button role="menuitem" type="button" className={cx(menuItem, "text-wild hover:text-wild")} onClick={() => setConfirm(true)}>
                Remove from library…
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// ---- dates: episodes, runs and history, at any precision (like movie watches) ----

function DateDialog({ label, onClose, onSave, saving, error, extra, children }: {
  label: string; onClose: () => void; onSave: () => void; saving: boolean; error: unknown; extra?: ReactNode; children: ReactNode;
}) {
  return (
    <Dialog open onClose={onClose} label={label} top={96} className="w-[calc(100%-32px)] max-w-[640px] max-[639px]:max-w-none max-[639px]:w-full max-[639px]:h-full max-[639px]:m-0">
      <form
        onSubmit={(e) => { e.preventDefault(); onSave(); }}
        className="flex flex-col rounded-[24px] bg-(--color-bg-dialog) border border-(--line-4) backdrop-blur-[40px] backdrop-saturate-[140%] shadow-[0_60px_120px_-40px_rgba(0,0,0,0.9),0_0_0_1px_rgba(0,0,0,0.4)] overflow-hidden palette-in max-[639px]:rounded-none max-[639px]:min-h-full"
      >
        <div className="m-3 p-5 rounded-[18px] bg-(--fill-glass) border border-(--line-1) flex flex-col gap-[18px]">
          <span className="font-display font-medium text-[16px]">{label}</span>
          {children}
          {error != null && <ErrorLine error={error} />}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 py-[14px] px-[22px] border-t border-(--line-1)">
          <span>{extra}</span>
          <span className="flex gap-[10px]">
            <Button type="button" onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </span>
        </div>
      </form>
    </Dialog>
  );
}

/** One labelled date at the dialog's shared precision. */
function When({ id, label, value, precision, onChange }: { id: string; label: string; value: string; precision: RunPrecision; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[12px] text-ink-3">{label}</label>
      <DateOrUnknown id={id} value={value} precision={precision} onChange={onChange} />
    </div>
  );
}

function Remember({ value, onChange }: { value: RunPrecision; onChange: (p: RunPrecision) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] text-ink-3">I remember the</span>
      <PrecisionPicker value={value} onChange={onChange} />
    </div>
  );
}

const epCode = (e: Episode) => `S${e.season} ${e.special ? "SP" : "E"}${String(e.number).padStart(2, "0")}`;

/** Mark an episode watched on a chosen date, or change or remove the date of one already ticked. */
function EpisodeDateDialog({ item, ep, onClose }: { item: ItemDetail; ep: Episode; onClose: () => void }) {
  const [when, setWhen] = useState(fromUnknown(ep.watched_on ?? iso(today())));
  const [p, setP] = useState<RunPrecision>(ep.watched_precision ?? "day");
  const save = useMediaMut((watched: boolean) => mediaApi.episodes(item.id, { episode_ids: [ep.id], watched, watched_on: watched && p !== "unknown" ? when : undefined, date_precision: p }));
  const toast = useToast();
  const done = async (watched: boolean) => {
    await save.mutateAsync(watched);
    toast({ text: watched ? (ep.watched ? "Date updated" : "Marked watched") : "Unmarked" });
    onClose();
  };
  return (
    <DateDialog
      label={`${epCode(ep)}${ep.title ? ` · ${ep.title}` : ""}`} onClose={onClose} onSave={() => done(true)} saving={save.isPending} error={save.error}
      extra={ep.watched && (
        <button type="button" onClick={() => done(false)} className="h-11 px-0 bg-transparent border-0 text-[14px] text-wild cursor-pointer">Unmark watched</button>
      )}
    >
      <div className="flex flex-wrap gap-[18px] items-end">
        <When id={`ep-${ep.id}-d`} label="Watched on" value={when} precision={p} onChange={setWhen} />
        <Remember value={p} onChange={(v) => { setP(v); setWhen(fromUnknown(when)); }} />
      </div>
    </DateDialog>
  );
}

/** A run's start and finish dates, at one precision. */
function RunDatesDialog({ item, run, onClose }: { item: ItemDetail; run: RunOut; onClose: () => void }) {
  const [start, setStart] = useState(fromUnknown(run.started_on ?? iso(today())));
  const [finish, setFinish] = useState(fromUnknown(run.finished_on ?? iso(today())));
  const [p, setP] = useState<RunPrecision>(run.date_precision);
  const finished = run.finished_on != null || (run.status != null && (FINAL.has(run.status) || run.status === "caught_up"));
  const save = useMediaMut(() => mediaApi.patchRun(run.id, { started_on: start, ...(finished ? { finished_on: finish } : {}), date_precision: p }));
  const toast = useToast();
  const bad = finished && p !== "unknown" && finish < start;
  return (
    <DateDialog
      label={`${item.title} · ${run.run_no > 1 ? `${ordinal(run.run_no)} time` : "dates"}`} onClose={onClose} saving={save.isPending || bad}
      error={bad ? new Error("The finish date is before the start") : save.error}
      onSave={async () => { await save.mutateAsync(undefined); toast({ text: "Dates saved" }); onClose(); }}
    >
      <div className="flex flex-wrap gap-[18px] items-end">
        <When id={`run-${run.id}-s`} label="Started" value={start} precision={p} onChange={setStart} />
        {finished && <When id={`run-${run.id}-f`} label="Finished" value={finish} precision={p} onChange={setFinish} />}
      </div>
      <Remember value={p} onChange={(v) => { setP(v); setStart(fromUnknown(start)); setFinish(fromUnknown(finish)); }} />
    </DateDialog>
  );
}

/** "I watched this a long time ago": the whole show or up to a season, without ticking each episode. */
function HistoryDialog({ item, onClose }: { item: ItemDetail; onClose: () => void }) {
  const seasons = (item.seasons ?? []).filter((s) => s.number > 0 && s.episodes.some((e) => e.aired));
  const [upto, setUpto] = useState<number | null>(null);
  const [start, setStart] = useState(iso(today()));
  const [finish, setFinish] = useState(iso(today()));
  const [p, setP] = useState<RunPrecision>("year");
  const [score, setScore] = useState<number | null>(null);
  const save = useMediaMut(() => mediaApi.history(item.id, {
    upto_season: upto, date_precision: p, rating: score, ...(p === "unknown" ? {} : { started_on: start, finished_on: finish }),
  }));
  const toast = useToast();
  const bad = p !== "unknown" && finish < start;
  return (
    <DateDialog
      label={`Add ${item.title} to your history`} onClose={onClose} saving={save.isPending || bad}
      error={bad ? new Error("The finish date is before the start") : save.error}
      onSave={async () => { await save.mutateAsync(undefined); toast({ text: <>Added <em>{item.title}</em> to your history</> }); onClose(); }}
    >
      <label className="flex flex-col gap-2 text-[12px] text-ink-3">
        What you watched
        <select
          value={upto ?? ""} onChange={(e) => setUpto(e.target.value ? Number(e.target.value) : null)}
          className="h-11 px-3 rounded-[12px] border border-(--line-5) bg-(--fill-input) text-ink-hi text-[14px] [color-scheme:dark] outline-none focus-visible:outline-2 focus-visible:outline-accent"
        >
          <option value="">The whole show (every aired episode)</option>
          {seasons.slice(0, -1).map((s) => <option key={s.number} value={s.number}>{s.number === 1 ? "Season 1" : `Seasons 1–${s.number}`}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap gap-[18px] items-end">
        <When id="hist-s" label="Started" value={start} precision={p} onChange={setStart} />
        <When id="hist-f" label="Finished" value={finish} precision={p} onChange={setFinish} />
      </div>
      <Remember value={p} onChange={setP} />
      <RatingInput value={score} onChange={setScore} />
    </DateDialog>
  );
}

// ---- shows: seasons and the episode grid ----

function airLabel(e: Episode): string {
  if (!e.airstamp) return "TBA";
  const d = e.airstamp.slice(0, 10);
  return e.aired ? formatWatchDate(d, "day") : `Airs ${formatFullDate(d)}`;
}

function Episodes({ item }: { item: ItemDetail }) {
  const seasons = useMemo(() => {
    const s = item.seasons ?? [];
    return [...s.filter((x) => x.number > 0), ...s.filter((x) => x.number === 0)].filter((x) => x.episodes.length);
  }, [item.seasons]);
  const current = item.next_episode?.season ?? seasons.find((s) => s.number > 0)?.number ?? 0;
  const [pick, setPick] = useState<number | null>(null);
  const shown = seasons.find((s) => s.number === (pick ?? current)) ?? seasons[0];
  const tick = useMediaMut((b: { episode_ids?: number[]; season?: number; watched: boolean }) => mediaApi.episodes(item.id, b));
  const [dating, setDating] = useState<Episode | null>(null);
  const [history, setHistory] = useState(false);
  if (!shown) return null;
  const aired = shown.episodes.filter((e) => e.aired);
  const done = aired.filter((e) => e.watched).length;
  const all = aired.length > 0 && done === aired.length;

  const toggle = (e: Episode, ev: MouseEvent) => {
    if (ev.shiftKey && !e.watched) {
      // shift-click: everything aired up to here
      const ids = shown.episodes.filter((x) => x.aired && !x.watched && x.number <= e.number).map((x) => x.id);
      tick.mutate({ episode_ids: ids, watched: true });
    } else tick.mutate({ episode_ids: [e.id], watched: !e.watched });
  };

  return (
    <section className="flex flex-col gap-4" aria-label="Episodes">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <SectionTitle>Episodes</SectionTitle>
        {seasons.length > 1 && (
          <Segmented
            label="Season"
            value={String(shown.number)}
            options={seasons.map((s) => ({ id: String(s.number), label: s.number === 0 ? "Specials" : `S${s.number}` }))}
            onChange={(v) => setPick(Number(v))}
            className="max-w-full overflow-x-auto scroll-quiet"
          />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[12px] text-ink-3">
          {shown.number === 0 ? "Specials don't count toward your progress" : `${shown.name ?? `Season ${shown.number}`} · ${done} of ${aired.length} aired watched`}
          {shown.episodes.length > aired.length && ` · ${shown.episodes.length - aired.length} still to air`}
        </span>
        <span className="flex flex-wrap gap-[10px]">
          <Button onClick={() => setHistory(true)}><IconPlus size={15} /> Add to history</Button>
          {aired.length > 0 && (
            <Button onClick={() => tick.mutate({ season: shown.number, watched: !all })} disabled={tick.isPending}>
              {all ? "Unmark season" : <><IconCheck size={15} /> Mark season watched</>}
            </Button>
          )}
        </span>
      </div>
      {history && <HistoryDialog item={item} onClose={() => setHistory(false)} />}
      {dating && <EpisodeDateDialog item={item} ep={dating} onClose={() => setDating(null)} />}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(220px,100%),1fr))] gap-3">
        {shown.episodes.map((e) => {
          const code = `${e.special ? "SP" : "E"}${String(e.number).padStart(2, "0")}`;
          return (
            <div
              key={e.id}
              className={cx(
                "group min-h-[68px] flex items-center rounded-[14px] border",
                e.watched
                  ? "border-[color-mix(in_oklch,var(--color-accent)_55%,transparent)] bg-[color-mix(in_oklch,var(--color-accent)_8%,transparent)]"
                  : "border-(--line-2) bg-(--fill-card) hover:border-(--line-5)",
                !e.aired && "opacity-45",
              )}
            >
              <button
                type="button"
                aria-pressed={e.watched}
                aria-label={`${e.watched ? "Unmark" : "Mark"} S${e.season} ${code}${e.title ? ` ${e.title}` : ""} watched`}
                disabled={!e.aired && !e.watched}
                title={e.aired && !e.watched ? "Shift-click marks everything up to here" : undefined}
                onClick={(ev) => toggle(e, ev)}
                className="flex-1 min-w-0 self-stretch flex items-center gap-3 pl-[14px] pr-1 py-[10px] bg-transparent border-0 text-left text-inherit cursor-pointer disabled:cursor-default"
              >
                <span className={cx("font-mono text-[13px] tabular-nums shrink-0", e.watched ? "text-accent" : "text-ink-3")}>{code}</span>
                <span className="flex-1 min-w-0 flex flex-col gap-[3px]">
                  <span className="text-[14px] truncate">{e.title ?? "Untitled episode"}</span>
                  <span className="font-mono text-[11px] text-ink-4">
                    {e.watched && e.watched_on ? `Watched ${formatWatchDate(e.watched_on, e.watched_precision ?? "day")}` : airLabel(e)}{e.runtime ? ` · ${e.runtime} min` : ""}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={cx(
                    "size-6 rounded-full grid place-items-center shrink-0 border",
                    e.watched ? "bg-accent border-accent text-on-accent shadow-[0_0_12px_-2px_var(--color-accent)]" : "border-(--line-5) text-transparent group-hover:text-ink-4",
                  )}
                >
                  <IconCheck size={13} />
                </span>
              </button>
              {(e.aired || e.watched) && (
                <button
                  type="button"
                  aria-label={`${e.watched ? "Change the date you watched" : "Mark watched on a date:"} S${e.season} ${code}`}
                  title={e.watched ? "Change the date" : "Watched on another day"}
                  onClick={() => setDating(e)}
                  className="size-11 mr-1 shrink-0 grid place-items-center rounded-[10px] bg-transparent border-0 text-ink-4 hover:text-ink-hi hover:bg-(--fill-ctl) cursor-pointer"
                >
                  <IconCalendar size={15} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---- your run: rating, progress, goal ----

function BookProgress({ item, run }: { item: ItemDetail; run: RunOut }) {
  const p = run.progress;
  const [unit, setUnit] = useState<"page" | "percent" | "minutes">(p.unit ?? "page");
  const [current, setCurrent] = useState(String(p.current ?? ""));
  const [total, setTotal] = useState(String(p.total ?? (unit === "percent" ? 100 : item.details.pages ?? "")));
  const save = useMediaMut(() => mediaApi.progress(run.id, { unit, current: Number(current), ...(total ? { total: Number(total) } : {}) }));
  const toast = useToast();
  const input = "h-11 w-full px-[14px] rounded-[12px] border border-(--line-4) bg-(--fill-input) text-ink-hi text-[14px] tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const d = await save.mutateAsync(undefined);
        toast({ text: d.status === "finished" && run.status !== "finished" ? <>Finished <em>{item.title}</em></> : "Progress saved" });
      }}
    >
      <Segmented
        label="Progress unit" variant="form" value={unit}
        options={[{ id: "page", label: "Pages" }, { id: "percent", label: "Percent" }, { id: "minutes", label: "Audio min" }]}
        onChange={(u) => { setUnit(u); if (u === "percent") setTotal("100"); }}
      />
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <label className="flex flex-col gap-[6px] text-[12px] text-ink-3">
          {unit === "page" ? "Page" : unit === "percent" ? "Percent" : "Minute"}
          <input className={input} inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value.replace(/[^\d.]/g, ""))} />
        </label>
        <label className="flex flex-col gap-[6px] text-[12px] text-ink-3">
          of
          <input className={input} inputMode="decimal" value={total} disabled={unit === "percent"} onChange={(e) => setTotal(e.target.value.replace(/[^\d.]/g, ""))} />
        </label>
        <Button variant="primary" type="submit" disabled={!current || save.isPending}>Save</Button>
      </div>
    </form>
  );
}

function GameProgress({ item, run }: { item: ItemDetail; run: RunOut }) {
  const [hours, setHours] = useState(String(run.progress.hours ?? ""));
  const [percent, setPercent] = useState(String(run.progress.percent ?? ""));
  const save = useMediaMut(() => mediaApi.progress(run.id, { ...(hours ? { hours: Number(hours) } : {}), ...(percent ? { percent: Number(percent) } : {}) }));
  const goal = useMediaMut((g: Goal) => mediaApi.patchRun(run.id, { goal: g }));
  const toast = useToast();
  const input = "h-11 w-full px-[14px] rounded-[12px] border border-(--line-4) bg-(--fill-input) text-ink-hi text-[14px] tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <div className="flex flex-col gap-3">
      {!item.endless && (
        <Segmented label="Goal" variant="form" value={run.goal ?? "main"} options={GOALS} onChange={(g) => goal.mutate(g)} />
      )}
      <form
        className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          await save.mutateAsync(undefined);
          toast({ text: "Session logged" });
        }}
      >
        <label className="flex flex-col gap-[6px] text-[12px] text-ink-3">
          Hours played
          <input className={input} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^\d.]/g, ""))} />
        </label>
        <label className="flex flex-col gap-[6px] text-[12px] text-ink-3">
          Completion %
          <input className={input} inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^\d.]/g, ""))} />
        </label>
        <Button variant="primary" type="submit" disabled={(!hours && !percent) || save.isPending}>Log</Button>
      </form>
      {item.time_left != null && (
        <span className="font-mono text-[12px] text-ink-3">~{item.time_left} h left for {GOALS.find((g) => g.id === (run.goal ?? "main"))!.label.toLowerCase()} (RAWG average)</span>
      )}
    </div>
  );
}

const FORMATS = [{ id: "print", label: "Print" }, { id: "ebook", label: "Ebook" }, { id: "audio", label: "Audiobook" }];

/** Which edition (books) or platform (games) this run is on. */
function Variant({ item, run }: { item: ItemDetail; run: RunOut }) {
  const set = useMediaMut((v: Record<string, string>) => mediaApi.patchRun(run.id, { variant: { ...run.variant, ...v } }));
  if (item.kind === "book")
    return <Segmented label="Format" variant="form" value={run.variant.format ?? "print"} options={FORMATS} onChange={(f) => set.mutate({ format: f })} />;
  const platforms: string[] = item.details.platforms ?? [];
  if (item.kind !== "game" || platforms.length < 2) return null;
  return (
    <label className="flex flex-col gap-[6px] text-[12px] text-ink-3">
      Platform
      <select
        value={run.variant.platform ?? ""}
        onChange={(e) => set.mutate({ platform: e.target.value })}
        className="h-11 px-3 rounded-[12px] border border-(--line-4) bg-(--fill-input) text-ink-hi text-[14px] [color-scheme:dark] outline-none focus-visible:outline-2 focus-visible:outline-accent"
      >
        <option value="">Choose a platform</option>
        {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
    </label>
  );
}

function YourRun({ item, run, glow }: { item: ItemDetail; run: RunOut; glow: string }) {
  const rate = useMediaMut((v: number | null) => mediaApi.patchRun(run.id, v == null ? { clear_rating: true } : { rating: v }));
  const [dating, setDating] = useState(false);
  const f = fraction(item.kind, run.progress);
  const text = progressText(item.kind, run.progress);
  const dates = run.date_precision === "unknown" ? (run.started_on || run.finished_on ? "date unknown" : "")
    : [run.started_on && `started ${formatWatchDate(run.started_on, run.date_precision)}`,
      run.finished_on && `finished ${formatWatchDate(run.finished_on, run.date_precision)}`].filter(Boolean).join(" · ");
  return (
    <section className="p-6 rounded-[22px] bg-(--fill-glass) border border-(--line-2) backdrop-blur-[24px] flex flex-col gap-5" aria-label="Your run">
      <div className="flex justify-between items-baseline gap-3">
        <SectionTitle>{run.run_no > 1 ? `Your ${ordinal(run.run_no)} time` : "Your run"}</SectionTitle>
        <span className="font-mono text-[12px] text-ink-3">{statusLabel(item.kind, run.status)}</span>
      </div>
      {(f != null || text) && (
        <div className="flex flex-col gap-2">
          {f != null && <Meter value={f} />}
          <span className="font-mono text-[12px] text-ink-3">{text}</span>
        </div>
      )}
      {run.status && (
        <div className="flex flex-wrap items-center justify-between gap-3 -my-2">
          <span className="text-[13px] text-ink-3">{dates || "No dates yet"}</span>
          <button type="button" onClick={() => setDating(true)} className="h-11 px-0 bg-transparent border-0 text-[13px] text-ink-3 hover:text-ink-hi underline cursor-pointer">Edit dates</button>
        </div>
      )}
      {dating && <RunDatesDialog item={item} run={run} onClose={() => setDating(false)} />}
      <Variant item={item} run={run} />
      {item.kind === "book" && run.status && !FINAL.has(run.status) && <BookProgress item={item} run={run} />}
      {item.kind === "game" && run.status && !["abandoned", "retired"].includes(run.status) && <GameProgress item={item} run={run} />}
      <div className="flex flex-col gap-2">
        <Eyebrow className="text-[10.5px]" style={{ color: glow }}>Your rating</Eyebrow>
        <RatingInput value={run.rating} onChange={(v) => rate.mutate(v)} hideLabel label={`Rate ${item.title}`} />
      </div>
    </section>
  );
}

const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? "th"}`;

function Runs({ item, glow, glow2 }: { item: ItemDetail; glow: string; glow2: string }) {
  const dots = [glow, glow2, "#8E95A3"];
  const del = useMediaMut((id: number) => mediaApi.deleteRun(id));
  const [confirm, setConfirm] = useState<number | null>(null);
  const [dating, setDating] = useState<RunOut | null>(null);
  if (item.runs.length < 2) return null;
  return (
    <section className="p-6 rounded-[22px] bg-(--fill-glass) border border-(--line-2) backdrop-blur-[24px] flex flex-col gap-[22px]">
      <div className="flex justify-between items-baseline">
        <SectionTitle>Your history</SectionTitle>
        <span className="font-mono text-[12px] text-ink-3">{item.runs.length} runs</span>
      </div>
      <ol className="list-none m-0 p-0 flex flex-col">
        {[...item.runs].reverse().map((r, i) => (
          <li key={r.id} className="flex gap-4">
            <div className="flex flex-col items-center pt-1 self-stretch">
              <span className="size-3 rounded-full shrink-0" style={{ background: dots[i % 3], boxShadow: `0 0 14px ${dots[i % 3]}` }} />
              <span className="flex-1 w-px bg-(--line-4) my-[6px]" />
            </div>
            <div className="flex-1 flex flex-col gap-[6px] pb-[22px] min-w-0">
              <div className="flex justify-between items-baseline gap-[10px]">
                <span className="text-[15px] font-medium">{statusLabel(item.kind, r.status)}</span>
                {r.rating != null && <span className="font-mono text-[14px]" style={{ color: glow }}>★ {rating(r.rating)}</span>}
              </div>
              <div className="flex flex-wrap gap-[6px]">
                <MonoTag>{ordinal(r.run_no)} time</MonoTag>
                {r.finished_on && <MonoTag>{formatWatchDate(r.finished_on, r.date_precision)}</MonoTag>}
                {r.goal && <MonoTag>{GOALS.find((g) => g.id === r.goal)?.label}</MonoTag>}
                {r.variant.format && <MonoTag>{FORMATS.find((f) => f.id === r.variant.format)?.label}</MonoTag>}
                {r.variant.platform && <MonoTag>{r.variant.platform}</MonoTag>}
              </div>
              {confirm === r.id ? (
                <span className="flex items-center gap-3 text-[13px]">
                  Delete this run?
                  <button type="button" className="h-11 px-1 bg-transparent border-0 text-wild font-medium cursor-pointer" onClick={() => del.mutate(r.id)}>Delete</button>
                  <button type="button" className="h-11 px-1 bg-transparent border-0 text-ink-3 cursor-pointer" onClick={() => setConfirm(null)}>Keep it</button>
                </span>
              ) : (
                <span className="flex gap-5">
                  <button type="button" onClick={() => setDating(r)} className="h-11 px-0 bg-transparent border-0 text-[13px] text-ink-4 hover:text-ink-hi cursor-pointer">Edit dates</button>
                  <button type="button" onClick={() => setConfirm(r.id)} className="h-11 px-0 bg-transparent border-0 text-[13px] text-ink-4 hover:text-wild cursor-pointer">Delete run</button>
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
      {dating && <RunDatesDialog item={item} run={dating} onClose={() => setDating(null)} />}
    </section>
  );
}

function Details({ item }: { item: ItemDetail }) {
  const d = item.details;
  const join = (v: unknown) => (Array.isArray(v) ? v.join(", ") : (v as string | null));
  const series = (d.series as { name: string; position: number | null }[] | undefined)?.map((s) => (s.position ? `${s.name} #${s.position}` : s.name)).join(", ");
  const eps = item.seasons?.filter((s) => s.number > 0) ?? [];
  const rows = [
    ["Released", item.release_date ? formatFullDate(item.release_date) : item.year ? String(item.year) : null],
    ["Status", item.item_status !== "released" ? ITEM_STATUS[item.item_status] : null],
    ["Network", item.kind === "show" ? join(d.networks) : null],
    ["Seasons", eps.length ? `${eps.length} · ${eps.reduce((a, s) => a + s.episodes.length, 0)} episodes` : null],
    ["Rated", d.certification ?? d.esrb ?? null],
    ["Authors", item.kind === "book" ? join(d.authors) : null],
    ["Series", series || null],
    ["Pages", d.pages ? String(d.pages) : null],
    ["ISBN", d.isbn13 ?? null],
    ["Platforms", item.kind === "game" ? join(d.platforms) : null],
    ["Developer", item.kind === "game" ? item.people.filter((p) => p.role === "developer").map((p) => p.name).join(", ") || null : null],
    ["Publisher", item.kind === "game" ? item.people.filter((p) => p.role === "publisher").map((p) => p.name).join(", ") || null : null],
    ["Time to beat", item.kind === "game" && d.playtime_hours && !item.endless ? `~${d.playtime_hours} h (average)` : item.endless ? "Endless" : null],
    ["Metacritic", d.metacritic ? String(d.metacritic) : null],
    ["Original title", item.original_title && item.original_title !== item.title ? item.original_title : null],
  ].filter(([, v]) => v) as [string, string][];
  const links = providerLinks(item);
  return (
    <section aria-label="Details" className="rounded-[22px] border border-(--line-2) overflow-hidden">
      <dl className="m-0 px-5 py-1">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[112px_1fr] gap-4 py-[11px] border-b border-(--divider) last:border-0">
            <dt className="text-[13px] text-ink-4">{k}</dt>
            <dd className="m-0 text-[13px] text-ink leading-[1.45]">{v}</dd>
          </div>
        ))}
      </dl>
      {links.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-(--line-2) bg-white/[0.015]">
          {links.map(([label, href]) => (
            <a key={label} href={href} target="_blank" rel="noreferrer" className="press h-8 px-3 grid place-items-center rounded-[9px] border border-(--line-4) text-[12px] text-ink-2 no-underline hover:bg-(--fill-ctl) hover:text-ink-hi">
              {label} ↗
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function People({ item }: { item: ItemDetail }) {
  const cast = item.people.filter((p) => p.role === "cast").slice(0, 12);
  const creators = item.people.filter((p) => p.role === "creator" || p.role === "author");
  if (!cast.length && !creators.length) return null;
  return (
    <section className="flex flex-col gap-4">
      <SectionTitle>{item.kind === "book" ? "Written by" : "People"}</SectionTitle>
      <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(min(190px,100%),1fr))] gap-x-6 gap-y-5">
        {[...creators.map((p) => ({ ...p, character: p.role === "creator" ? "Creator" : "Author" })), ...cast].map((p) => (
          <div key={`${p.name}-${p.character}`} className="flex flex-col gap-[6px] pl-[14px] border-l border-(--line-3)">
            <dt className="text-[14px] leading-[1.45]">{p.name}</dt>
            {p.character && <dd className="m-0"><Eyebrow className="text-[10.5px] text-ink-4 normal-case tracking-normal">{p.character}</Eyebrow></dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function MediaDetail({ kind }: { kind: Kind }) {
  const id = Number(useParams().id);
  const loc = useLocation();
  const nav = useNavigate();
  const toast = useToast();
  const { data: item, isLoading, error } = useItem(id);
  const back = useMemo(() => backTarget(loc.pathname), [loc.pathname]);
  const start = useMediaMut((b: { status: string; again: boolean }) => (b.again ? mediaApi.startRun(id, { status: b.status }) : mediaApi.setStatus(id, b.status)));
  const tickNext = useMediaMut((epId: number) => mediaApi.episodes(id, { episode_ids: [epId], watched: true }));
  const suggest = useMediaMut((s: string) => mediaApi.setStatus(id, s));
  const [dismissed, setDismissed] = useState(false);

  const backPill = (
    <button
      type="button"
      onClick={() => (back.back ? nav(-1) : nav(MODES[kind].base))}
      className="flex items-center gap-2 h-11 box-content pl-3 pr-4 rounded-[12px] bg-[rgba(7,8,12,0.45)] border border-(--line-4) backdrop-blur-[16px] text-[14px] text-ink cursor-pointer"
    >
      <IconChevronLeft size={16} />
      {back.back ? back.label : MODES[kind].label}
    </button>
  );

  if (isLoading || !item || item.kind !== kind)
    return (
      <main className={cx("flex flex-col gap-6 pt-8 pb-[72px]", pagePad)}>
        <div className="flex">{backPill}</div>
        {error ? <ErrorLine error={error} onSettings /> : item ? <ErrorLine error={new Error("Not found")} /> : <div className="skeleton h-[480px] rounded-[22px]" />}
      </main>
    );

  const glow = item.palette[0] ?? posterBg(asFilm(item));
  const glow2 = item.palette[1] ?? glow;
  const style = { "--glow": glow, "--glow2": glow2 } as CSSProperties;
  const run = item.runs.find((r) => r.run_no === item.run_no) ?? null;
  const active = run && run.status && !FINAL.has(run.status);
  const startVerb = item.runs.length && !active ? START[kind].again : START[kind].verb;
  const meta = [
    item.year,
    item.subtitle,
    item.item_status !== "released" ? ITEM_STATUS[item.item_status] : null,
    kind === "book" && item.details.pages ? `${item.details.pages} pages` : null,
    kind === "game" && item.details.playtime_hours && !item.endless ? `~${item.details.playtime_hours} h to beat` : null,
  ].filter(Boolean).join(" · ");
  const next = item.next_episode;

  const primary =
    kind === "show" && active && next ? (
      <button
        type="button" disabled={tickNext.isPending}
        onClick={async () => {
          await tickNext.mutateAsync(next.id);
          toast({ text: <>Watched S{next.season} · E{next.number}</> });
        }}
        className="flex items-center gap-2 h-[46px] px-5 rounded-[14px] font-semibold text-[14px] border-0 cursor-pointer"
        style={{ background: glow, color: onColor(glow), boxShadow: `0 10px 30px -10px ${glow}` }}
      >
        <IconCheck size={16} />
        Watched S{next.season} · E{next.number}
      </button>
    ) : !active || (kind === "show" && !next && run?.status !== "watching") ? (
      kind === "show" && run?.status === "caught_up" ? null : (
        <button
          type="button" disabled={start.isPending}
          onClick={async () => {
            try {
              await start.mutateAsync({ status: START[kind].status, again: item.runs.length > 0 && !active });
            } catch (e) {
              toast({ text: e instanceof Error ? e.message : "Couldn't start it" });
            }
          }}
          className="flex items-center gap-2 h-[46px] px-5 rounded-[14px] font-semibold text-[14px] border-0 cursor-pointer"
          style={{ background: glow, color: onColor(glow), boxShadow: `0 10px 30px -10px ${glow}` }}
        >
          <IconPlus size={16} />
          {startVerb}
        </button>
      )
    ) : null;

  return (
    <main style={style} className="flex flex-col gap-12 pb-[72px] max-[639px]:pb-24 min-w-0">
      <section aria-label={MODES[kind].noun[0]} className={cx("relative min-h-[560px] max-[639px]:min-h-0 -mt-(--tb) pt-[calc(32px+var(--tb))] pb-11 box-border flex flex-col justify-between gap-10", pagePad)}>
        <div aria-hidden className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 bg-bg-hero" />
          {item.backdrop && (
            <>
              <img src={item.backdrop} alt="" className="absolute inset-0 size-full object-cover" />
              <div aria-hidden className="absolute inset-0 bg-[rgba(7,8,12,0.35)]" />
            </>
          )}
          <div aria-hidden className="absolute left-[30%] top-[-18%] w-[900px] h-[700px]" style={{ background: `radial-gradient(closest-side, ${mix(glow, 70)}, transparent)` }} />
          <div aria-hidden className="absolute right-[-10%] top-[10%] w-[700px] h-[600px]" style={{ background: `radial-gradient(closest-side, ${mix(glow2, 45)}, transparent)` }} />
          <div aria-hidden className="absolute left-0 right-0 bottom-0 h-[60%] bg-linear-to-b from-[rgba(7,8,12,0)] to-bg" />
        </div>

        <div className="relative flex justify-between items-center gap-4 flex-wrap">{backPill}</div>

        <div className="relative flex flex-wrap items-end gap-9 max-[639px]:gap-6">
          <Poster film={asFilm(item)} size="detail" eager className="w-[200px] max-[639px]:w-[120px]" shadow={`0 40px 80px -30px ${glow}, 0 0 0 1px rgba(255,255,255,0.08)`} />
          <div className="flex-[1_1_360px] flex flex-col gap-[14px] min-w-0">
            {item.genres.length > 0 && (
              <span className="font-mono text-[12px] tracking-[0.12em] uppercase" style={{ color: glow }}>
                {item.genres.slice(0, 3).join(" · ")}
              </span>
            )}
            <h1 className="m-0 font-display font-semibold text-[56px] max-[639px]:text-[34px] leading-[1.02] tracking-[-0.02em] [text-wrap:balance]">{item.title}</h1>
            {item.tagline && <p className="m-0 -mt-1 max-w-[56ch] text-[17px] italic text-ink-2 [text-wrap:balance]">{item.tagline}</p>}
            <p className="m-0 flex flex-wrap items-center gap-x-[10px] gap-y-1 text-[15px] text-ink-2b">
              {item.details.certification && (
                <span className="font-mono text-[11px] leading-none px-[6px] py-[4px] rounded-[5px] border border-white/30 text-ink-2">{item.details.certification}</span>
              )}
              {meta}
            </p>
            <div className="flex flex-wrap gap-[10px] mt-2">
              {primary}
              <StatusMenu item={item} />
              <MoreMenu item={item} />
            </div>
          </div>
          {item.my_rating != null && (
            <div className="flex flex-col items-end gap-1 max-[639px]:items-start">
              <Eyebrow className="tracking-[0.12em]">YOUR RATING</Eyebrow>
              <span className="font-display font-medium text-[64px] leading-none" style={{ color: glow }}>{rating(item.my_rating)}</span>
              {item.runs.length > 1 && <span className="text-[13px] text-ink-3">across {item.runs.length} runs</span>}
            </div>
          )}
        </div>
      </section>

      {item.suggest && !dismissed && (
        <div role="status" className={cx("flex flex-wrap items-center gap-4 mx-12 max-[1023px]:mx-6 max-[639px]:mx-4 p-5 rounded-[20px] border bg-(--fill-glass) border-[color-mix(in_oklch,var(--color-accent)_40%,transparent)]")}>
          <span className="flex-1 min-w-[240px] text-[14px] text-ink-2">
            No activity for six weeks. Put <em>{item.title}</em> {item.suggest === "on_hold" ? "on hold" : "on the shelf"}? Nothing changes unless you say so.
          </span>
          <Button onClick={() => setDismissed(true)}>Keep {statusLabel(kind, item.status).toLowerCase()}</Button>
          <Button variant="primary" onClick={() => suggest.mutate(item.suggest!)}>{STATUS_LABEL[item.suggest]}</Button>
        </div>
      )}

      <div className={cx("flex flex-wrap gap-10", pagePad)}>
        <div className="flex-[1_1_520px] min-w-0 flex flex-col gap-9">
          <section className="flex flex-col gap-[14px]">
            <SectionTitle>Overview</SectionTitle>
            <p className="m-0 max-w-[64ch] text-[16px] leading-[1.65] text-ink-2 [text-wrap:pretty] whitespace-pre-line">{item.overview || "No overview yet."}</p>
            {item.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {item.tags.slice(0, 8).map((k) => <TagChip key={k}>{k}</TagChip>)}
              </div>
            )}
          </section>
          {kind === "show" && <Episodes item={item} />}
          {kind === "game" && Array.isArray(item.details.screenshots) && item.details.screenshots.length > 0 && (
            <section className="flex flex-col gap-4" aria-label="Screenshots">
              <SectionTitle>Screenshots</SectionTitle>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-3">
                {(item.details.screenshots as string[]).slice(0, 6).map((s) => (
                  <img key={s} src={s} alt="" loading="lazy" className="aspect-video w-full object-cover rounded-[14px] border border-(--line-1)" />
                ))}
              </div>
            </section>
          )}
          <People item={item} />
        </div>
        <aside className="flex-[1_1_340px] min-w-0 flex flex-col gap-5">
          {run && run.status && <YourRun item={item} run={run} glow={glow} />}
          <Runs item={item} glow={glow} glow2={glow2} />
          <Details item={item} />
          <span className="font-mono text-[11px] text-ink-4 px-1">{item.added_at ? `added ${relativeTime(item.added_at)}` : "not in your library yet"}</span>
        </aside>
      </div>
    </main>
  );
}
