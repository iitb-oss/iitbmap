// OG images as SVG for the build and the Worker; keep Node and Worker APIs out.
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import type { Feature, Polygon, Position } from "geojson";
import { buildingCentroid, CAMPUS_BBOX, IITB_BUILDINGS, MAP_BG, type Route, type RoutingProfile } from "../../src/index";
import { DEFAULT_TILE_URL } from "../../src/config";
import { BUILDING_OPACITY, buildingKind, DEFAULT_STREET_WEIGHT, PALETTE, PATHS, STREET_WEIGHTS } from "../../src/style";
import { formatRouteInfo, MARKER_COLORS } from "../src/lib/places";

export const W = 1200;
export const H = 630;
const Z = 16; // highest-detail tile zoom
const WORLD = 256 * 2 ** Z;
const COLORS = { ...PALETTE.light, ...MARKER_COLORS };
const FONT = `font-family="Inter, Helvetica Neue, Helvetica, Arial, DejaVu Sans, sans-serif"`;

type Pt = [number, number];
/** Axis-aligned box in world pixels. */
interface Box { x0: number; y0: number; x1: number; y1: number }

const lngToX = (lng: number) => ((lng + 180) / 360) * WORLD;
const latToY = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD;
};
// geometry is z16 world pixels from the campus's top-left corner
const ORIGIN = { x: lngToX(CAMPUS_BBOX.lngMin), y: latToY(CAMPUS_BBOX.latMax) };
const project = ([lng, lat]: Position): Pt => [lngToX(lng) - ORIGIN.x, latToY(lat) - ORIGIN.y];

const boxOf = (pts: Pt[]): Box => ({
  x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])),
  x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])),
});
const ringsToPath = (rings: Pt[][], close: boolean) =>
  rings.map((r) => "M" + r.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L") + (close ? "Z" : "")).join("");
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface Basemap { fills: Record<string, string>; streets: { d: string; w: number; dashed: boolean }[]; waterways: string }

const emptyFills = () => ({ green: "", parking: "", building: "", academic: "", hostel: "", residence: "", water: "" });
const BUILDING_FILLS = ["building", "academic", "hostel", "residence"] as const;

// decoded tiles, cached per process or isolate
const tileCache = new Map<string, Promise<Basemap | null>>();

function loadTile(tx: number, ty: number, onMissing: (url: string) => void): Promise<Basemap | null> {
  const url = DEFAULT_TILE_URL.replace("{z}", String(Z)).replace("{x}", String(tx)).replace("{y}", String(ty));
  let tile = tileCache.get(url);
  if (!tile) {
    tile = (async () => {
      // a missing tile leaves a blank patch in the preview
      const res = await fetch(url).catch(() => null);
      if (!res?.ok) {
        onMissing(url);
        return null;
      }
      const decoded = new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())));
      const out: Basemap = { fills: emptyFills(), streets: [], waterways: "" };
      for (const [name, layer] of Object.entries(decoded.layers)) {
        const scale = 256 / layer.extent;
        for (let i = 0; i < layer.length; i++) {
          const f = layer.feature(i);
          const rings = f.loadGeometry().map((ring) => ring.map((p): Pt => [tx * 256 + p.x * scale - ORIGIN.x, ty * 256 + p.y * scale - ORIGIN.y]));
          const hw = String(f.properties.highway);
          if (name === "building") out.fills[tileKind(f.properties.building)] += ringsToPath(rings, true);
          else if (name in out.fills) out.fills[name] += ringsToPath(rings, true);
          else if (name === "streets") out.streets.push({
            d: ringsToPath(rings, false),
            w: STREET_WEIGHTS[hw] ?? DEFAULT_STREET_WEIGHT,
            dashed: PATHS.includes(hw),
          });
          else if (name === "waterway") out.waterways += ringsToPath(rings, false);
        }
      }
      return out;
    })();
    tileCache.set(url, tile);
  }
  return tile;
}

