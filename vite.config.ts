import { defineConfig } from "vite";

// The editor dialog UI. Built into dist/ui, which src/server.ts serves to Live.
export default defineConfig({
  root: "ui",
  base: "./",
  server: { port: 5173 },
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
  },
});
