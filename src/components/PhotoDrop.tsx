import { useEffect, useRef, useState } from "react";
import { describeUploadProblem } from "../lib/plates/plates";
import { countFiles, pickPhoto } from "../lib/photo";

/**
 * A photo, from anywhere on the page.
 *
 * The intake's dashed box is the *affordance*; this is the *surface*. Someone dragging a file out of a
 * file manager is aiming at the page, not at a rectangle they have to hit, and a screenshot lives on the
 * clipboard rather than in a folder — so a drop anywhere and a paste anywhere both go exactly where the
 * picker goes. Nothing here is a second pipeline: the same rules (`describeUploadProblem`) and the same
 * press.
 *
 * The overlay exists because a drop with no visible target is a guess. It is `pointer-events: none` so
 * the drag continues to the window handler underneath it, and it says the one thing worth saying while a
 * file is in the air: it never leaves this browser.
 */

interface PhotoDropProps {
  /** Only where a new photo means something — the intake, and the fork where "another one" is offered. */
  enabled: boolean;
  onPhoto: (file: File) => void;
  /** A line for the intake when a drop or paste could not be used, and null to clear it. */
  onProblem: (problem: string | null) => void;
}

export function PhotoDrop({ enabled, onPhoto, onProblem }: PhotoDropProps) {
  const [dragging, setDragging] = useState(false);
  // dragenter and dragleave fire for every child element the pointer crosses, so they are counted rather
  // than trusted: the first real one is not the last, and a naive handler flickers on every boundary.
  const depth = useRef(0);

  useEffect(() => {
    if (!enabled) {
      depth.current = 0;
      setDragging(false);
      return;
    }

    const take = (files: FileList | File[] | null) => {
      const photo = pickPhoto(files);
      if (!photo) {
        onProblem("that is not a photo — jpg, png or webp");
        return;
      }
      const issue = describeUploadProblem(photo);
      if (issue) {
        onProblem(issue);
        return;
      }
      const count = countFiles(files);
      onProblem(count > 1 ? `pressing the first of ${count} — one at a time for now` : null);
      onPhoto(photo);
    };

    const carriesFiles = (event: DragEvent) => Boolean(event.dataTransfer?.types?.includes("Files"));

    const onDragEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth.current += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      // Prevent the default or the browser refuses the drop and opens the file instead — the page navigates
      // away from the frame the visitor was about to make. Also done when the drag carries no readable type
      // list, because some platforms fill that in only at the moment of the drop, and a drag that is
      // silently refused is a drag that looks broken.
      const types = event.dataTransfer?.types;
      if (!carriesFiles(event) && types && types.length > 0) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      // The files themselves decide, not the type list: gating the drop on `types` is what made a real
      // drag from a file manager do nothing on the platforms that leave it empty until the drop.
      const files = event.dataTransfer?.files ?? null;
      if (!files || files.length === 0) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      take(files);
    };
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      const files: File[] = [];
      if (items) {
        for (const item of items) {
          if (item.kind !== "file") continue;
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length) {
        event.preventDefault();
        take(files);
        return;
      }
      // A paste that carried no photo is worth answering: a screenshot tool that copied a path, or a text
      // selection, would otherwise look like the page had ignored the visitor.
      const text = event.clipboardData?.getData("text") ?? "";
      if (text) onProblem("that was text, not a photo — copy an image, or drop a file");
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, [enabled, onPhoto, onProblem]);

  if (!enabled || !dragging) return null;

  return (
    <div
      data-testid="photo-drop"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        pointerEvents: "none",
        display: "grid",
        placeContent: "center",
        gap: "0.5rem",
        textAlign: "center",
        background: "color-mix(in srgb, var(--color-ink) 82%, transparent)",
        border: "1px dashed var(--color-accent)",
      }}
    >
      <p className="display" style={{ color: "var(--color-paper)", margin: 0 }}>
        drop it
      </p>
      <p className="text-xs" style={{ color: "var(--color-faint)", margin: 0 }}>
        anywhere on the page · it never leaves this browser
      </p>
    </div>
  );
}