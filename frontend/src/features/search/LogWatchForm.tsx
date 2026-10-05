import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { DatePrecision, WatchOut } from "../../api/types";
import { StarRating } from "../../components/StarRating";
import { Segmented, cx } from "../../components/ui";
import { iso, today } from "../../lib/format";

export type LogValues = Omit<WatchOut, "id" | "tmdb_id">;

const input =
  "h-11 box-content px-[14px] rounded-[12px] border border-(--line-4) bg-(--fill-input) text-ink-hi text-[14px] [color-scheme:dark] placeholder:text-ink-4 min-w-0";
const hidden = "absolute w-px h-px overflow-hidden [clip-path:inset(50%)]";

export function emptyValues(isRewatch = false): LogValues {
  return { watched_on: iso(today()), date_precision: "day", rating: null, is_rewatch: isRewatch, location: null, with_whom: null, notes: null };
}

/** The log/edit form (SCREENS: Command palette + log form). Submits on Enter in any single-line field. */
export function LogWatchForm({
  id, heading, initial, onSubmit, className, hint = "FETCHES DETAILS + POSTER ON SAVE",
}: {
  id: string;
  heading: string;
  initial: LogValues;
  onSubmit: (v: LogValues) => void;
  className?: string;
  hint?: string | null;
}) {
  const [v, setV] = useState<LogValues>(initial);
  const set = <K extends keyof LogValues>(k: K, val: LogValues[K]) => setV((o) => ({ ...o, [k]: val }));
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    onSubmit({ ...v, with_whom: v.with_whom?.trim() || null, location: v.location?.trim() || null, notes: v.notes?.trim() || null });
  };
  const onTextareaKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
  };
  const year = Number(v.watched_on.slice(0, 4));
  const day = (offset: number) => {
    const d = today();
    d.setDate(d.getDate() - offset);
    return iso(d);
  };
  /** Keys 1–5 rate (again → half a star less), 0 clears, Enter saves, unless you're typing in a field. */
  const onFormKey = (e: KeyboardEvent<HTMLFormElement>) => {
    const t = e.target as HTMLElement;
    const typing = t.matches("input:not([type='checkbox']), textarea");
    if (!typing && /^[0-5]$/.test(e.key)) {
      const n = Number(e.key);
      set("rating", n === 0 ? null : v.rating === n ? n - 0.5 : n);
      e.preventDefault();
    } else if (e.key === "Enter" && (t === e.currentTarget || t.closest("[data-star]"))) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      id={id}
      tabIndex={-1}
      onSubmit={submit}
      onKeyDown={onFormKey}
      className={cx("p-5 rounded-[18px] bg-(--fill-glass) border border-(--line-1) flex flex-col gap-[18px] outline-none", className)}
    >
      <div className="flex justify-between items-baseline gap-3 flex-wrap">
        <span className="font-display font-medium text-[16px]">{heading}</span>
        {hint && <span className="font-mono text-[11px] tracking-[0.08em] text-ink-4">{hint}</span>}
      </div>

      <div className="flex flex-wrap gap-[18px] items-end">
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={`${id}-d`} className="text-[12px] text-ink-3">Watched on</label>
            {v.date_precision === "day" && (
              <span className="flex gap-2 -my-2">
                {[["Today", 0], ["Yesterday", 1]].map(([label, off]) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={v.watched_on === day(off as number)}
                    onClick={() => set("watched_on", day(off as number))}
                    className={cx("h-6 px-0 bg-transparent border-0 text-[11px] font-mono cursor-pointer", v.watched_on === day(off as number) ? "text-accent" : "text-ink-4 hover:text-ink-2")}
                  >
                    {label}
                  </button>
                ))}
              </span>
            )}
          </div>
          {v.date_precision === "day" && (
            <input id={`${id}-d`} type="date" required value={v.watched_on} max={iso(today())} onChange={(e) => e.target.value && set("watched_on", e.target.value)} className={cx(input, "px-3 border-(--line-5)")} />
          )}
          {v.date_precision === "month" && (
            <input id={`${id}-d`} type="month" required value={v.watched_on.slice(0, 7)} onChange={(e) => e.target.value && set("watched_on", `${e.target.value}-01`)} className={cx(input, "px-3 border-(--line-5)")} />
          )}
          {v.date_precision === "year" && (
            <input
              id={`${id}-d`} type="number" required min={1900} max={today().getFullYear()} value={year}
              onChange={(e) => e.target.value.length === 4 && set("watched_on", `${e.target.value}-01-01`)}
              className={cx(input, "px-3 border-(--line-5) w-[120px]")}
            />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <span id={`${id}-p`} className="text-[12px] text-ink-3">I remember the</span>
          <Segmented<DatePrecision>
            label="Date precision"
            variant="form"
            value={v.date_precision}
            onChange={(p) => set("date_precision", p)}
            options={[{ id: "day", label: "Day" }, { id: "month", label: "Month" }, { id: "year", label: "Year" }]}
          />
        </div>
        <StarRating value={v.rating} onChange={(r) => set("rating", r)} />
      </div>

      <div className="flex flex-wrap gap-[14px]">
        <label className="flex items-center gap-[10px] h-11 box-content px-[14px] rounded-[12px] border border-(--line-4) text-[14px] cursor-pointer">
          <input type="checkbox" checked={v.is_rewatch} onChange={(e) => set("is_rewatch", e.target.checked)} className="size-[18px] accent-accent" />
          Rewatch
        </label>
        <div className="flex-[1_1_180px] flex flex-col">
          <label htmlFor={`${id}-w`} className={hidden}>With whom</label>
          <input id={`${id}-w`} type="text" placeholder="With whom (optional)" value={v.with_whom ?? ""} onChange={(e) => set("with_whom", e.target.value)} className={input} />
        </div>
        <div className="flex-[1_1_180px] flex flex-col">
          <label htmlFor={`${id}-l`} className={hidden}>Where</label>
          <input id={`${id}-l`} type="text" placeholder="Where (optional)" value={v.location ?? ""} onChange={(e) => set("location", e.target.value)} className={input} />
        </div>
      </div>
      <label htmlFor={`${id}-n`} className={hidden}>Notes</label>
      <textarea
        id={`${id}-n`} rows={2} placeholder="Notes" value={v.notes ?? ""} onChange={(e) => set("notes", e.target.value)} onKeyDown={onTextareaKey}
        className="resize-y box-content py-3 px-[14px] rounded-[12px] border border-(--line-4) bg-(--fill-input) text-ink-hi text-[14px] font-[inherit] placeholder:text-ink-4"
      />
      <button type="submit" hidden />
    </form>
  );
}
