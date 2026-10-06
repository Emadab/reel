// Shared pieces for the show, book and game pages, built from Reel's existing components and tokens.
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { mediaApi, useMediaMut, type ItemCard, type Kind, type Progress } from "../../api/media";
import { ContextMenu, useContextMenu, type MenuAt, type MenuEntry } from "../../components/ContextMenu";
import type { PosterFilm } from "../../components/Poster";
import { Poster } from "../../components/Poster";
import { useToast } from "../../components/Toasts";
import { cx } from "../../components/ui";
import { rating } from "../../lib/format";
import { MODES, SHELF_LABEL, STATUS_LABEL, USER_SET, statusLabel } from "../../lib/mode";

/** Items reuse the movie Poster; negative ids keep their shared-layout ids apart from films. */
export const asFilm = (c: Pick<ItemCard, "id" | "title" | "year" | "poster" | "poster_sm" | "poster_art" | "palette">): PosterFilm => ({
  tmdb_id: -c.id, title: c.title, year: c.year, poster: c.poster, poster_sm: c.poster_sm, poster_art: c.poster_art, palette: c.palette,
});

export const itemPath = (c: { kind: Kind; id: number }) => `${MODES[c.kind].base}/${c.id}`;

/** 0–1 through the current run, or null when there's nothing to measure. */
export function fraction(kind: Kind, p: Progress): number | null {
  if (kind === "show") return p.aired ? (p.watched ?? 0) / p.aired : null;
  if (kind === "book") return p.total && p.current != null ? Math.min(p.current / p.total, 1) : null;
  return p.percent != null ? p.percent / 100 : null;
}

export function progressText(kind: Kind, p: Progress): string | null {
  if (kind === "show") return p.aired ? `${p.watched ?? 0} of ${p.aired} episodes` : null;
  if (kind === "book") {
    if (p.current == null) return null;
    if (p.unit === "percent") return `${Math.round(p.current)}%`;
    if (p.unit === "minutes") return `${Math.round(p.current)} of ${p.total ?? "?"} min`;
    return `p. ${Math.round(p.current)}${p.total ? ` of ${p.total}` : ""}`;
  }
  const h = p.hours != null ? `${+p.hours.toFixed(1)} h` : null;
  return [h, p.percent != null && `${Math.round(p.percent)}%`].filter(Boolean).join(" · ") || null;
}

/** A thin meter in the Scores style: 3 px, accent fill with a soft glow. */
export function Meter({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cx("block h-[3px] rounded-full bg-white/[0.07] overflow-hidden", className)} role="presentation">
      <span className="block h-full rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)] transition-[width] duration-700 ease-out" style={{ width: `${Math.round(value * 100)}%` }} />
    </span>
  );
}

export const FINAL = new Set(["completed", "finished", "beaten", "dropped", "abandoned", "did_not_finish", "retired"]);

export type StatusChoice = { label: string; done: string; status?: string; shelf?: string };

/** What the status control offers: the transitions the backend allows (shows: only the ones you set yourself), plus shelves. */
export function statusChoices(item: ItemCard): StatusChoice[] {
  const userSet = USER_SET[item.kind];
  const out: StatusChoice[] = item.allowed
    .filter((s) => !userSet || userSet.has(s))
    .map((s) => ({ label: STATUS_LABEL[s], done: `Marked ${STATUS_LABEL[s].toLowerCase()}`, status: s }));
  const active = item.run_no > 0 && item.status && !FINAL.has(item.status) && !(item.shelf && item.status === item.shelf);
  if (active) return out;
  const shelves = (item.kind === "show" ? ["wishlist", "not_interested"] : ["wishlist", "backlog", "not_interested"]).filter((s) => s !== item.shelf);
  for (const s of shelves)
    out.push({ label: s === "not_interested" ? "Not interested" : `Move to ${SHELF_LABEL[item.kind][s] ?? STATUS_LABEL[s]}`, done: `Moved to ${statusLabel(item.kind, s).toLowerCase()}`, shelf: s });
  if (item.shelf) out.push({ label: `Take off ${statusLabel(item.kind, item.shelf).toLowerCase()}`, done: "Removed from the shelf", shelf: "" });
  return out;
}

export const applyChoice = (id: number, c: StatusChoice) => (c.status ? mediaApi.setStatus(id, c.status) : mediaApi.patch(id, { shelf: c.shelf! }));

/** Right-click on a show, book or game card: change its status without opening it. `extra` goes right under Open. */
export function MediaCardMenu({ item, at, onClose, extra = [] }: { item: ItemCard; at: MenuAt; onClose: () => void; extra?: MenuEntry[] }) {
  const nav = useNavigate();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const choose = useMediaMut((c: StatusChoice) => applyChoice(item.id, c));
  const remove = useMediaMut(() => mediaApi.remove(item.id));
  const run = async (fn: () => Promise<unknown>, text: ReactNode) => {
    try {
      await fn();
      toast({ text });
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "Couldn't change that" });
    }
  };
  const choices = statusChoices(item);
  const items: MenuEntry[] = [
    { label: "Open", onSelect: () => nav(itemPath(item)) },
    ...extra,
    ...(choices.length ? ["sep" as const] : []),
    ...choices.map((c) => ({ label: c.label, onSelect: () => void run(() => choose.mutateAsync(c), <><em>{item.title}</em>: {c.done.toLowerCase()}</>) })),
    "sep",
    { label: "Copy title", onSelect: () => void navigator.clipboard?.writeText(item.title) },
  ];
  if (item.in_library)
    items.push({
      label: confirm ? "Remove it and its history?" : "Remove from library…",
      danger: true,
      keepOpen: !confirm,
      onSelect: () => (confirm ? void run(() => remove.mutateAsync(undefined), <>Removed <em>{item.title}</em> from your library</>) : setConfirm(true)),
    });
  return <ContextMenu at={at} title={item.title} items={items} onClose={onClose} />;
}

export function MediaCard({ item }: { item: ItemCard }) {
  const menu = useContextMenu();
  const f = fraction(item.kind, item.progress);
  const active = item.status && !["completed", "finished", "beaten", "wishlist", "backlog"].includes(item.status);
  const sub = [statusLabel(item.kind, item.status), active ? progressText(item.kind, item.progress) : item.subtitle].filter(Boolean).join(" · ");
  return (
    <>
      <Link to={itemPath(item)} onContextMenu={menu.onContextMenu} className="poster-card flex flex-col gap-[10px] no-underline text-inherit hover:text-inherit min-w-0">
        <div className="relative">
          <Poster film={asFilm(item)} size="wall" />
          {active && f != null && <Meter value={f} className="absolute inset-x-3 bottom-3 bg-[rgba(7,8,12,0.55)]" />}
        </div>
        <div className="flex justify-between items-baseline gap-2">
          <span className="text-[14px] font-medium truncate">{item.title}</span>
          {item.my_rating != null && <span className="font-mono text-[12px] text-ink-star shrink-0">★ {rating(item.my_rating)}</span>}
        </div>
        <span className="mt-[-6px] text-[12px] text-ink-4 truncate">{sub}</span>
      </Link>
      {menu.at && <MediaCardMenu item={item} at={menu.at} onClose={menu.close} />}
    </>
  );
}

export const wallGrid = "grid grid-cols-[repeat(auto-fill,minmax(min(150px,100%),1fr))] gap-x-5 gap-y-8 max-[639px]:grid-cols-2 max-[639px]:gap-x-3 max-[639px]:gap-y-5";
export const pagePad = "px-12 max-[1023px]:px-6 max-[639px]:px-4";
