/**
 * What counts as a photo, and which one a visitor meant.
 *
 * Three ways in — the picker, a drop, a paste — and one answer, so the rules cannot drift apart between
 * them. A dropped file arrives from a file manager, a pasted one from the clipboard of a screenshot tool,
 * and neither is required to be tidy: a clipboard item can arrive with an empty `type`, and a drop can
 * carry several files at once.
 */

/** Is this something the press can be asked to read? */
export function isPhoto(file: { type: string; name?: string }): boolean {
  if (file.type.startsWith("image/")) return true;
  // An empty type happens — a file manager that did not fill it in, a clipboard item built from pixels.
  // The extension is a fair second guess, and the press reports honestly if it cannot decode the result.
  return file.type === "" && /\.(jpe?g|png|webp|avif|gif|bmp|heic)$/i.test(file.name ?? "");
}

/**
 * The first photo in a drop or a paste.
 *
 * A drop of several files presses the first one rather than refusing the lot: the visitor's intent is
 * clear, and the count is reported back so they know the rest were not silently dropped.
 */
export function pickPhoto<T extends { type: string; name?: string }>(
  files: Iterable<T> | ArrayLike<T> | null | undefined,
): T | null {
  if (!files) return null;
  for (const file of Array.from(files as ArrayLike<T>)) {
    if (file && isPhoto(file)) return file;
  }
  return null;
}

/** How many files a drop or paste carried, for a line that tells the truth about what was ignored. */
export function countFiles(files: Iterable<unknown> | ArrayLike<unknown> | null | undefined): number {
  if (!files) return 0;
  return Array.from(files as ArrayLike<unknown>).length;
}