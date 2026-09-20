import { useEffect, useMemo, useRef, useState } from "react";
import { PrintDeskOffline, printPlate, type PrintProgress } from "../lib/printdesk/client";
import type { PlateSource } from "../lib/plates/plates";
import type { PrintChoice } from "./PlateGate";

/**
 * The printing screen. The bar is driven by the desk's own execution events (see
 * src/lib/printdesk/client.ts), so it means something: it advances on real sampler steps and
 * stalls when the model stalls. No fake timers.
 */

interface PrintDeskProps {
  file: File;
  choice: PrintChoice;
  onPrinted: (plate: PlateSource, meta: { seed: number; register: string; location: string | null; seconds: number }) => void;
  onUseCastPlate: () => void;
}

const STAGE_LABEL: Record<PrintProgress["stage"], string> = {
  preparing: "warming the desk",
  uploading: "handing over your photo",
  queued: "queued",
  sampling: "printing",
  developing: "developing",
  done: "plate ready",
  failed: "the desk jammed",
};

export function PrintDesk({ file, choice, onPrinted, onUseCastPlate }: PrintDeskProps) {
  const [progress, setProgress] = useState<PrintProgress>({ stage: "preparing", percent: 0, message: "warming the desk" });
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [identity, setIdentity] = useState<{ similarity: number; verdict: string } | null>(null);
  const [seconds, setSeconds] = useState(0);
  const startedRef = useRef(false);

  const preview = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => {
    // StrictMode mounts effects twice in dev; a print job must not be submitted twice.
    if (startedRef.current) return;
    startedRef.current = true;

    const tick = window.setInterval(() => setSeconds((s) => s + 0.25), 250);

    printPlate({
      file,
      surface: choice.surface,
      location: choice.location,
      quality: choice.quality,
      onProgress: (update) => {
        setProgress(update);
        setLog((lines) => {
          const line = update.step ? `${update.stage} · step ${update.step}/${update.steps}` : update.stage;
          return lines.at(-1) === line ? lines : [...lines.slice(-5), line];
        });
      },
    })
      .then((printed) => {
        setResult(printed.dataUrl);
        setIdentity(printed.identity);
        onPrinted({ kind: "photo", objectUrl: printed.dataUrl, name: "printed plate" }, {
          seed: printed.seed,
          register: printed.register,
          location: printed.location,
          seconds: printed.seconds,
        });
      })
      .catch((failure: unknown) => {
        setError(failure instanceof PrintDeskOffline ? "offline" : failure instanceof Error ? failure.message : "unknown error");
      })
      .finally(() => window.clearInterval(tick));

    return () => window.clearInterval(tick);
  }, [file, onPrinted]);

  const percent = Math.round(progress.percent * 100);

  return (
    <section className="panel rule border p-8" data-testid="print-desk">
      <header className="rule mb-6 flex flex-wrap items-end justify-between gap-4 border-b pb-4">
        <div>
          <p className="kicker">Step 1b · Print desk</p>
          <h2 className="display mt-3 text-4xl">
            {error ? "The desk stopped" : result ? "Plate ready" : "Printing your plate"}
          </h2>
          <p className="mt-2 font-mono text-[11px] text-[color:var(--color-faint)]">
            {choice.surface}
            {choice.location ? ` · ${choice.location}` : " · rotating location"}
            {choice.quality ? " · quality print (26 steps · 1280px)" : " · fast print (4 steps)"}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm text-[color:var(--color-gold)]">{seconds.toFixed(1)}s</p>
          {identity ? (
            <p className="mt-1 font-mono text-[11px] text-[color:var(--color-muted)]" data-testid="print-identity">
              face {identity.similarity.toFixed(2)} · {identity.verdict}
            </p>
          ) : null}
        </div>
      </header>

      <div className="grid gap-8 md:grid-cols-[minmax(240px,320px)_1fr]">
        <figure className="rule relative overflow-hidden border">
          <img src={result ?? preview} alt="Your photo" className="block w-full" />
          {!result && !error ? (
            <div className="pointer-events-none absolute inset-0">
              <div className="print-sweep absolute inset-x-0 h-1/3 bg-gradient-to-b from-transparent via-[color:var(--color-gold)]/25 to-transparent" />
            </div>
          ) : null}
          <figcaption className="absolute right-0 bottom-0 left-0 bg-black/60 px-2 py-1 font-mono text-[11px] text-[color:var(--color-body)]">
            {result ? "the plate" : "your photo"}
          </figcaption>
        </figure>

        <div>
          <div className="flex items-baseline justify-between font-mono text-xs tracking-widest text-[color:var(--color-muted)] uppercase">
            <span>{STAGE_LABEL[progress.stage]}</span>
            <span data-testid="print-percent">{percent}%</span>
          </div>

          <div className="rule mt-2 h-2.5 w-full border bg-black/50">
            <div
              data-testid="print-bar"
              className="h-full bg-gradient-to-r from-[#ffd9a0] via-[color:var(--color-gold)] to-[#ff8ec4] transition-[width] duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>

          <ol className="mt-5 space-y-1 font-mono text-xs text-[color:var(--color-faint)]" data-testid="print-log">
            {log.map((line, index) => (
              <li key={`${line}-${index}`}>
                <span className="text-[color:var(--color-gold)]/60">{">"}</span> {line}
              </li>
            ))}
          </ol>

          {error ? (
            <div className="mt-6" data-testid="print-error">
              <p className="text-sm" style={{ color: "#ef6f6f" }}>
                {error === "offline"
                  ? "No print desk is running on this machine. Start ComfyUI (see docs/print-desk.md) and try again, or take one of the cast plates."
                  : `The desk reported: ${error}`}
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="lift rule border px-4 py-2 text-xs tracking-[0.2em] text-[color:var(--color-paper)] uppercase hover:text-[color:var(--color-gold)]"
                >
                  Try again
                </button>
                <button
                  type="button"
                  data-testid="use-cast-plate"
                  onClick={onUseCastPlate}
                  className="lift rule border px-4 py-2 text-xs tracking-[0.2em] text-[color:var(--color-muted)] uppercase hover:text-[color:var(--color-gold)]"
                >
                  Use a cast plate instead
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-6 text-xs leading-relaxed text-[color:var(--color-faint)]">
              The desk runs on this machine — your photo goes to the local model on port 8188 and
              nowhere else. No account, no quota, no key.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
