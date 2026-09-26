import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

/**
 * A dev-only handle for the welcome screen's frame generator (`tools/make-film.mjs`).
 *
 * The film on the title sheet is built by driving *this app's own press* — the same `portraitFromImage` the
 * visitor's photograph goes through — so the frames are the real pipeline rather than a lookalike.
 *
 * Gated on MODE, not on DEV: this shell exports NODE_ENV=production, so Vite serves with `DEV: false` even
 * from the dev server, and a DEV guard silently never fires. MODE is "development" here and "production" in
 * every `npm run build`, so the handle exists exactly where the generator needs it and is dead-code
 * eliminated from the deployed bundle.
 */
if (import.meta.env.MODE === "development") {
  void Promise.all([
    import("./look/portrait"),
    import("./look/stylise"),
    import("./look/scenes"),
    import("./look/timeofday"),
  ]).then(([portrait, stylise, scenes, timeofday]) => {
    (window as unknown as { __press?: unknown }).__press = {
      ...portrait,
      ...stylise,
      ...scenes,
      ...timeofday,
    };
  });
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
