import { describe, expect, it } from "vitest";
import { LINE_TOLERANCE, mergeLineRects, type LetterBox } from "../../src/lib/lines";

const box = (text: string, left: number, top: number, width = 40, height = 90): LetterBox => ({
  text,
  left,
  top,
  width,
  height,
});

describe("grouping letter boxes into lines", () => {
  it("keeps one line as one line", () => {
    const lines = mergeLineRects([box("B", 0, 100), box("A", 40, 100), box("H", 80, 100)]);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("BAH");
    expect(lines[0].left).toBe(0);
    expect(lines[0].width).toBe(120);
  });

  it("splits a wrapped title into its two lines, in reading order", () => {
    // The real case: "BAHÍA ROSA" at 128px in a 538px box, wrapping after the Í. B-A-H-Í-A, R-O-S-A.
    const lines = mergeLineRects([
      box("B", 0, 100, 44),
      box("A", 44, 100, 44),
      box("H", 88, 100, 44),
      box("Í", 132, 100, 30),
      box("A", 162, 100, 46),
      box("R", 0, 260, 30),
      box("O", 30, 260, 40),
      box("S", 70, 260, 30),
      box("A", 100, 260, 46),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe("BAHÍA");
    expect(lines[1].text).toBe("ROSA");
    expect(lines[0].top).toBe(100);
    expect(lines[1].top).toBe(260);
  });

  it("tolerates the small vertical nudges masks and accents give letters on the same line", () => {
    const lines = mergeLineRects([box("B", 0, 100), box("Í", 40, 100 + LINE_TOLERANCE - 1)]);
    expect(lines).toHaveLength(1);
  });

  it("does not walk a stack of letters down the page", () => {
    // Each letter a few pixels lower than the last: compared against the running *last* box they would all
    // merge into one line; compared against the line's own top they do not.
    const stair = Array.from({ length: 8 }, (_, index) => box("A", index * 30, 100 + index * 5));
    const lines = mergeLineRects(stair, 4);
    expect(lines.length).toBeGreaterThan(1);
  });

  it("ignores the spaces (they have no glyph to sample) and the empty case", () => {
    const lines = mergeLineRects([box("B", 0, 0), box("\u00A0", 40, 0, 0), box("A", 40, 0, 20)]);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("BA");
    expect(mergeLineRects([])).toEqual([]);
  });

  it("reports each line's own width from its letters, not from its container", () => {
    const lines = mergeLineRects([box("B", 10, 0, 46), box("A", 56, 0, 46)]);
    expect(lines[0].width).toBe(92);
  });
});