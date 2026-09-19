/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
    strictPort: true,
    // The print desk (ComfyUI) runs beside the app; proxying keeps the browser same-origin,
    // which avoids CORS entirely and works for the websocket progress stream too.
    proxy: {
      "/print-desk": {
        target: process.env.PRINT_DESK_URL ?? "http://127.0.0.1:8188",
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/print-desk/, ""),
      },
    },
  },
  // The image pipeline works at 1024px max edge; nothing here needs special headers.
  build: { target: "es2022", sourcemap: true },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
