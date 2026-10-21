import { describe, expect, it } from "vitest";
import { endCombo, strike } from "./celebrate";

describe("strike", () => {
  it("drops clicks inside the cooldown, counts a combo inside the window, and resets after it", () => {
    expect(strike("a", 10_000)).toBe(1);
    expect(strike("a", 10_100)).toBeNull(); // cooling down
    expect(strike("a", 10_200)).toBe(2);
    expect(strike("a", 11_000)).toBe(3);
    expect(strike("a", 13_000)).toBe(1); // the window lapsed
    expect(strike("b", 13_050)).toBe(1); // another thing starts its own
    expect(strike("a", 13_300)).toBe(1);
  });

  it("opens no combo after an un-mark, but keeps the cooldown", () => {
    expect(strike("c", 20_000)).toBe(1);
    endCombo("c");
    expect(strike("c", 20_100)).toBeNull();
    expect(strike("c", 20_300)).toBe(1);
    expect(strike("c", 20_600)).toBe(2);
  });
});
