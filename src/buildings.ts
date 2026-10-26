import type { ExpressionSpecification, Map as MaplibreMap, SymbolLayerSpecification } from "maplibre-gl";
import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import buildings from "./iitb-buildings.json";
import { MAP_BG, MAP_BG_DARK, MIN_ZOOM } from "./geo";
import { applyFoodEdits, FOOD_NAMES, IITB_EDITS, IITB_FOOD, type MapEdits } from "./food";

export const IITB_BUILDINGS = buildings as FeatureCollection;

/** OSM building values per color group; anything else is "building". */
export const BUILDING_KINDS = {
  hostel: ["dormitory"],
  academic: ["university", "college", "school", "civic", "hospital"],
  residence: ["apartments", "residential", "bungalow", "house"],
} as const;

export type BuildingKind = keyof typeof BUILDING_KINDS | "building";
export function buildingKind(tag: unknown): BuildingKind {
  for (const [kind, tags] of Object.entries(BUILDING_KINDS)) if ((tags as readonly unknown[]).includes(tag)) return kind as BuildingKind;
  return "building";
}

export { IITB_EDITS };

/** Idempotent; added buildings get an added prop, pinned ones a label prop. */
export function applyBuildingEdits(fc: FeatureCollection, e: MapEdits): void {
  fc.features = fc.features.filter((f) => !f.properties?.added);
  fc.features.push(...e.added.map((f) => ({ ...f, properties: { ...f.properties, added: true } })));
  for (const { properties: p } of fc.features) {
    if (!p) continue;
    const at = e.pins[p.name];
    if (at) p.label = at;
    else delete p.label;
  }
}
applyBuildingEdits(IITB_BUILDINGS, IITB_EDITS);

/** Applies edits to the bundled buildings and food places in place. */
export function applyMapEdits(e: MapEdits): void {
  applyBuildingEdits(IITB_BUILDINGS, e);
  applyFoodEdits(IITB_FOOD, e);
}

/** One point per pinned building name, for the pinned label layer. */
export function pinnedLabels(fc: FeatureCollection = IITB_BUILDINGS): FeatureCollection<Point> {
  const byName = new Map<string, Feature<Point>>();
  for (const { properties: p } of fc.features) {
    if (!p?.label) continue;
    const props = { name: p.name, ...(p.storeys && { storeys: p.storeys }), ...(p.short && { short: p.short }) };
    byName.set(p.name, { type: "Feature", properties: props, geometry: { type: "Point", coordinates: p.label } });
  }
  return { type: "FeatureCollection", features: [...byName.values()] };
}

/** From this zoom labels add the storey count as a smaller second line. */
export const STOREYS_MIN_ZOOM = 17;

/** Matches fetch-buildings.py storeys_label: floors above ground, so G+2 (3 levels) is "2 storeys". */
export function storeysLabel(levels: number): string {
  const above = levels - 1;
  return above ? `${above} storey${above === 1 ? "" : "s"}` : "Ground floor";
}

/** Building name -> storeys wording; a name on several polygons gets its tallest. */
export function storeysByName(): Map<string, string> {
  return new Map(
    IITB_BUILDINGS.features
      .filter((f) => f.properties?.storeys)
      .sort((a, b) => a.properties!.levels - b.properties!.levels)
      .map((f) => [f.properties!.name as string, f.properties!.storeys as string]),
  );
}

/** Building name -> built-up area over all floors (m²), from the master plan. */
export function builtUpByName(): Map<string, number> {
  return new Map(
    IITB_BUILDINGS.features.filter((f) => f.properties?.bua_m2).map((f) => [f.properties!.name as string, f.properties!.bua_m2 as number]),
  );
}

export const BUILDINGS_SOURCE_ID = "buildings";
export const BUILDING_LABEL_LAYER_ID = "building-label";
export const PINS_SOURCE_ID = "building-pins";
export const PINNED_LABEL_LAYER_ID = "building-label-pinned";

// Ink on a land-colored halo, so labels read over buildings and lawns alike.
const LABEL_COLOR = { light: "#1d2620", dark: "#e3e9e0" } as const;
const LABEL_HALO = { light: MAP_BG, dark: MAP_BG_DARK } as const;

// canteen buildings are labelled by the food layer, pinned ones by the pinned layer
export const BUILDING_LABEL_FILTER: ExpressionSpecification = [
  "all", ["!", ["in", ["get", "name"], ["literal", FOOD_NAMES]]], ["!", ["has", "label"]],
];

/** Takes glyphs from the style's glyph URL. pinned labels the pinnedLabels() points. */
export function buildingLabelLayer(opts: { dark?: boolean; pinned?: boolean } = {}): SymbolLayerSpecification {
  const theme = opts.dark ? "dark" : "light";
  return {
    id: opts.pinned ? PINNED_LABEL_LAYER_ID : BUILDING_LABEL_LAYER_ID,
    type: "symbol",
    source: opts.pinned ? PINS_SOURCE_ID : BUILDINGS_SOURCE_ID,
    minzoom: MIN_ZOOM,
    filter: BUILDING_LABEL_FILTER,
    layout: {
      "text-field": [
        "step", ["zoom"], ["coalesce", ["get", "short"], ["get", "name"]],
        STOREYS_MIN_ZOOM, ["case", ["has", "storeys"],
          ["format", ["get", "name"], {}, "\n", {}, ["get", "storeys"], { "font-scale": 0.8 }],
          ["get", "name"]],
      ],
      "text-font": ["Inter Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], MIN_ZOOM, 11, 18, 16],
      "text-max-width": 8,
      "symbol-avoid-edges": true,
      // housing blocks yield to everything else
      "symbol-sort-key": ["match", ["get", "building"], [...BUILDING_KINDS.residence], 1, 0],
      // a label blocked on the centroid moves above or below the building
      "text-variable-anchor": ["center", "top", "bottom"],
      "text-radial-offset": 0.6,
      // a hand-placed label always shows; unpinned labels still make way for it
      ...(opts.pinned && { "text-allow-overlap": true }),
    },
    paint: {
      "text-color": LABEL_COLOR[theme],
      "text-halo-color": LABEL_HALO[theme],
      "text-halo-width": 1.4,
      "text-halo-blur": 0.2,
    },
  };
}

export function setBuildingLabelsVisible(map: MaplibreMap, visible: boolean): void {
  for (const id of [BUILDING_LABEL_LAYER_ID, PINNED_LABEL_LAYER_ID]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
}

export function buildingCentroid(feature: Feature<Polygon>): [number, number] {
  const ring = feature.geometry.coordinates[0];
  // raw lng*lat products cancel to noise on small polygons
  const [ox, oy] = ring[0];
  let x = 0;
  let y = 0;
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x0 = ring[i][0] - ox, y0 = ring[i][1] - oy;
    const x1 = ring[i + 1][0] - ox, y1 = ring[i + 1][1] - oy;
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  }
  area /= 2;
  if (area === 0) return [ox, oy];
  return [ox + x / (6 * area), oy + y / (6 * area)];
}
