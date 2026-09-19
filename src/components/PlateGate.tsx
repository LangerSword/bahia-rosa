import { useCallback, useRef, useState } from "react";
import {
  BAKED_PLATES,
  describeUploadProblem,
  plateFromBaked,
  type PlateSource,
} from "../lib/plates/plates";

/**
 * Intake — one image in, one image into the editor. Everything is local: an uploaded photo is
 * read straight from the file object in the page, and the baked plates ship with the build.
 * See src/lib/plates/plates.ts for why generation is not in the request path.
 */

interface PlateGateProps {
  /** A photo from the player — handed to the print desk, never uploaded to a server of ours. */
  onPhoto: (file: File) => void;
  /** A baked cast plate — skips printing entirely. */
  onPlate: (plate: PlateSource) => void;
}

export function PlateGate({ onPhoto, onPlate }: PlateGateProps) {
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = useCallback(
    (file: File) => {
      const issue = describeUploadProblem(file);
      if (issue) {
        setProblem(issue);
        return;
      }
      setProblem(null);
      onPhoto(file);
    },
    [onPhoto],
  );

  return (
    <section className="border border-paper/20 bg-rosa/10 p-8">
      <h2 className="font-display text-3xl leading-tight">Step 1 — the plate</h2>
      <p className="mt-2 max-w-prose text-sm text-paper/70">
        Bring a photo, or take one of the desk's proof plates. Your file is read in this page and
        never uploaded anywhere — there is no server in this build.
      </p>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) accept(file);
        }}
        className={`mt-6 flex flex-col items-center justify-center gap-3 border-2 border-dashed p-10 transition ${
          dragging ? "border-paper/70 bg-paper/5" : "border-paper/25"
        }`}
      >
        <p className="text-sm text-paper/80">Drop a photo here, or</p>
        <button
          type="button"
          data-testid="choose-photo"
          onClick={() => inputRef.current?.click()}
          className="border border-paper/40 px-5 py-2 text-sm tracking-wide uppercase hover:bg-paper/10"
        >
          Choose a photo
        </button>
        <input
          ref={inputRef}
          data-testid="photo-input"
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) accept(file);
          }}
        />
        <p className="max-w-prose text-center text-xs text-paper/50">
          Face the camera, plain background, shoulders up — the desk works best with a straight-on shot.
        </p>
      </div>

      {problem ? (
        <p data-testid="upload-status" role="status" className="mt-4 text-sm text-red-300">
          {problem}
        </p>
      ) : null}

      <div className="mt-6">
        <p className="text-xs tracking-[0.25em] text-paper/50 uppercase">Or take a proof plate</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {BAKED_PLATES.map((plate) => (
            <button
              key={plate.id}
              type="button"
              data-testid={`plate-${plate.id}`}
              onClick={() => onPlate(plateFromBaked(plate))}
              className="border border-paper/25 p-1 text-left hover:border-paper/60"
              title={plate.note}
            >
              <img src={plate.src} alt={plate.label} className="h-24 w-24 object-cover" />
              <span className="mt-1 block text-xs text-paper/60">{plate.label}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
