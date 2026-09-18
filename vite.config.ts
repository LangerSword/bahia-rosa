/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The image pipeline works at 1024px max edge; nothing here needs special headers.
  build: { target: "es2022", sourcemap: true },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
