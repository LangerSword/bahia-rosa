import { useCallback, useEffect, useRef, useState } from "react";
import { describeUploadProblem } from "../lib/plates/plates";
import { pickPhoto } from "../lib/photo";
import { deskAvailable, deskRoot } from "../lib/printdesk/client";

/**
 * Intake: one photograph in.
 *
 * The desk's own options used to live here — a surface picker, a location picker, a "rotate" default, a
 * quality checkbox — and every one of them was a question the visitor should never have been asked.
 * They were scaffolding for a GPU process, not decisions about their own photograph, and they made the
 * first screen read like a print-shop order form. The press decides the print; the visitor's two real
 * choices are the place and the hour, and both live on the sections above this one, where they can be
 * seen rather than read off a dropdown.
 *
 * What is left is the drop zone, the picker, and the honesty: where the file is read, that it stays
 * there, and — when this page has been pointed at a desk on another machine — that the photo goes
 * there, because a visitor is entitled to know when their photograph leaves the machine it was read on.
 */

interface PlateGateProps {
  /** A photo from the visitor. Read in the page; never uploaded to a server of ours. */
  onPhoto: (file: File) => void;
}

/**
 * What the desk prints with. The intake no longer asks — the press decides — but the desk still needs
 * the shape, so it stays exported from here.
 */
export interface PrintChoice {
  /** Which surface style to print: character shot, loading screen, poster, press photo. */
  surface: string;
  /** Where the subject stands; undefined means the desk rotates through the city's places. */
  location?: string;
  /** Base model at 26 steps instead of the fast 4-step distilled one. */
  quality: boolean;
}

export function PlateGate({ onPhoto }: PlateGateProps) {
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // A desk that is not on this origin is somewhere else on the network. The visitor should learn that
  // from the intake, not from a surprise after they have chosen a photo.
  const [remote, setRemote] = useState<string | null>(null);
  const [desk, setDesk] = useState<"checking" | "up" | "down">("checking");

  useEffect(() => {
    let live = true;
    const root = deskRoot();
    if (!root) {
      // No desk is configured, so there is nothing to ask. Probing anyway costs a request and a console
      // error on every visit to the deployed site — where the press is the browser's — and for every
      // test that asserts a clean console. The desk is an opt-in this page was pointed at, so the probe
      // follows the opt-in.
      setDesk("down");
      return () => {
        live = false;
      };
    }
    try {
      setRemote(new URL(root).host);
    } catch {
      setRemote(root);
    }
    void deskAvailable().then((reachable) => {
      if (live) setDesk(reachable ? "up" : "down");
    });
    return () => {
      live = false;
    };
  }, []);

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
    <section className="section" aria-labelledby="intake-heading">
      <h2 id="intake-heading" className="display" style={{ color: "var(--color-paper)" }}>
        <span style={{ color: "var(--color-faint)" }}>~ </span>bring a photo
      </h2>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          // The same picking rule as a drop anywhere and a paste: the first photo in whatever arrived.
          const file = pickPhoto(event.dataTransfer.files);
          if (file) accept(file);
        }}
        className="mt-5 flex flex-col items-start gap-4"
        style={{
          border: `1px dashed ${dragging ? "var(--color-accent)" : "var(--color-rule)"}`,
          padding: "2.5rem 2rem",
        }}
      >
        <button type="button" data-testid="choose-photo" className="btn" onClick={() => inputRef.current?.click()}>
          [ choose a photo ]
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
        <p className="measure text-xs" style={{ color: "var(--color-faint)" }}>
          or drop one anywhere on the page · ⌘V / Ctrl+V pastes a copied screenshot · jpg, png or webp, up
          to 12MB
        </p>
      </div>

      {problem ? (
        <p
          data-testid="upload-status"
          role="status"
          className="mt-4 text-sm"
          style={{ color: "var(--color-danger)" }}
        >
          {problem}
        </p>
      ) : null}

      <div data-testid="desk-absent" className="mt-6">
        <p className="measure text-xs" style={{ color: "var(--color-faint)" }}>
          read in this page · cut in this page · stays in this page. no account, no key, nothing to install.
        </p>
        {remote ? (
          <p className="measure mt-3 text-xs" style={{ color: "var(--color-flag)" }}>
            You have pointed this page at a print desk answering at {remote}: your photo is sent to that
            machine and nowhere else. Nothing is stored there.
          </p>
        ) : desk === "up" ? (
          <p className="measure mt-3 text-xs" style={{ color: "var(--color-muted)" }}>
            The print desk on this machine is up and answering.
          </p>
        ) : null}
      </div>

      </section>
  );
}