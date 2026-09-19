import { useEffect, useMemo, useRef, useState } from "react";
import { PrintDeskOffline, printPlate, type PrintProgress } from "../lib/printdesk/client";
import type { PlateSource } from "../lib/plates/plates";

/**
 * The printing screen. The bar is driven by the desk's own execution events (see
 * src/lib/printdesk/client.ts), so it means something: it advances on real sampler steps and
 * stalls when the model stalls. No fake timers.
 */

interface PrintDeskProps {
  file: File;
  onPrinted: (plate: PlateSource, meta: { seed: number; register: string; seconds: number }) => void;
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

export function PrintDesk({ file, onPrinted, onUseCastPlate }: PrintDeskProps) {
  const [progress, setProgress] = useState<PrintProgress>({ stage: "preparing", percent: 0, message: "warming the desk" });
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
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
      surface: "debut",
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
        onPrinted({ kind: "photo", objectUrl: printed.dataUrl, name: "printed plate" }, {
          seed: printed.seed,
          register: printed.register,
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
    <section className="border border-paper/20 bg-rosa/10 p-8" data-testid="print-desk">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs tracking-[0.35em] text-paper/50 uppercase">Print desk</p>
          <h2 className="font-display text-4xl leading-tight">
            {error ? "The desk stopped" : result ? "Plate ready" : "Printing your plate"}
          </h2>
        </div>
        <p className="font-mono text-sm text-paper/60">{seconds.toFixed(1)}s</p>
      </header>

      <div className="grid gap-8 md:grid-cols-[minmax(240px,320px)_1fr]">
        <figure className="relative overflow-hidden border border-paper/25">
          <img src={result ?? preview} alt="Your photo" className="block w-full" />
          {!result && !error ? (
            <div className="pointer-events-none absolute inset-0">
              <div className="print-sweep absolute inset-x-0 h-1/3 bg-gradient-to-b from-transparent via-fuchsia-400/30 to-transparent" />
            </div>
          ) : null}
          <figcaption className="absolute bottom-0 left-0 right-0 bg-black/55 px-2 py-1 font-mono text-[11px] text-paper/80">
            {result ? "the plate" : "your photo"}
          </figcaption>
        </figure>

        <div>
          <div className="flex items-baseline justify-between font-mono text-xs uppercase tracking-widest text-paper/60">
            <span>{STAGE_LABEL[progress.stage]}</span>
            <span data-testid="print-percent">{percent}%</span>
          </div>

          <div className="mt-2 h-2.5 w-full border border-paper/25 bg-black/40">
            <div
              data-testid="print-bar"
              className="h-full bg-gradient-to-r from-fuchsia-500 via-rose-400 to-cyan-300 transition-[width] duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>

          <ol className="mt-5 space-y-1 font-mono text-xs text-paper/55" data-testid="print-log">
            {log.map((line, index) => (
              <li key={`${line}-${index}`}>
                <span className="text-paper/35">{">"}</span> {line}
              </li>
            ))}
          </ol>

          {error ? (
            <div className="mt-6" data-testid="print-error">
              <p className="text-sm text-red-300">
                {error === "offline"
                  ? "No print desk is running on this machine. Start ComfyUI (see docs/print-desk.md) and try again, or take one of the cast plates."
                  : `The desk reported: ${error}`}
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="border border-paper/40 px-4 py-2 text-xs uppercase tracking-wide hover:bg-paper/10"
                >
                  Try again
                </button>
                <button
                  type="button"
                  data-testid="use-cast-plate"
                  onClick={onUseCastPlate}
                  className="border border-paper/25 px-4 py-2 text-xs uppercase tracking-wide hover:bg-paper/10"
                >
                  Use a cast plate instead
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-6 text-xs text-paper/45">
              The desk runs on this machine — your photo is sent to the local model on port 8188 and
              nowhere else. No account, no quota.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
