import { Command } from "cmdk";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { mediaApi, useMediaMut, useMediaSearch, type Hit, type ItemCard, type Kind } from "../../api/media";
import { IconSearch } from "../../components/Icons";
import { Poster } from "../../components/Poster";
import { useToast } from "../../components/Toasts";
import { Badge, ErrorLine, Kbd, cx } from "../../components/ui";
import { MODES, SHELF_LABEL, SOURCE_NAME, statusLabel } from "../../lib/mode";
import { usePalette } from "./palette";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type Row = { key: string; title: string; year: number | null; subtitle: string | null; thumb: string | null; badge: string | null; item?: ItemCard; hit?: Hit };

function GroupHeading({ left, right }: { left: string; right?: string }) {
  return (
    <div className="flex justify-between px-3 pb-2 font-mono text-[11px] tracking-[0.08em] text-ink-4">
      <span>{left}</span>
      {right && <span className="tracking-normal">{right}</span>}
    </div>
  );
}

function ResultRow({ r, selected }: { r: Row; selected: boolean }) {
  const id = r.item?.id ?? Number(r.hit!.ext_id.replace(/\D/g, "").slice(-8) || 1);
  return (
    <div
      className={cx("w-full flex items-center gap-[14px] py-2 px-3 rounded-[14px] border text-left", !selected && "hover:bg-(--fill-ctl)")}
      style={{
        background: selected ? "color-mix(in srgb, var(--color-accent) 8%, transparent)" : undefined,
        borderColor: selected ? "color-mix(in oklch, var(--color-accent) 55%, transparent)" : "transparent",
      }}
    >
      <Poster film={{ tmdb_id: -id, title: r.title, poster_sm: r.thumb, poster_art: r.item?.poster_art }} size="thumb" className="w-9" layout={false} />
      <span className="flex-1 min-w-0 flex flex-col gap-[3px]">
        <span className="text-[15px] font-medium truncate">
          {r.title} {r.year && <span className="font-mono font-normal text-[13px] text-ink-3">{r.year}</span>}
        </span>
        <span className="text-[13px] text-ink-3 truncate">{r.subtitle ?? " "}</span>
      </span>
      {r.badge && <Badge>{r.badge}</Badge>}
    </div>
  );
}

