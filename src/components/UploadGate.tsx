import { useCallback, useRef, useState } from "react";
import { fileToBase64Jpeg } from "../lib/portrait/hosted";
import { describeRenderFailure, renderPortrait } from "../lib/portrait/pipeline";

/**
 * Intake: one photo in, one character portrait out — generated server-side on Cloudflare
 * (see docs/portrait.md). The demo plates are baked art so the experience is never a dead end.
 */

const DEMOS = [
  { id: "placeholder", label: "Demo plate", src: `${import.meta.env.BASE_URL}art/demo/placeholder.png` },
];

interface UploadGateProps {
  onPortrait: (dataUrl: string, source: "photo" | "demo") => void;
}

export function UploadGate({ onPortrait }: UploadGateProps) {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState<string>("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setStatus("error");
        setMessage(`"${file.name}" is not an image.`);
        return;
      }
      setStatus("working");
      setMessage("Printing your portrait…");
      try {
        const base64 = await fileToBase64Jpeg(file, 512);
        const { dataUrl } = await renderPortrait({ image: base64 });
        onPortrait(dataUrl, "photo");
        setStatus("idle");
        setMessage("");
      } catch (error) {
        setStatus("error");
        setMessage(describeRenderFailure(error));
      }
    },
    [onPortrait],
  );

  return (
    <section className="rounded-none border border-paper/20 bg-rosa/10 p-8">
      <h2 className="font-display text-3xl leading-tight">Step 1 — the face</h2>
      <p className="mt-2 max-w-prose text-sm text-paper/70">
        Your portrait is rendered for this city's loading screen. It is made on our print desk from
        the photo you choose — nothing is stored, and nothing of yours is published anywhere.
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
          if (file) void accept(file);
        }}
        className={`mt-6 flex flex-col items-center justify-center gap-3 border-2 border-dashed p-10 transition ${
          dragging ? "border-paper/70 bg-paper/5" : "border-paper/25"
        }`}
      >
        <p className="text-sm text-paper/80">Drop a selfie here, or</p>
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
            if (file) void accept(file);
          }}
        />
        <p className="max-w-prose text-center text-xs text-paper/50">
          Face the camera, plain background, shoulders up. The print desk works best with a straight-on shot.
        </p>
      </div>

      {status !== "idle" ? (
        <p
          data-testid="upload-status"
          className={`mt-4 text-sm ${status === "error" ? "text-red-300" : "text-paper/80"}`}
          role="status"
        >
          {message}
        </p>
      ) : null}

      <div className="mt-6">
        <p className="text-xs tracking-[0.25em] text-paper/50 uppercase">Or take a press plate</p>
        <div className="mt-3 flex gap-3">
          {DEMOS.map((demo) => (
            <button
              key={demo.id}
              type="button"
              data-testid={`demo-${demo.id}`}
              onClick={() => onPortrait(demo.src, "demo")}
              className="border border-paper/25 p-1 hover:border-paper/60"
              title={demo.label}
            >
              <img src={demo.src} alt={demo.label} className="h-24 w-24 object-cover" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
