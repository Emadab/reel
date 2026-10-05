import { useQueryClient } from "@tanstack/react-query";
import { Command } from "cmdk";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { api } from "../../api/client";
import { useDeleteWatch, useEditWatch, useLogWatch, useRecent, useSearch, useWatchlist } from "../../api/hooks";
import type { FilmCard, SearchResult } from "../../api/types";
import { Dialog } from "../../components/Dialog";
import { IconSearch } from "../../components/Icons";
import { Poster } from "../../components/Poster";
import { useToast } from "../../components/Toasts";
import { Badge, ErrorLine, Kbd, cx } from "../../components/ui";
import { emptyValues, LogWatchForm, type LogValues } from "./LogWatchForm";
import { usePalette, type PaletteFilm } from "./palette";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type Row = SearchResult;
const toRow = (c: FilmCard): Row => ({
  tmdb_id: c.tmdb_id, title: c.title, year: c.year, director: c.director, poster_sm: c.poster_sm, poster_art: c.poster_art,
  watch_count: c.watch_count, on_watchlist: c.on_watchlist,
});

const COMMANDS: { label: string; to?: string; action?: "backup" }[] = [
  { label: "Go to Library", to: "/" },
  { label: "Go to Timeline", to: "/timeline" },
  { label: "Go to Stats", to: "/stats" },
  { label: "Go to For you", to: "/for-you" },
  { label: "Go to Taste map", to: "/map" },
  { label: "Go to Settings", to: "/settings" },
  { label: "Import history", to: "/import" },
  { label: "Backup now", action: "backup" },
];

function ResultRow({ r, selected }: { r: Row; selected: boolean }) {
  const badge = r.watch_count > 0 ? `Seen ${r.watch_count}×` : r.on_watchlist ? "On watchlist" : null;
  return (
    <div
      className={cx("w-full flex items-center gap-[14px] py-2 px-3 rounded-[14px] border text-left", !selected && "hover:bg-(--fill-ctl)")}
      style={{
        background: selected ? "color-mix(in srgb, var(--color-accent) 8%, transparent)" : undefined,
        borderColor: selected ? "color-mix(in oklch, var(--color-accent) 55%, transparent)" : "transparent",
      }}
    >
      <Poster film={{ ...r, poster: null }} size="thumb" className="w-9" layout={false} />
      <span className="flex-1 min-w-0 flex flex-col gap-[3px]">
        <span className="text-[15px] font-medium truncate">
          {r.title} {r.year && <span className="font-mono font-normal text-[13px] text-ink-3">{r.year}</span>}
        </span>
        <span className="text-[13px] text-ink-3 truncate">{r.director ?? " "}</span>
      </span>
      {badge && <Badge>{badge}</Badge>}
    </div>
  );
}

function GroupHeading({ left, right }: { left: string; right?: string }) {
  return (
    <div className="flex justify-between px-3 pb-2 font-mono text-[11px] tracking-[0.08em] text-ink-4">
      <span>{left}</span>
      {right && <span className="tracking-normal">{right}</span>}
    </div>
  );
}

export function CommandPalette() {
  const { state, close } = usePalette();
  const open = state.kind === "palette";
  return (
    <Dialog open={open} onClose={close} label="Search films" className="w-[calc(100%-32px)] max-w-[762px] max-[639px]:max-w-none max-[639px]:w-full max-[639px]:h-full max-[639px]:m-0 palette-dialog">
      {open && <PaletteBody initialFor={state.logFor} initialQuery={state.query} />}
    </Dialog>
  );
}

