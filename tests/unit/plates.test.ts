import { describe, expect, test } from "vitest";
import { BAKED_PLATES, describeUploadProblem, plateFromBaked, plateFromFile } from "../../src/lib/plates/plates";

/**
 * The intake rules. No network involved — an uploaded file is validated and handed back as an
 * object URL, and the baked plates are static build assets.
 */

/** Only name/type/size are read by the validator, so a plain shape keeps the test allocation-free. */
function fakeFile(name: string, type: string, sizeBytes: number): File {
  return { name, type, size: sizeBytes } as unknown as File;
}

describe("describeUploadProblem", () => {
  test("accepts an ordinary photo", () => {
    expect(describeUploadProblem(fakeFile("me.jpg", "image/jpeg", 2_000_000))).toBeNull();
  });

  test("rejects non-images by name", () => {
    expect(describeUploadProblem(fakeFile("notes.txt", "text/plain", 100))).toContain("notes.txt");
  });

  test("rejects files over 20 MB", () => {
    const problem = describeUploadProblem(fakeFile("huge.png", "image/png", 21 * 1024 * 1024));
    expect(problem).toMatch(/20 MB/);
  });
});

describe("plate sources", () => {
  test("a file becomes a local object URL", () => {
    // A real File here: URL.createObjectURL requires an actual Blob.
    const plate = plateFromFile(new File([new Uint8Array(8)], "me.jpg", { type: "image/jpeg" }));
    expect(plate.kind).toBe("photo");
    if (plate.kind === "photo") {
      expect(plate.objectUrl.startsWith("blob:")).toBe(true);
      expect(plate.name).toBe("me.jpg");
    }
  });

  test("a baked plate keeps its id and src", () => {
    const baked = BAKED_PLATES[0];
    const plate = plateFromBaked(baked);
    expect(plate).toEqual({ kind: "plate", id: baked.id, src: baked.src });
  });

  test("every baked plate ships a unique id and a build-relative path", () => {
    const ids = BAKED_PLATES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const plate of BAKED_PLATES) {
      expect(plate.src.startsWith("/")).toBe(true);
      expect(plate.label.length).toBeGreaterThan(0);
    }
  });
});