// tiles reach off campus; academic fills come from campus buildings only, as on the map
const tileKind = (tag: unknown) => {
  const kind = buildingKind(tag);
  return kind === "academic" ? "building" : kind;
};
let campusAcademic: { box: Box; d: string }[] | undefined;
const academicIn = (box: Box) => {
  campusAcademic ??= (IITB_BUILDINGS.features as Feature<Polygon>[])
    .filter((f) => f.geometry.type === "Polygon" && buildingKind(f.properties?.building) === "academic")
    .map((f) => {
      const rings = f.geometry.coordinates.map((r) => r.map(project));
      return { box: boxOf(rings[0]), d: ringsToPath(rings, true) };
    });
  return campusAcademic
    .filter((a) => a.box.x1 >= box.x0 && a.box.x0 <= box.x1 && a.box.y1 >= box.y0 && a.box.y0 <= box.y1)
    .map((a) => a.d)
    .join("");
};

export async function loadBasemap(box: Box, onMissing: (url: string) => void = () => {}): Promise<Basemap> {
  const t = (n: number) => Math.floor(n / 256);
  const jobs: Promise<Basemap | null>[] = [];
  for (let tx = t(box.x0 + ORIGIN.x); tx <= t(box.x1 + ORIGIN.x); tx++) {
    for (let ty = t(box.y0 + ORIGIN.y); ty <= t(box.y1 + ORIGIN.y); ty++) jobs.push(loadTile(tx, ty, onMissing));
  }
  const merged: Basemap = { fills: emptyFills(), streets: [], waterways: "" };
  for (const tile of await Promise.all(jobs)) {
    if (!tile) continue;
    for (const k of Object.keys(merged.fills)) merged.fills[k] += tile.fills[k];
    merged.streets.push(...tile.streets);
    merged.waterways += tile.waterways;
  }
  merged.fills.academic += academicIn(box);
  return merged;
}

function wrap(text: string, max: number, maxLines = 2): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (last && (last + " " + word).length <= max) lines[lines.length - 1] = last + " " + word;
    else lines.push(word);
  }
  return lines.length > maxLines ? [...lines.slice(0, maxLines - 1), lines.slice(maxLines - 1).join(" ").slice(0, max - 1) + "…"] : lines;
}
const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s);

/** World-pixel geometry plus card text. */
export interface Scene {
  lines: string[];
  fontSize: number;
  subtitle: string;
  focus: Box; // must be visible, above the card
  minSpan: number; // floor on view width so one building isn't zoomed to a blur
  highlight?: Pt[]; // building outline
  route?: Pt[];
  start?: Pt;
  pin?: Pt;
}

/** Card size and text baselines from the card's top; the subtitle's is last. */
function cardLayout(scene: Scene) {
  const baselines = scene.lines.map((_, i) => 28 + scene.fontSize * (1 + i * 1.15));
  baselines.push(baselines[baselines.length - 1] + 44);
  const cardH = baselines[baselines.length - 1] + 30;
  const widest = Math.max(...scene.lines.map((l) => l.length));
  const cardW = Math.min(W - 64, Math.max(widest * scene.fontSize * 0.58, scene.subtitle.length * 26 * 0.55) + 72);
  return { baselines, cardH, cardW };
}

export function sceneView(scene: Scene): { box: Box; k: number } {
  const { cardH } = cardLayout(scene);
  // Fit the focus (padded) into the area above the card.
  const TOP = 64; // room for the destination pin, which sticks up ~50px above its point
  const region = { w: W - 96, h: H - cardH - 32 - 24 - TOP };
  const fw = Math.max(scene.focus.x1 - scene.focus.x0, scene.minSpan);
  const fh = Math.max(scene.focus.y1 - scene.focus.y0, (scene.minSpan * region.h) / region.w);
  const k = Math.min(region.w / fw, region.h / fh); // output px per world px
  const cx = (scene.focus.x0 + scene.focus.x1) / 2, cy = (scene.focus.y0 + scene.focus.y1) / 2;
  // Focus centre lands at the centre of the region below TOP.
  const x0 = cx - W / 2 / k, y0 = cy - (TOP + region.h / 2) / k;
  return { box: { x0, y0, x1: x0 + W / k, y1: y0 + H / k }, k };
}

