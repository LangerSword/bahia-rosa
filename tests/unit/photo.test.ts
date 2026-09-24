import { describe, expect, it } from "vitest";
import { countFiles, isPhoto, pickPhoto } from "../../src/lib/photo";

/**
 * What counts as a photo, from any of the three doors.
 *
 * The rules live in one place because they are asked three times — by the picker, by a drop anywhere on
 * the page, and by a paste. Two of those arrive from outside the browser's file dialog, which is where
 * the untidy cases come from: a clipboard item with an empty `type`, a drop carrying several files, a
 * paste carrying words.
 */
describe("a photo, from a drop or a paste", () => {
  it("takes a file the browser typed as an image", () => {
    expect(isPhoto({ type: "image/png", name: "screenshot.png" })).toBe(true);
    expect(isPhoto({ type: "image/jpeg", name: "photo.jpg" })).toBe(true);
    expect(isPhoto({ type: "image/webp", name: "whatever" })).toBe(true);
  });

  it("takes an untyped file that is named like one", () => {
    // A clipboard item built from pixels, or a file manager that did not fill the type in.
    expect(isPhoto({ type: "", name: "Pasted image 2026-09-24.JPG" })).toBe(true);
    expect(isPhoto({ type: "", name: "shot.HEIC" })).toBe(true);
  });

  it("refuses words, and a file with no name and no type", () => {
    expect(isPhoto({ type: "text/plain", name: "notes.txt" })).toBe(false);
    expect(isPhoto({ type: "application/pdf", name: "ticket.pdf" })).toBe(false);
    expect(isPhoto({ type: "", name: "" })).toBe(false);
    expect(isPhoto({ type: "" })).toBe(false);
  });

  it("picks the first photo out of a drop that carried several files", () => {
    const dropped = [
      { type: "text/plain", name: "notes.txt" },
      { type: "application/pdf", name: "ticket.pdf" },
      { type: "image/jpeg", name: "the one.jpg" },
      { type: "image/png", name: "another.png" },
    ];
    expect(pickPhoto(dropped)?.name).toBe("the one.jpg");
  });

  it("answers nothing when a drop carried no photo at all", () => {
    expect(pickPhoto([{ type: "text/plain", name: "notes.txt" }])).toBe(null);
    expect(pickPhoto([])).toBe(null);
    expect(pickPhoto(null)).toBe(null);
    expect(pickPhoto(undefined)).toBe(null);
  });

  it("counts what arrived, so the line can tell the truth about what was ignored", () => {
    expect(countFiles([{ type: "image/png" }, { type: "image/png" }])).toBe(2);
    expect(countFiles([])).toBe(0);
    expect(countFiles(null)).toBe(0);
  });
});
