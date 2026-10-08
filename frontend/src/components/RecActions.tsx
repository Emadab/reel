import type { MouseEvent, ReactNode } from "react";
import { pop } from "../lib/pop";
import { rating } from "../lib/format";
import { IconBookmark, IconCheck, IconNotInterested, IconThumbUp } from "./Icons";
import { RatingInput } from "./Rating";
import { Button, IconButton } from "./ui";

/**
 * A suggestion's four answers, the same in every medium: want it (a toggle), more like this (a toggle), already had
 * it (rate it), not interested (a toggle). Every answer shows at once and animates on the click; the save runs behind.
 */
export type Answers = {
  wish: string; // "watchlist", "wishlist"…
  seen: string; // "Seen it, rate it", "Read it, rate it"…
  saved: boolean;
  liked: boolean;
  rated: number | null;
  hidden: boolean;
  rating: boolean; // the rate-it keys are open
  save: () => void;
  like: () => void;
  openRating: () => void;
  rate: (v: number) => void;
  hide: () => void;
};

/** The rating just landed: stamp the check on the "seen" button next to the keys that were pressed. */
const stamp = (rate: (v: number) => void) => (v: number | null) => {
  if (v == null) return;
  pop((document.activeElement?.closest("article, section") ?? document).querySelector("[data-seen]"), "seen");
  rate(v);
};

const fx = (kind: Parameters<typeof pop>[1], fn: () => void) => (e: MouseEvent<HTMLButtonElement>) => {
  pop(e.currentTarget, kind);
  fn();
};

export const status = (a: Answers) =>
  a.hidden ? "Hidden, model notified" : a.rated != null ? `Logged · ★ ${rating(a.rated)}` : a.liked ? "Noted: more like this" : a.saved ? `On your ${a.wish}` : "";

/**
 * A label that's as wide as the widest of its states, so a click never resizes the button or shifts its neighbours:
 * every state sits in the same grid cell and only the current one is visible. Digits are tabular so ratings don't wobble.
 */
function Fit({ show, all }: { show: number; all: ReactNode[] }) {
  return (
    <span className="grid tabular-nums">
      {all.map((n, i) => (
        <span key={i} aria-hidden={i !== show || undefined} className={`[grid-area:1/1] flex items-center justify-center gap-2 ${i === show ? "" : "invisible"}`}>{n}</span>
      ))}
    </span>
  );
}

/** The top pick's row: labelled buttons. */
export function HeroActions({ a }: { a: Answers }) {
  return (
    <>
      <div className="flex flex-wrap gap-[10px] mt-2">
        <Button
          variant="primary" hero className="px-5" aria-pressed={a.saved} onClick={fx(a.saved ? "undo" : "save", a.save)}
          title={a.saved ? `Click to take it off your ${a.wish}` : "Save it for later; the model counts it as interest"}
        >
          <IconBookmark size={16} strokeWidth={2.2} fill={a.saved ? "currentColor" : "none"} />
          <Fit show={a.saved ? 1 : 0} all={[`Add to ${a.wish}`, `On your ${a.wish}`]} />
        </Button>
        <Button hero aria-expanded={a.rating} data-seen onClick={fx("undo", a.openRating)} title={a.rated != null ? "Your rating; the model has learned from it" : "Log it and rate it; your rating teaches the model"}>
          <Fit
            show={a.rated != null ? 1 : 0}
            all={[a.seen, ...[a.rated, 10, 0.5].map((r) => <><IconCheck size={16} />{`Logged · ★ ${rating(r ?? 0)}`}</>)]}
          />
        </Button>
        <Button hero aria-pressed={a.hidden} onClick={fx(a.hidden ? "undo" : "hide", a.hide)} title={a.hidden ? "Undo: show it again" : "Hide it and steer away from things like it"}>
          <Fit show={a.hidden ? 1 : 0} all={["Not interested", "Hidden, model notified"]} />
        </Button>
      </div>
      {a.rating && a.rated == null && <RatingInput label="Your rating" value={null} onChange={stamp(a.rate)} />}
    </>
  );
}

/** A card's row: icon buttons. */
export function CardActions({ a }: { a: Answers }) {
  return (
    <div className="flex gap-[6px] mt-auto pt-[6px]">
      <IconButton shrink label={a.saved ? `On your ${a.wish}: click to remove` : `Add to ${a.wish}`} aria-pressed={a.saved} on={a.saved} onClick={fx(a.saved ? "undo" : "save", a.save)}>
        <IconBookmark size={18} fill={a.saved ? "currentColor" : "none"} />
      </IconButton>
      <IconButton shrink label="More like this" aria-pressed={a.liked} on={a.liked} onClick={fx(a.liked ? "undo" : "like", a.like)}>
        <IconThumbUp size={18} fill={a.liked ? "currentColor" : "none"} />
      </IconButton>
      <IconButton shrink label={a.rated != null ? `Logged · ★ ${rating(a.rated)}` : a.seen} aria-expanded={a.rating} on={a.rated != null} data-seen onClick={fx("undo", a.openRating)}>
        <IconCheck size={18} />
      </IconButton>
      <IconButton shrink label={a.hidden ? "Hidden: click to undo" : "Not interested"} aria-pressed={a.hidden} on={a.hidden} onClick={fx(a.hidden ? "undo" : "hide", a.hide)}>
        <IconNotInterested size={18} />
      </IconButton>
      <span className="flex-1 basis-0 self-center min-w-0 truncate text-[12px] text-ink-4 text-right">{status(a)}</span>
    </div>
  );
}

/** The card's two-line slot: the reason, or the rate-it keys while they're open, so every card keeps one size. */
export function CardWhy({ a, why, title }: { a: Answers; why: string; title: string }) {
  return (
    <div className="h-[2lh] text-[14px] leading-[1.45] flex items-start">
      {a.rating && a.rated == null ? (
        <div className="w-full"><RatingInput compact hideLabel label={`Rate ${title}`} value={null} onChange={stamp(a.rate)} /></div>
      ) : (
        <p className="m-0 line-clamp-2 text-[14px] leading-[1.45] text-ink-body">{why}</p>
      )}
    </div>
  );
}
