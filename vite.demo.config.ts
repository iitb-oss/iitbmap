import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sharePages } from "./demo/share-pages";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Demo-only config; the package itself builds via tsup (see tsup.config.ts).
// root=demo lets App.tsx import "../../src/index" directly (no build step needed
// to test changes); publicDir=assets serves the committed fonts/ (and, if you
// copy/symlink one in locally, a tiles/ dir) at "/fonts/..." / "/tiles/...".
export default defineConfig({
  root: "demo",
  publicDir: "../assets",
  server: { port: 5183 },
  // ponytail: checked at server start; restart after symlinking tiles in
  define: { "import.meta.env.VITE_LOCAL_TILES": JSON.stringify(fs.existsSync(path.resolve(__dirname, "assets/tiles"))) },
  plugins: [react(), tailwindcss(), sharePages()],
  resolve: { alias: { "@": path.resolve(__dirname, "demo/src") } },
  build: {
    rollupOptions: {
      output: {
        // maplibre-gl is by far the largest dependency and changes far less often than
        // app code, so splitting it out lets browsers cache it separately across deploys.
        manualChunks: { "maplibre-gl": ["maplibre-gl"] },
      },
    },
  },
});
