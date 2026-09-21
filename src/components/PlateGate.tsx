import { useCallback, useRef, useState } from "react";
import { describeUploadProblem } from "../lib/plates/plates";
import { printChoices } from "../lib/printdesk/client";

/**
 * Intake — one image in, one image into the editor. Everything is local: an uploaded photo is
 * read straight from the file object in the page and framed by the desk on this machine.
 *
 * The choices here (surface, location, quality) are the ones the desk actually understands, and
 * they come from the look spec rather than a hand-written list, so the UI cannot drift from it.
 */

export interface PrintChoice {
  /** Which surface style to print: character shot, loading screen, poster, press photo. */
  surface: string;
  /** Where the subject stands; undefined means the desk rotates through the city. */
  location?: string;
  /** Base model at 26 steps instead of the fast 4-step distilled one. */
  quality: boolean;
}

interface PlateGateProps {
  /** A photo from the player — handed to the print desk, never uploaded to a server of ours. */
  onPhoto: (file: File, choice: PrintChoice) => void;
}

const { surfaces, locations } = printChoices();

export function PlateGate({ onPhoto }: PlateGateProps) {
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [surface, setSurface] = useState("debut");
  const [location, setLocation] = useState("");
  const [quality, setQuality] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = useCallback(
    (file: File) => {
      const issue = describeUploadProblem(file);
      if (issue) {
        setProblem(issue);
        return;
      }
      setProblem(null);
      onPhoto(file, { surface, location: location || undefined, quality });
    },
    [onPhoto, surface, location, quality],
  );

  return (
    <section className="panel rule border p-8">
      <p className="kicker">Step 1</p>
      <h2 className="display mt-3 text-4xl">The plate</h2>
      <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-[color:var(--color-muted)]">
        Bring a photo, or take one of the desk's proof plates. Your file is read in this page and sent
        only to the desk on this machine — there is no server of ours in the path.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="kicker">Style</span>
          <select
            data-testid="choose-style"
            value={surface}
            onChange={(event) => setSurface(event.target.value)}
            className="rule mt-2 w-full border bg-[color:var(--color-ink-3)] px-3 py-2 text-sm text-[color:var(--color-body)]"
          >
            {surfaces.map((option) => (
              <option key={option.id} value={option.id} className="text-black">
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="kicker">Location</span>
          <select
            data-testid="choose-location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            className="rule mt-2 w-full border bg-[color:var(--color-ink-3)] px-3 py-2 text-sm text-[color:var(--color-body)]"
          >
            <option value="" className="text-black">
              Rotate ({locations.length} places)
            </option>
            {locations.map((option) => (
              <option key={option.id} value={option.id} className="text-black">
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-end gap-3 pb-2">
          <input
            data-testid="choose-quality"
            type="checkbox"
            checked={quality}
            onChange={(event) => setQuality(event.target.checked)}
            className="h-4 w-4 accent-[color:var(--color-gold)]"
          />
          <span className="text-sm text-[color:var(--color-body)]">
            Quality print
            <span className="block text-xs text-[color:var(--color-faint)]">base model, 26 steps — slower, sharper</span>
          </span>
        </label>
      </div>

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
        className={`lift mt-6 flex flex-col items-center justify-center gap-3 border-2 border-dashed p-10 ${
          dragging ? "border-[color:var(--color-gold)] bg-[color:var(--color-ink-3)]" : "rule"
        }`}
      >
        <p className="text-sm text-[color:var(--color-body)]">Drop a photo here, or</p>
        <button
          type="button"
          data-testid="choose-photo"
          onClick={() => inputRef.current?.click()}
          className="lift rule border px-6 py-3 text-xs tracking-[0.2em] text-[color:var(--color-paper)] uppercase hover:text-[color:var(--color-gold)]"
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
        <p className="max-w-[52ch] text-center text-xs text-[color:var(--color-faint)]">
          Face the camera, plain background, shoulders up — the desk finds the face and frames it itself.
        </p>
      </div>

      {problem ? (
        <p data-testid="upload-status" role="status" className="mt-4 text-sm" style={{ color: "#ef6f6f" }}>
          {problem}
        </p>
      ) : null}

      <div className="rule mt-8 flex flex-wrap items-center justify-between gap-4 border-t pt-6">
        <p className="max-w-[46ch] text-xs leading-relaxed text-[color:var(--color-faint)]">
          Your photo is framed on this machine, printed on this machine, and never uploaded anywhere.
          Nothing here needs an account or a key.
        </p>
        <a
          href="?demo=launch"
          className="lift rule border px-4 py-2 text-xs tracking-[0.2em] text-[color:var(--color-body)] uppercase hover:text-[color:var(--color-gold)]"
        >
          See the payoff first
        </a>
      </div>
    </section>
  );
}
