import { describe, expect, it } from "vitest";
import { dayLabel, formatFullDate, formatLongDate, formatWatchDate, initials, parseDate, runtime } from "./format";

const ref = parseDate("2026-10-05");

describe("dates by precision", () => {
  it("formats day precision relative to the current year", () => {
    expect(formatWatchDate("2026-10-03", "day", ref)).toBe("Oct 3");
    expect(formatWatchDate("2025-11-21", "day", ref)).toBe("Nov 21, 2025");
  });
  it("never shows the padded day for imprecise dates", () => {
    expect(formatWatchDate("2020-03-01", "month", ref)).toBe("March 2020");
    expect(formatWatchDate("2019-01-01", "year", ref)).toBe("Sometime in 2019");
    expect(dayLabel("2020-03-01", "month")).toBe("month");
  });
  it("has a long form", () => {
    expect(formatLongDate("2026-10-03", "day", ref)).toBe("Sat, Oct 3");
    expect(formatFullDate("2017-10-06")).toBe("Oct 6, 2017");
  });
});

describe("misc", () => {
  it("formats runtime and initials", () => {
    expect(runtime(164)).toBe("2h 44m");
    expect(runtime(45)).toBe("45m");
    expect(initials("Ana de Armas")).toBe("AA");
  });
});
