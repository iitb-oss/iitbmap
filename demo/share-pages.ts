// Static share page and og.png per building and food place; link-preview crawlers don't run JS.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { renderAsync } from "@resvg/resvg-js";
import type { Feature, Polygon } from "geojson";
import { buildingCentroid } from "../src/index";
import { buildingScene, esc, loadBasemap, sceneSvg, sceneView } from "./og/render";
import { shareMetaTags } from "./og/meta";
import { buildingPath, buildingSlug, placeLink } from "./src/lib/building-url";
import { encodeDigipin } from "./src/lib/digipin";
import { findPlace, PLACE_NAMES, SITE_TITLE } from "./src/lib/places";
import { routeLink } from "./src/lib/route-url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FONT_FILES = ["inter-400.ttf", "inter-700.ttf"].map((f) => path.resolve(here, "og/fonts", f));
const META_BLOCK = /<!-- share-meta[^>]*-->[\s\S]*?<!-- \/share-meta -->/;
const ROOT = '<div id="root"></div>';

/** schema.org Place, for search engines */
function placeJsonLd(name: string, url: string, [lng, lat]: [number, number]): string {
  const ld = {
    "@context": "https://schema.org",
    "@type": "Place",
    name,
    url,
    geo: { "@type": "GeoCoordinates", latitude: +lat.toFixed(6), longitude: +lng.toFixed(6) },
    hasMap: url,
    containedInPlace: { "@type": "CollegeOrUniversity", name: "Indian Institute of Technology Bombay", sameAs: "https://www.iitb.ac.in/" },
  };
  return `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`;
}

async function renderPlace(dir: string, name: string, feature: Feature<Polygon>) {
  const scene = buildingScene(name, feature);
  const basemap = await loadBasemap(sceneView(scene).box, (url) => console.warn(`share-pages: skipped tile ${url}`));
  const image = await renderAsync(sceneSvg(basemap, scene), {
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: "Inter" },
  });
  fs.writeFileSync(path.join(dir, "og.png"), image.asPng());
}

/** llmstxt.org format */
function llmsTxt(siteUrl: string, places: string[]): string {
  // a renamed example would document a dead link
  const ex = { page: "Nandan Nilekani Main Building", from: "Hostel 1", to: "Lecture Hall", room: "LH 101" };
  for (const name of [ex.page, ex.from, ex.to]) if (!findPlace(name)) throw new Error(`share-pages: llms.txt example "${name}" is not a place`);
  const page = placeLink(siteUrl, ex.page).href;
  const route = routeLink(siteUrl, { from: ex.from, to: ex.to, profile: "walk", routeIndex: 0 }).href;
  return `# IIT Bombay Campus Map

> Interactive map of the IIT Bombay campus in Powai, Mumbai, India, with walking and driving directions between any two places. Covers academic buildings, hostels and their wings, residential quarters, classrooms and lab rooms by floor, and canteens, cafes and messes with opening hours. Free, open source and works offline. Main site: ${siteUrl}

## Linking to the map

- A place: ${page} (each place below has its own page with a map preview).
- Directions: \`from\`, \`to\` and \`profile=walk\` (or \`drive\`, which respects one-way roads), for example ${route}. A place is a name from the list below or a DIGIPIN on campus.
- A room in a building: add \`room=<room number>\`, for example ${placeLink(siteUrl, ex.to, ex.room).href}.
- How to reach IIT Bombay (airports, metro, train, bus, auto, fares): ${siteUrl}reach/, with a walking route from the Main Gate via \`?to=<place>\`.
- Embed the map in a page: \`<iframe src="${siteUrl}b/<slug>/?embed">\`.
- [Sitemap](${siteUrl}sitemap.xml)
- [Source code](https://github.com/iitb-oss/iitbmap)

## Places

Name, DIGIPIN (India Post), latitude, longitude.

${places.join("\n")}
`;
}

export function sharePages(): Plugin {
  let outDir = "";
  return {
    name: "iitbmap-share-pages",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const shell = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
      const reach = fs.readFileSync(path.join(outDir, "reach", "index.html"), "utf8");
      const gate = reach.match(/data-from="([^"]+)"/)?.[1] ?? "";
      if (!findPlace(gate) || !reach.includes(`../${buildingPath(gate)}`)) throw new Error(`share-pages: reach/index.html gate "${gate}" is not a place or its link is not ../${buildingPath(gate)}`);
      if (!META_BLOCK.test(shell)) throw new Error("share-pages: index.html has no <!-- share-meta --> block");
      if (!shell.includes(ROOT)) throw new Error(`share-pages: index.html has no ${ROOT}`);
      const siteUrl = shell.match(/<link rel="canonical" href="([^"]+)"/)![1];
      if (!reach.includes(`<link rel="canonical" href="${siteUrl}reach/" />`)) throw new Error(`share-pages: reach/index.html canonical is not ${siteUrl}reach/`);
      const reachUrl = `${siteUrl}reach/`;

      const jobs: (() => Promise<void>)[] = [];
      const seen = new Set<string>();
      const urls = [siteUrl, reachUrl];
      const places: string[] = [];
      for (const name of PLACE_NAMES) {
        const slug = buildingSlug(name);
        // first feature per slug wins, like the app's name lookup
        if (seen.has(slug)) continue;
        seen.add(slug);
        const feature = findPlace(name)!;
        const url = new URL(buildingPath(name), siteUrl).href;
        // same point the app routes to
        const centroid = buildingCentroid(feature);
        const digipin = encodeDigipin(centroid);
        const description = `${name} (DIGIPIN ${digipin}) on the IIT Bombay campus map, with walking and driving directions from anywhere on campus.`;
        const meta = shareMetaTags({
          title: `${name} | ${SITE_TITLE}`,
          description,
          url,
          canonical: url,
          image: `${url}og.png`,
          imageAlt: `Map of ${name}, IIT Bombay`,
          imageIsPreview: true,
        });

        const dir = path.join(outDir, buildingPath(name));
        fs.mkdirSync(dir, { recursive: true });
        // text for crawlers that skip JS; createRoot replaces it on load
        const body = ROOT.replace("></", `><h1>${esc(name)}, IIT Bombay</h1><p>${esc(description)}</p><p><a href="${reachUrl}">How to reach IIT Bombay</a></p></`);
        const html = shell.replace(META_BLOCK, `${meta}\n  ${placeJsonLd(name, url, centroid)}`).replace(ROOT, body);
        fs.writeFileSync(path.join(dir, "index.html"), html);
        urls.push(url);
        places.push(`- [${name}](${url}): DIGIPIN ${digipin}, ${centroid[1].toFixed(6)}, ${centroid[0].toFixed(6)}`);
        jobs.push(() => renderPlace(dir, name, feature));
      }

      // resvg-js renders off-thread; one job per core
      const queue = jobs.values();
      const worker = async () => {
        for (const job of queue) await job();
      };
      await Promise.all(Array.from({ length: os.availableParallelism() }, worker));
      const sitemap = urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join("\n");
      fs.writeFileSync(path.join(outDir, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap}\n</urlset>\n`);
      fs.writeFileSync(path.join(outDir, "llms.txt"), llmsTxt(siteUrl, places));
      // ponytail: crawlers read robots.txt only at a host root
      fs.writeFileSync(path.join(outDir, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}sitemap.xml\n`);
      console.log(`share-pages: wrote ${seen.size} place pages, sitemap.xml, llms.txt and robots.txt`);
    },
  };
}
