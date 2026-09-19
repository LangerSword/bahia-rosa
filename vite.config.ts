/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const deskUrl = process.env.PRINT_DESK_URL ?? "http://127.0.0.1:8188";
const deskOrigin = new URL(deskUrl).origin;

/**
 * The print desk (ComfyUI) runs beside the app on 127.0.0.1:8188. ComfyUI refuses cross-origin
 * state-changing requests via its own origin check — a browser POST arrives with
 * `Origin: http://localhost:5178` and gets a 403, while the same request with no Origin header
 * succeeds. So the proxy presents the desk's own origin to it; the browser still only ever talks
 * to this dev server, and the websocket progress stream rides the same rule.
 */
const deskProxy = {
  target: deskUrl,
  changeOrigin: true,
  ws: true,
  rewrite: (path: string) => path.replace(/^\/print-desk/, ""),
  configure: (proxy: { on: (event: string, handler: (proxyReq: { setHeader: (name: string, value: string) => void }) => void) => void }) => {
    const withDeskOrigin = (proxyReq: { setHeader: (name: string, value: string) => void }) => {
      proxyReq.setHeader("origin", deskOrigin);
    };
    proxy.on("proxyReq", withDeskOrigin);
    proxy.on("proxyReqWs", withDeskOrigin);
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
    strictPort: true,
    proxy: { "/print-desk": deskProxy },
  },
  build: { target: "es2022", sourcemap: true },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