const pinSvg = ([x, y]: Pt, k: number, color: string) =>
  `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${1 / k})"><path d="M0 0 C-6 -14 -22 -24 -22 -42 A22 22 0 1 1 22 -42 C22 -24 6 -14 0 0Z" fill="${color}" stroke="#fff" stroke-width="3"/><circle cy="-42" r="8" fill="#fff"/></g>`;

export function sceneSvg(basemap: Basemap, scene: Scene): string {
  const { box, k } = sceneView(scene);
  const { baselines, cardH, cardW } = cardLayout(scene);
  const routePath = scene.route && ringsToPath([scene.route], false);
  const px = (n: number) => (n / k).toFixed(2); // output px -> world units
  const top = H - 32 - cardH;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${MAP_BG}"/>
<g transform="scale(${k}) translate(${(-box.x0).toFixed(2)} ${(-box.y0).toFixed(2)})">
  <path d="${basemap.fills.green}" fill="${COLORS.green}"/>
  <path d="${basemap.fills.parking}" fill="${COLORS.parking}"/>
  ${basemap.streets.map((s) => `<path d="${s.d}" fill="none" stroke="${s.dashed ? COLORS.path : COLORS.line}" stroke-linecap="round" stroke-width="${px(s.dashed ? s.w : s.w * 1.4)}"${s.dashed ? ` stroke-dasharray="${px(6)} ${px(6)}"` : ""}/>`).join("")}
  ${BUILDING_FILLS.map((k) => `<path d="${basemap.fills[k]}" fill="${COLORS[k]}" fill-opacity="${BUILDING_OPACITY}"/>`).join("")}
  <path d="${basemap.fills.water}" fill="${COLORS.water}"/>
  <path d="${basemap.waterways}" fill="none" stroke="${COLORS.water}" stroke-width="${px(3)}"/>
  ${scene.highlight ? `<path d="${ringsToPath([scene.highlight], true)}" fill="${COLORS.end}" stroke="#fff" stroke-width="${px(3)}" stroke-linejoin="round"/>` : ""}
  ${routePath ? `<path d="${routePath}" fill="none" stroke="#fff" stroke-width="${px(14)}" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${routePath}" fill="none" stroke="${COLORS.route}" stroke-width="${px(8)}" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
  ${scene.start ? `<circle cx="${scene.start[0].toFixed(1)}" cy="${scene.start[1].toFixed(1)}" r="${px(13)}" fill="${COLORS.start}" stroke="#fff" stroke-width="${px(4)}"/>` : ""}
  ${scene.pin ? pinSvg(scene.pin, k, COLORS.end) : ""}
</g>
<rect x="32" y="${top}" width="${cardW}" height="${cardH}" rx="20" fill="#fff" fill-opacity="0.95"/>
${scene.lines.map((l, i) => `<text x="68" y="${top + baselines[i]}" ${FONT} font-size="${scene.fontSize}" font-weight="700" fill="#1c1917">${esc(l)}</text>`).join("")}
<text x="68" y="${top + baselines[scene.lines.length]}" ${FONT} font-size="26" fill="#57534e">${esc(scene.subtitle)}</text>
</svg>`;
}

export function buildingScene(name: string, feature: Feature<Polygon>): Scene {
  const ring = feature.geometry.coordinates[0].map(project);
  const box = boxOf(ring);
  const lines = wrap(name, 30);
  return {
    lines,
    fontSize: lines.length > 1 || name.length > 22 ? 44 : 56,
    subtitle: "IIT Bombay campus map · directions",
    focus: box,
    minSpan: 240, // ~550 m
    highlight: ring,
    pin: project(buildingCentroid(feature)), // same point as the app marker and DIGIPIN
  };
}

export function routeScene(fromLabel: string, toLabel: string, route: Route, profile: RoutingProfile, toFeature?: Feature<Polygon>): Scene {
  const line = route.coordinates.map(project);
  return {
    lines: [truncate(fromLabel, 34), `to ${truncate(toLabel, 31)}`], // bundled Inter subset has no arrow glyph
    fontSize: 40,
    subtitle: `${formatRouteInfo(route, profile, " · ")} · IIT Bombay`,
    focus: boxOf(line),
    minSpan: 160,
    highlight: toFeature?.geometry.coordinates[0].map(project),
    route: line,
    start: line[0],
    pin: line[line.length - 1],
  };
}