function PaletteBody({ initialFor, initialQuery }: { initialFor?: PaletteFilm; initialQuery?: string }) {
  const { close } = usePalette();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState(initialQuery ?? "");
  const debounced = useDebounced(q.trim(), 180);
  const isCommand = q.startsWith(">");
  const search = useSearch(isCommand ? "" : debounced);
  const recent = useRecent(!q);
  const watchlist = useWatchlist(!q);
  const [selected, setSelected] = useState("");
  const [formFor, setFormFor] = useState<Row | null>(initialFor ? { director: null, poster_art: { bg: "#222" }, watch_count: 0, on_watchlist: false, ...initialFor } : null);
  const log = useLogWatch();
  const del = useDeleteWatch();
  const formRef = useRef<HTMLDivElement>(null);

  const results: Row[] = useMemo(() => (debounced.length >= 2 && !isCommand ? search.data?.results ?? [] : []), [debounced, isCommand, search.data]);
  const groups: { heading: string; right?: string; rows: Row[] }[] = useMemo(() => {
    if (isCommand) return [];
    if (!q) {
      return [
        { heading: "RECENT", rows: (recent.data ?? []).map(toRow) },
        { heading: "WATCHLIST", rows: (watchlist.data ?? []).slice(0, 5).map(toRow) },
      ].filter((g) => g.rows.length);
    }
    return [{ heading: `TMDB · ${results.length} RESULTS`, right: "debounced 180 ms", rows: results }];
  }, [isCommand, q, recent.data, watchlist.data, results]);
  const allRows = groups.flatMap((g) => g.rows);
  const commands = COMMANDS.filter((c) => c.label.toLowerCase().includes(q.slice(1).trim().toLowerCase()));

  // keep a valid selection as results change
  useEffect(() => {
    const keys = isCommand ? commands.map((c) => c.label) : allRows.map((r) => String(r.tmdb_id));
    if (keys.length && !keys.includes(selected)) setSelected(keys[0]);
  }, [allRows, commands, isCommand, selected]);

  const openForm = (r: Row) => {
    setFormFor(r);
    // focus the form itself: 0–9 rate and Enter saves straight away
    setTimeout(() => formRef.current?.querySelector<HTMLFormElement>("form")?.focus(), 0);
  };

  const addToWatchlist = async (r: Row) => {
    await api.addToWatchlist(r.tmdb_id);
    qc.invalidateQueries();
    toast({ text: <>Added <em>{r.title}</em> to your watchlist</> });
  };

  const runCommand = async (c: (typeof COMMANDS)[number]) => {
    close();
    if (c.to) nav(c.to);
    if (c.action === "backup") window.location.href = "/api/system/backup";
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && e.shiftKey && !isCommand) {
      const r = allRows.find((x) => String(x.tmdb_id) === selected);
      if (r) {
        e.preventDefault();
        void addToWatchlist(r);
      }
    }
  };

  const save = async (v: LogValues) => {
    if (!formFor) return;
    try {
      const w = await log.mutateAsync({ ...v, tmdb_id: formFor.tmdb_id });
      close();
      toast({
        text: <>Logged <em>{formFor.title}</em></>,
        undo: () => del.mutate(w.id),
      });
      nav(`/film/${formFor.tmdb_id}`);
    } catch (err) {
      toast({ text: err instanceof Error ? err.message : "Couldn't save" });
    }
  };

  return (
    <div className="relative flex flex-col max-h-[calc(100dvh-96px)] max-[639px]:max-h-dvh rounded-[24px] bg-(--color-bg-dialog) border border-(--line-4) backdrop-blur-[40px] backdrop-saturate-[140%] shadow-[0_60px_120px_-40px_rgba(0,0,0,0.9),0_0_0_1px_rgba(0,0,0,0.4)] overflow-hidden max-[639px]:rounded-none max-[639px]:min-h-full palette-in">
      <Command label="Search films" shouldFilter={false} value={selected} onValueChange={setSelected} loop onKeyDown={onKeyDown} className={cx("flex flex-col min-h-0", formFor && !isCommand ? "shrink-[3] min-h-[188px]" : "shrink")}>
        <div className="shrink-0 flex items-center gap-[14px] px-[22px] h-[68px] border-b border-(--line-1)">
          <IconSearch size={20} strokeWidth={1.8} className="text-ink-3 shrink-0" />
          <Command.Input
            autoFocus
            value={q}
            onValueChange={setQ}
            placeholder="Search any film…"
            aria-label="Search films"
            className="flex-1 min-w-0 h-11 border-0 bg-transparent text-ink-hi text-[20px] outline-none placeholder:text-ink-4"
          />
          <Kbd className="text-ink-3 px-[7px] py-[3px]">Esc</Kbd>
        </div>
        <Command.List className="min-h-0 pt-[14px] px-3 pb-[6px] max-h-[min(52vh,420px)] overflow-y-auto scroll-quiet empty:hidden">
          {isCommand ? (
            <>
              <GroupHeading left="COMMANDS" />
              {commands.map((c) => (
                <Command.Item key={c.label} value={c.label} onSelect={() => runCommand(c)} className="rounded-[14px] cursor-pointer">
                  <div className={cx("px-3 py-3 rounded-[14px] border text-[15px]", selected === c.label ? "border-[color-mix(in_oklch,var(--color-accent)_55%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]" : "border-transparent")}>
                    {c.label}
                  </div>
                </Command.Item>
              ))}
            </>
          ) : (
            <>
              {search.isError && q.length >= 2 && <div className="px-3 pb-2"><ErrorLine error={search.error} onSettings /></div>}
              {!search.isError && debounced.length >= 2 && search.isSuccess && results.length === 0 && (
                <p className="m-0 px-3 pb-3 font-mono text-[13px] text-ink-4">No matches on TMDB</p>
              )}
              {q.length > 0 && q.trim().length < 2 && <p className="m-0 px-3 pb-3 font-mono text-[13px] text-ink-4">Keep typing…</p>}
              {groups.map((g) => (
                <Command.Group key={g.heading} heading={<GroupHeading left={g.heading} right={g.right} />} className="[&+&]:mt-3">
                  <div className="flex flex-col gap-[2px]">
                    {g.rows.map((r) => (
                      <Command.Item key={`${g.heading}-${r.tmdb_id}`} value={String(r.tmdb_id)} onSelect={() => openForm(r)} className="cursor-pointer outline-none">
                        <ResultRow r={r} selected={selected === String(r.tmdb_id)} />
                      </Command.Item>
                    ))}
                  </div>
                </Command.Group>
              ))}
            </>
          )}
        </Command.List>
      </Command>

      {formFor && !isCommand && (
        <div ref={formRef} className="shrink min-h-0 overflow-y-auto scroll-quiet">
          <LogWatchForm
            key={formFor.tmdb_id}
            id="log-form"
            heading={`Log ${formFor.title}${formFor.year ? ` (${formFor.year})` : ""}`}
            initial={emptyValues(formFor.watch_count > 0)}
            onSubmit={save}
            className="mt-[6px] mx-3 mb-3"
          />
        </div>
      )}

      <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 py-[14px] px-[22px] border-t border-(--line-1)">
        <div className="flex flex-wrap gap-4 text-[12px] text-ink-3">
          <span className="flex gap-[6px] items-center"><Kbd className="rounded-[5px] px-[6px] py-px">↑↓</Kbd>choose</span>
          <span className="flex gap-[6px] items-center"><Kbd className="rounded-[5px] px-[6px] py-px">Tab</Kbd>next field</span>
          <span className="flex gap-[6px] items-center"><Kbd className="rounded-[5px] px-[6px] py-px">Shift ↵</Kbd>add to watchlist</span>
        </div>
        <button
          type={formFor ? "submit" : "button"}
          form={formFor ? "log-form" : undefined}
          disabled={log.isPending}
          onClick={() => {
            if (formFor) return;
            const r = allRows.find((x) => String(x.tmdb_id) === selected);
            if (r) openForm(r);
          }}
          className="flex items-center gap-[10px] h-11 px-[18px] rounded-[14px] bg-accent text-on-accent font-semibold text-[14px] border-0 cursor-pointer disabled:opacity-60"
        >
          {log.isPending ? "Saving…" : "Log watch"}
          <kbd className="font-mono text-[11px] border border-[rgba(7,8,12,0.35)] rounded-[5px] px-[6px] py-px">↵</kbd>
        </button>
      </div>
    </div>
  );
}

