import type { DatePrecision } from "../api/types";

export const FIXTURES = import.meta.env.VITE_FIXTURES === "1";
const FROZEN_TODAY = "2026-10-05";

/** "Today". Frozen at 2026-10-05 in fixture mode so screenshots are reproducible. */
export function today(): Date {
  if (FIXTURES) return parseDate(FROZEN_TODAY);
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function nowMs(): number {
  return FIXTURES ? Date.UTC(2026, 9, 5, 12, 0) : Date.now(); // fixture "now": 2026-10-05 12:00 UTC
}

export function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Parses "YYYY-MM-DD" as a local calendar date (no timezone shift). */
export function parseDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** ARCHITECTURE §3: day → "Oct 3" this year, "Nov 21, 2025" otherwise; month → "March 2020"; year → "Sometime in 2019". */
export function formatWatchDate(s: string, precision: DatePrecision, ref: Date = today()): string {
  const d = parseDate(s);
  if (precision === "year") return `Sometime in ${d.getFullYear()}`;
  if (precision === "month") return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const short = `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === ref.getFullYear() ? short : `${short}, ${d.getFullYear()}`;
}

/** Always includes the year: "Oct 6, 2017". */
export function formatFullDate(s: string): string {
  const d = parseDate(s);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** The long form "Sat, Oct 3" (the year is added when it isn't the current one). */
export function formatLongDate(s: string, precision: DatePrecision, ref: Date = today()): string {
  if (precision !== "day") return formatWatchDate(s, precision, ref);
  const d = parseDate(s);
  const base = `${DAYS_SHORT[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === ref.getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

/** Timeline label under a poster: "Jan 12", or "month" for month precision. */
export function dayLabel(s: string, precision: DatePrecision): string {
  if (precision !== "day") return precision;
  const d = parseDate(s);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

export function monthShort(i: number): string {
  return MONTHS_SHORT[i];
}

export function runtime(min: number | null | undefined): string {
  if (!min) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** A 0–10 rating: "9", "8.5", "7.7". */
export function rating(r: number | null | undefined): string {
  return r == null ? "" : String(Math.round(r * 10) / 10);
}

export function num(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function pct(score: number | null | undefined): string {
  return score == null ? "–" : `${Math.round(score * 100)}%`;
}

const langNames = new Intl.DisplayNames(["en"], { type: "language" });
export function language(code: string | null | undefined): string {
  if (!code) return "";
  if (code.length > 3) return code;
  try {
    return langNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export function relativeTime(isoString: string, now: number = nowMs()): string {
  const s = Math.max(0, (now - new Date(isoString).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${num(n)} ${n === 1 ? one : many}`;
}

export function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
