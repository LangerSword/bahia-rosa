/**
 * Where the title's lines actually are.
 *
 * The wordmark is one `h1` made of per-letter spans, so a `Range` over it returns a rectangle per *letter*,
 * not per line. The dust has to be drawn line by line — a canvas that draws a wrapped title as one long line
 * overflows its own box and clips, which looks like the type changing face when it is really the type
 * changing *shape* — and to draw the lines it has to know where they are.
 *
 * So: group the letter rectangles into lines, keep each line's own text and geometry, and hand that to the
 * sampler. Pure, so the grouping can be tested without a browser.
 */

export interface LetterBox {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LineBox {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Letters whose tops differ by less than this belong to the same line: masks and accents nudge them. */
export const LINE_TOLERANCE = 6;

export function mergeLineRects(boxes: LetterBox[], tolerance = LINE_TOLERANCE): LineBox[] {
  const usable = boxes.filter((box) => box.text.length > 0 && box.width > 0.5);
  if (usable.length === 0) return [];

  const sorted = [...usable].sort((a, b) => a.top - b.top);
  const lines: Array<{ items: LetterBox[]; top: number }> = [];

  for (const box of sorted) {
    const line = lines[lines.length - 1];
    // Compare against the line's own top so a stack of letters cannot walk down the page one nudge at a time.
    if (line && Math.abs(box.top - line.top) <= tolerance) {
      line.items.push(box);
    } else {
      lines.push({ items: [box], top: box.top });
    }
  }

  return lines.map((line) => {
    const left = Math.min(...line.items.map((item) => item.left));
    const right = Math.max(...line.items.map((item) => item.left + item.width));
    const top = Math.min(...line.items.map((item) => item.top));
    const bottom = Math.max(...line.items.map((item) => item.top + item.height));
    return {
      text: line.items
        .sort((a, b) => a.left - b.left)
        .map((item) => item.text)
        .join("")
        .replace(/\u00A0/g, " ")
        .trim(),
      left,
      top,
      width: right - left,
      height: bottom - top,
    };
  });
}