/** Editing an existing watch: the same form in a centred dialog, plus a confirmed delete. */
export function EditWatchDialog() {
  const { state, close } = usePalette();
  const edit = useEditWatch();
  const del = useDeleteWatch();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const open = state.kind === "edit";
  useEffect(() => setConfirm(false), [open]);
  if (state.kind !== "edit") return <Dialog open={false} onClose={close} label="Edit watch">{null}</Dialog>;
  const { watch, film } = state;
  const { id: _id, tmdb_id: _t, ...initial } = watch;
  return (
    <Dialog open onClose={close} label="Edit watch" top={96} className="w-[calc(100%-32px)] max-w-[760px] max-[639px]:max-w-none max-[639px]:w-full max-[639px]:h-full max-[639px]:m-0">
      <div className="flex flex-col max-h-[calc(100dvh-120px)] max-[639px]:max-h-dvh rounded-[24px] bg-(--color-bg-dialog) border border-(--line-4) backdrop-blur-[40px] backdrop-saturate-[140%] shadow-[0_60px_120px_-40px_rgba(0,0,0,0.9),0_0_0_1px_rgba(0,0,0,0.4)] overflow-hidden palette-in max-[639px]:rounded-none max-[639px]:min-h-full">
        <div className="min-h-0 overflow-y-auto scroll-quiet">
          <LogWatchForm
            id="edit-form"
            heading={`Edit ${film.title}${film.year ? ` (${film.year})` : ""}`}
            hint={null}
            initial={initial}
            onSubmit={async (v) => {
              await edit.mutateAsync({ id: watch.id, patch: v });
              close();
              toast({ text: "Watch updated" });
            }}
            className="m-3"
          />
        </div>
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 py-[14px] px-[22px] border-t border-(--line-1)">
          {confirm ? (
            <span className="flex items-center gap-3 text-[14px]">
              Delete this watch?
              <button
                type="button"
                className="h-11 px-2 bg-transparent border-0 text-wild font-medium cursor-pointer"
                onClick={async () => {
                  await del.mutateAsync(watch.id);
                  close();
                  toast({ text: "Watch deleted" });
                }}
              >
                Delete
              </button>
              <button type="button" className="h-11 px-2 bg-transparent border-0 text-ink-3 cursor-pointer" onClick={() => setConfirm(false)}>
                Keep it
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirm(true)} className="h-11 px-1 bg-transparent border-0 text-wild text-[14px] cursor-pointer">
              Delete watch
            </button>
          )}
          <button type="submit" form="edit-form" disabled={edit.isPending} className="flex items-center gap-[10px] h-11 px-[18px] rounded-[14px] bg-accent text-on-accent font-semibold text-[14px] border-0 cursor-pointer">
            Save changes
            <kbd className="font-mono text-[11px] border border-[rgba(7,8,12,0.35)] rounded-[5px] px-[6px] py-px">↵</kbd>
          </button>
        </div>
      </div>
    </Dialog>
  );
}
