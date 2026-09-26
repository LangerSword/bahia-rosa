import { describe, expect, it } from "vitest";
import { CARD_TIPS, pressStamp, serialFor, tipFor } from "../../src/lib/card";

describe("the card's serial", () => {
  it("reads like a serial", () => {
    expect(serialFor("bahia-rosa-frame.png|La Marina|AAAA")).toMatch(/^№ \d{3}-\d{5}$/);
  });

  it("is the same serial for the same plate, every time", () => {
    const seed = "bahia-rosa-gng.png|El Boulevard|BBBB";
    expect(serialFor(seed)).toBe(serialFor(seed));
  });

  it("is a different serial for a different plate", () => {
    expect(serialFor("bahia-rosa-one.png|La Marina|QQQQ")).not.toBe(
      serialFor("bahia-rosa-two.png|El Boulevard|ZZZZ"),
    );
  });

  it("does not depend on the head of the plate, which every canvas-encoded frame shares", () => {
    const head = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL";
    expect(serialFor(head + "ONE")).not.toBe(serialFor(head + "TWO"));
  });
});

describe("the press stamp", () => {
  it("writes the real time out, without a locale", () => {
    // 26 September 2026 was a Saturday.
    expect(pressStamp(new Date(2026, 8, 26, 21, 4))).toBe("pressed 21:04 · sat 26 sep");
  });

  it("pads the small hours", () => {
    // 2 January 2026 was a Friday.
    expect(pressStamp(new Date(2026, 0, 2, 4, 7))).toBe("pressed 04:07 · fri 2 jan");
  });
});

describe("the tip under the card", () => {
  it("is one of the real tips, and stable for a given plate", () => {
    const tip = tipFor("bahia-rosa-frame.png|La Marina|AAAA");
    expect(CARD_TIPS).toContain(tip);
    expect(tipFor("bahia-rosa-frame.png|La Marina|AAAA")).toBe(tip);
  });
});