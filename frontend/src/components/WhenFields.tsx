import type { DatePrecision } from "../api/types";
import { iso, today } from "../lib/format";
import { DateField } from "./DateField";
import { Segmented, cx } from "./ui";

const PRECISIONS: { id: DatePrecision; label: string }[] = [
  { id: "day", label: "Day" }, { id: "month", label: "Month" }, { id: "year", label: "Year" }, { id: "unknown", label: "Unknown" },
];
const field = "h-11 box-content px-3 rounded-[12px] border border-(--line-5) bg-(--fill-input) text-ink-hi text-[14px] min-w-0";

/** "I remember the" Day / Month / Year / Unknown, shared by movie watches, runs and episodes. */
export function PrecisionPicker({ value, onChange }: { value: DatePrecision; onChange: (p: DatePrecision) => void }) {
  return <Segmented<DatePrecision> label="Date precision" variant="form" value={value} onChange={onChange} options={PRECISIONS} />;
}

/** A date at the chosen precision, or "Date unknown" in its place. */
export function DateOrUnknown({ id, value, precision, onChange }: {
  id: string; value: string; precision: DatePrecision; onChange: (iso: string) => void;
}) {
  if (precision === "unknown") return <span id={id} className={cx(field, "w-[220px] flex items-center text-ink-3")}>Date unknown</span>;
  return <DateField id={id} value={value} precision={precision} onChange={onChange} className={cx(field, precision === "year" ? "w-[140px]" : "w-[220px]")} />;
}

/** A stored unknown date (0001-01-01) means nothing once a real precision is picked again: start from today. */
export const fromUnknown = (v: string) => (v.startsWith("0001") ? iso(today()) : v);
