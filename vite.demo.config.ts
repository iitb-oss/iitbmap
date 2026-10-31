import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sharePages } from "./demo/share-pages";
import { DEFAULT_TILE_URL } from "./src/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// map library and tile host start with the page, at low priority so the app script goes first
function loadHints(): Plugin {
  let base = "/";
  return {
    name: "load-hints",
    apply: "build",
    configResolved: (config) => void (base = config.base),
    transformIndexHtml: (_html, { bundle }) => {
      const chunk = Object.values(bundle ?? {}).find((c) => c.type === "chunk" && c.name === "maplibre-gl");
      if (!chunk) return [];
      return [
        { tag: "link", attrs: { rel: "preconnect", href: new URL(DEFAULT_TILE_URL).origin, crossorigin: true }, injectTo: "head" },
        { tag: "link", attrs: { rel: "modulepreload", crossorigin: true, fetchpriority: "low", href: base + chunk.fileName }, injectTo: "head" },
      ];
    },
  };
}

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
  plugins: [react(), tailwindcss(), loadHints(), sharePages()],
  resolve: { alias: { "@": path.resolve(__dirname, "demo/src") } },
  // no manualChunks: it pulls rollup's shared helpers into maplibre-gl, which then loads before the panel
});