/** Ctrl K in a media mode: your own items first, then the provider's. ↵ opens or adds, Shift ↵ adds to the wishlist. */
export function MediaPalette({ kind }: { kind: Kind }) {
  const { close } = usePalette();
  const nav = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState("");
  const debounced = useDebounced(q.trim(), 220);
  const search = useMediaSearch(kind, debounced);
  const [selected, setSelected] = useState("");
  const add = useMediaMut((a: { hit: Hit; shelf?: string; status?: string }) => mediaApi.add(kind, { ext_id: a.hit.ext_id, shelf: a.shelf, status: a.status }));
  const wish = SHELF_LABEL[kind].wishlist;
  const noun = MODES[kind].noun[0];

  const groups = useMemo(() => {
    const data = debounced.length >= 2 ? search.data : undefined;
    const local: Row[] = (data?.local ?? []).map((c) => ({
      key: `i${c.id}`, title: c.title, year: c.year, subtitle: c.subtitle, thumb: c.poster_sm, item: c,
      badge: c.in_library ? statusLabel(kind, c.status) : null,
    }));
    const known = new Set(local.map((r) => r.item!.id));
    const remote: Row[] = (data?.results ?? []).filter((h) => !h.item_id || !known.has(h.item_id)).map((h) => ({
      key: `h${h.source}:${h.ext_id}`, title: h.title, year: h.year, subtitle: h.subtitle, thumb: h.cover_url, hit: h,
      badge: h.item_id ? "In your library" : null,
    }));
    return [
      { heading: "IN YOUR LIBRARY", rows: local },
      { heading: `${SOURCE_NAME[kind].toUpperCase()} · ${remote.length} RESULTS`, right: "debounced 220 ms", rows: remote },
    ].filter((g) => g.rows.length);
  }, [debounced, search.data, kind]);
  const rows = groups.flatMap((g) => g.rows);

  useEffect(() => {
    if (rows.length && !rows.some((r) => r.key === selected)) setSelected(rows[0].key);
  }, [rows, selected]);

  const open = async (r: Row, opts: { shelf?: string; status?: string } = {}) => {
    try {
      const id = r.item?.id ?? r.hit?.item_id ?? (await add.mutateAsync({ hit: r.hit!, ...opts })).id;
      if (r.item || r.hit?.item_id) {
        if (opts.shelf) await mediaApi.patch(id, { shelf: opts.shelf });
      }
      close();
      if (opts.shelf) toast({ text: <>Added <em>{r.title}</em> to {wish.toLowerCase()}</> });
      else nav(`${MODES[kind].base}/${id}`);
    } catch (err) {
      toast({ text: err instanceof Error ? err.message : "Couldn't add it" });
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && e.shiftKey) {
      const r = rows.find((x) => x.key === selected);
      if (r) {
        e.preventDefault();
        void open(r, { shelf: "wishlist" });
      }
    }
  };

  return (
    <div className="relative flex flex-col max-h-[calc(100dvh-96px)] max-[639px]:max-h-dvh rounded-[24px] bg-(--color-bg-dialog) border border-(--line-4) backdrop-blur-[40px] backdrop-saturate-[140%] shadow-[0_60px_120px_-40px_rgba(0,0,0,0.9),0_0_0_1px_rgba(0,0,0,0.4)] overflow-hidden max-[639px]:rounded-none max-[639px]:min-h-full palette-in">
      <Command label={`Search ${MODES[kind].noun[1]}`} shouldFilter={false} value={selected} onValueChange={setSelected} loop onKeyDown={onKeyDown} className="flex flex-col min-h-0 shrink">
        <div className="shrink-0 flex items-center gap-[14px] px-[22px] h-[68px] border-b border-(--line-1)">
          <IconSearch size={20} strokeWidth={1.8} className="text-ink-3 shrink-0" />
          <Command.Input
            autoFocus
            value={q}
            onValueChange={setQ}
            placeholder={`Search any ${noun}…`}
            aria-label={`Search ${MODES[kind].noun[1]}`}
            className="flex-1 min-w-0 h-11 border-0 bg-transparent text-ink-hi text-[20px] outline-none placeholder:text-ink-4"
          />
          <Kbd className="text-ink-3 px-[7px] py-[3px]">Esc</Kbd>
        </div>
        <Command.List className="min-h-0 pt-[14px] px-3 pb-[6px] max-h-[min(52vh,420px)] overflow-y-auto scroll-quiet empty:hidden">
          {search.isError && q.length >= 2 && <div className="px-3 pb-2"><ErrorLine error={search.error} onSettings /></div>}
          {!search.isError && debounced.length >= 2 && search.isSuccess && rows.length === 0 && (
            <p className="m-0 px-3 pb-3 font-mono text-[13px] text-ink-4">No matches on {SOURCE_NAME[kind]}</p>
          )}
          {q.length > 0 && q.trim().length < 2 && <p className="m-0 px-3 pb-3 font-mono text-[13px] text-ink-4">Keep typing…</p>}
          {!q && <p className="m-0 px-3 pb-3 font-mono text-[13px] text-ink-4">Type to search {SOURCE_NAME[kind]} for a {noun}.</p>}
          {groups.map((g) => (
            <Command.Group key={g.heading} heading={<GroupHeading left={g.heading} right={g.right} />} className="[&+&]:mt-3">
              <div className="flex flex-col gap-[2px]">
                {g.rows.map((r) => (
                  <Command.Item key={r.key} value={r.key} onSelect={() => open(r)} className="cursor-pointer outline-none">
                    <ResultRow r={r} selected={selected === r.key} />
                  </Command.Item>
                ))}
              </div>
            </Command.Group>
          ))}
        </Command.List>
      </Command>

      <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 py-[14px] px-[22px] border-t border-(--line-1)">
        <div className="flex flex-wrap gap-4 text-[12px] text-ink-3">
          <span className="flex gap-[6px] items-center"><Kbd className="rounded-[5px] px-[6px] py-px">↑↓</Kbd>choose</span>
          <span className="flex gap-[6px] items-center"><Kbd className="rounded-[5px] px-[6px] py-px">Shift ↵</Kbd>add to {wish.toLowerCase()}</span>
        </div>
        <button
          type="button"
          disabled={add.isPending || !rows.length}
          onClick={() => {
            const r = rows.find((x) => x.key === selected);
            if (r) void open(r);
          }}
          className="flex items-center gap-[10px] h-11 px-[18px] rounded-[14px] bg-accent text-on-accent font-semibold text-[14px] border-0 cursor-pointer disabled:opacity-60"
        >
          {add.isPending ? "Adding…" : `Open ${noun}`}
          <kbd className="font-mono text-[11px] border border-[rgba(7,8,12,0.35)] rounded-[5px] px-[6px] py-px">↵</kbd>
        </button>
      </div>
    </div>
  );
}
