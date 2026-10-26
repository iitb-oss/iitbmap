import type {
  ExpressionSpecification,
  FillExtrusionLayerSpecification,
  FillLayerSpecification,
  LayerSpecification,
  LineLayerSpecification,
  Map as MaplibreMap,
  StyleSpecification,
} from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { CAMPUS_BBOX, MAP_BG, MAP_BG_DARK, MAX_ZOOM, MIN_ZOOM } from "./geo";
import {
  BUILDING_KINDS, BUILDING_LABEL_FILTER, BUILDING_LABEL_LAYER_ID, buildingLabelLayer, BUILDINGS_SOURCE_ID, IITB_BUILDINGS,
  PINNED_LABEL_LAYER_ID, pinnedLabels, PINS_SOURCE_ID,
} from "./buildings";
import { DEFAULT_GLYPHS_URL, DEFAULT_TILE_URL } from "./config";
import { FOOD_SOURCE_ID, foodLayers, IITB_FOOD } from "./food";
import boundary from "./iitb-boundary.json";

export const CAMPUS_SOURCE_ID = "campus";
export const BOUNDARY_SOURCE_ID = "boundary";
export const BOUNDARY_LAYER_ID = "campus-boundary";
/** The campus outline (OSM relation 8546708). */
export const IITB_BOUNDARY = boundary as FeatureCollection;

export const ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Campus layer colors; also used by link previews. */
export const PALETTE = {
  light: {
    green: "#c7dcb4", parking: "#d5dccf", water: "#a9cfe0", line: "#ffffff", path: "#a39e90",
    building: "#b9b3a6", academic: "#c98a5e", hostel: "#7d8fbf", residence: "#c9c2b2", boundary: "#1d5fd6",
  },
  dark: {
    green: "#263a29", parking: "#2a332c", water: "#1d3b4c", line: "#3a443c", path: "#5c655c",
    building: "#45433d", academic: "#b07450", hostel: "#5e6fa0", residence: "#4a4a42", boundary: "#f2c94c",
  },
} as const;

export { BUILDING_KINDS, buildingKind, type BuildingKind } from "./buildings";

export const PATHS = ["footway", "path", "steps", "track", "cycleway", "pedestrian"];

/** Relative street width by OSM highway tag; also used by link previews. */
export const STREET_WEIGHTS: Record<string, number> = {
  motorway: 5, trunk: 5, primary: 4.5, secondary: 4, tertiary: 3.5, cycleway: 3.5,
  residential: 3, service: 2, unclassified: 2, pedestrian: 2, footway: 1,
};
export const DEFAULT_STREET_WEIGHT = 1.5;
export const BUILDING_OPACITY = 0.95;

// MapLibre's tuple type can't express a spread of label/value pairs, hence the unknown cast.
const STREET_WEIGHT = [
  "match", ["get", "highway"],
  ...Object.entries(STREET_WEIGHTS).flat(),
  DEFAULT_STREET_WEIGHT,
] as unknown as ExpressionSpecification;

const WATERWAY_WEIGHT: ExpressionSpecification = [
  "match", ["get", "waterway"],
  "river", 20, "stream", 10,
  10,
];

const zoomWidth = (weight: ExpressionSpecification, baseAtMinZoom: number): ExpressionSpecification => [
  "interpolate", ["linear"], ["zoom"],
  MIN_ZOOM, ["*", baseAtMinZoom, weight],
  MAX_ZOOM, ["*", baseAtMinZoom * 4, weight],
];

function buildingColor(c: Record<"hostel" | "academic" | "residence" | "building", string>): ExpressionSpecification {
  return [
    "match", ["get", "building"],
    [...BUILDING_KINDS.hostel], c.hostel,
    [...BUILDING_KINDS.academic], c.academic,
    [...BUILDING_KINDS.residence], c.residence,
    c.building,
  ];
}

export function campusLayers(dark = false): (FillLayerSpecification | LineLayerSpecification)[] {
  const c = dark ? PALETTE.dark : PALETTE.light;
  return [
    {
      id: "campus-green", type: "fill", source: CAMPUS_SOURCE_ID, "source-layer": "green",
      paint: { "fill-color": c.green, "fill-outline-color": c.line },
    },
    {
      id: "campus-parking", type: "fill", source: CAMPUS_SOURCE_ID, "source-layer": "parking",
      paint: { "fill-color": c.parking, "fill-outline-color": c.line },
    },
    {
      id: "campus-streets", type: "line", source: CAMPUS_SOURCE_ID, "source-layer": "streets",
      filter: ["!", ["in", ["get", "highway"], ["literal", PATHS]]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.line, "line-width": zoomWidth(STREET_WEIGHT, 0.45) },
    },
    {
      id: "campus-paths", type: "line", source: CAMPUS_SOURCE_ID, "source-layer": "streets",
      filter: ["in", ["get", "highway"], ["literal", PATHS]],
      paint: { "line-color": c.path, "line-width": zoomWidth(STREET_WEIGHT, 0.3), "line-dasharray": [2, 2] },
    },
    {
      id: "campus-building", type: "fill", source: CAMPUS_SOURCE_ID, "source-layer": "building",
      paint: {
        // tiles reach off campus; addedBuildingsLayer paints campus academic orange
        "fill-color": buildingColor({ ...c, academic: c.building }),
        "fill-outline-color": c.line,
        "fill-opacity": BUILDING_OPACITY,
      },
    },
    {
      id: "campus-water", type: "fill", source: CAMPUS_SOURCE_ID, "source-layer": "water",
      paint: { "fill-color": c.water, "fill-outline-color": c.line },
    },
    {
      id: "campus-waterway", type: "line", source: CAMPUS_SOURCE_ID, "source-layer": "waterway",
      paint: { "line-color": c.water, "line-width": zoomWidth(WATERWAY_WEIGHT, 0.15) },
    },
  ];
}

/** Campus outline: blue on the light theme, yellow on the dark one. */
export function boundaryLayer(dark = false): LineLayerSpecification {
  const c = dark ? PALETTE.dark : PALETTE.light;
  return {
    id: BOUNDARY_LAYER_ID, type: "line", source: BOUNDARY_SOURCE_ID,
    layout: { "line-join": "round" },
    paint: {
      "line-color": c.boundary,
      "line-width": ["interpolate", ["linear"], ["zoom"], MIN_ZOOM, 1.5, MAX_ZOOM, 4],
      "line-opacity": 0.85,
    },
  };
}

export const ADDED_BUILDINGS_LAYER_ID = "buildings-added";

/** Campus academic buildings, plus buildings the tiles lack (IITB_EDITS) or miscolor (recolor). */
export function addedBuildingsLayer(dark = false): FillLayerSpecification {
  const c = dark ? PALETTE.dark : PALETTE.light;
  return {
    id: ADDED_BUILDINGS_LAYER_ID, type: "fill", source: BUILDINGS_SOURCE_ID,
    // areas (grounds) get a label only
    filter: [
      "all",
      ["!", ["has", "area"]],
      ["any", ["has", "added"], ["has", "recolor"], ["in", ["get", "building"], ["literal", BUILDING_KINDS.academic]]],
    ],
    paint: { "fill-color": buildingColor(c), "fill-outline-color": c.line, "fill-opacity": BUILDING_OPACITY },
  };
}

export const BUILDINGS_3D_LAYER_ID = "buildings-3d";
/** One storey, in metres. */
export const STOREY_M = 3.2;

const BUILDINGS_3D_FILTER: ExpressionSpecification = ["has", "levels"];

/** Named buildings with a known storey count, extruded; hidden until setBuildings3d. */
export function buildings3dLayer(dark = false): FillExtrusionLayerSpecification {
  const c = dark ? PALETTE.dark : PALETTE.light;
  return {
    id: BUILDINGS_3D_LAYER_ID, type: "fill-extrusion", source: BUILDINGS_SOURCE_ID,
    filter: BUILDINGS_3D_FILTER,
    layout: { visibility: "none" },
    paint: {
      "fill-extrusion-color": buildingColor(c),
      // ponytail: a "3+ storeys" minimum is drawn at 3; the housing listings give no more
      "fill-extrusion-height": ["*", ["get", "levels"], STOREY_M],
      "fill-extrusion-opacity": 0.9,
    },
  };
}

/** Visibility only; the caller tilts the camera, so a style reload leaves it alone. */
export function setBuildings3d(map: MaplibreMap, on: boolean): void {
  if (map.getLayer(BUILDINGS_3D_LAYER_ID)) map.setLayoutProperty(BUILDINGS_3D_LAYER_ID, "visibility", on ? "visible" : "none");
}

/** Label and extrude only these building names; null shows all. */
export function filterBuildings(map: MaplibreMap, names: string[] | null): void {
  const only: ExpressionSpecification | null = names && ["in", ["get", "name"], ["literal", names]];
  for (const [id, base] of [
    [BUILDING_LABEL_LAYER_ID, BUILDING_LABEL_FILTER],
    [PINNED_LABEL_LAYER_ID, BUILDING_LABEL_FILTER],
    [BUILDINGS_3D_LAYER_ID, BUILDINGS_3D_FILTER],
  ] as const) {
    if (map.getLayer(id)) map.setFilter(id, only ? ["all", base, only] : base);
  }
}

function resolveUrl(name: string, passed: string | undefined, fallback: string): string {
  const url = passed ?? fallback;
  if (!url) {
    throw new Error(
      `iitbmap: no ${name} configured. Pass it explicitly to getCampusStyle()/mergeCampusLayers() ` +
        `(the package's default is unset until the R2-hosted copy is live, see the README).`,
    );
  }
  return url;
}

export interface CampusStyleOptions {
  dark?: boolean;
  tileUrl?: string;
  glyphsUrl?: string;
}

/** Every layer of the full style, bottom to top; setCampusTheme re-paints this list. */
function themedLayers(dark: boolean): LayerSpecification[] {
  return [
    { id: "bg", type: "background", paint: { "background-color": dark ? MAP_BG_DARK : MAP_BG } },
    ...campusLayers(dark),
    addedBuildingsLayer(dark),
    boundaryLayer(dark),
    buildings3dLayer(dark),
    buildingLabelLayer({ dark }),
    // above unpinned labels, so a pinned label wins collisions
    buildingLabelLayer({ dark, pinned: true }),
    // above building labels, so food names win label collisions
    ...foodLayers({ dark }),
  ];
}

export function getCampusStyle(opts: CampusStyleOptions = {}): StyleSpecification {
  const dark = opts.dark ?? false;
  return {
    version: 8,
    glyphs: resolveUrl("glyphsUrl", opts.glyphsUrl, DEFAULT_GLYPHS_URL),
    sources: {
      [CAMPUS_SOURCE_ID]: {
        type: "vector",
        tiles: [resolveUrl("tileUrl", opts.tileUrl, DEFAULT_TILE_URL)],
        minzoom: MIN_ZOOM,
        maxzoom: MAX_ZOOM,
        bounds: [CAMPUS_BBOX.lngMin, CAMPUS_BBOX.latMin, CAMPUS_BBOX.lngMax, CAMPUS_BBOX.latMax],
        attribution: ATTRIBUTION,
      },
      [BUILDINGS_SOURCE_ID]: { type: "geojson", data: IITB_BUILDINGS },
      [BOUNDARY_SOURCE_ID]: { type: "geojson", data: IITB_BOUNDARY },
      [PINS_SOURCE_ID]: { type: "geojson", data: pinnedLabels() },
      [FOOD_SOURCE_ID]: { type: "geojson", data: IITB_FOOD },
    },
    layers: themedLayers(dark),
  };
}

export interface MergeCampusLayersOptions {
  dark?: boolean;
  sourceId?: string;
  beforeId?: string;
  tileUrl?: string;
  glyphsUrl?: string;
}

export function mergeCampusLayers(style: StyleSpecification, opts: MergeCampusLayersOptions = {}): StyleSpecification {
  const sourceId = opts.sourceId ?? CAMPUS_SOURCE_ID;
  if (style.sources[sourceId]) {
    throw new Error(`iitbmap: mergeCampusLayers: style already has a source named "${sourceId}"`);
  }
  const layers = campusLayers(opts.dark ?? false).map((layer) =>
    sourceId === CAMPUS_SOURCE_ID ? layer : { ...layer, source: sourceId },
  );
  const insertAt = opts.beforeId ? style.layers.findIndex((l) => l.id === opts.beforeId) : -1;
  const newLayers =
    insertAt === -1
      ? [...style.layers, ...layers]
      : [...style.layers.slice(0, insertAt), ...layers, ...style.layers.slice(insertAt)];
  return {
    ...style,
    sources: {
      ...style.sources,
      [sourceId]: {
        type: "vector",
        tiles: [resolveUrl("tileUrl", opts.tileUrl, DEFAULT_TILE_URL)],
        minzoom: MIN_ZOOM,
        maxzoom: MAX_ZOOM,
        attribution: ATTRIBUTION,
      },
    },
    layers: newLayers,
  };
}

export function setCampusTheme(map: MaplibreMap, dark: boolean): void {
  for (const layer of themedLayers(dark)) {
    if (!map.getLayer(layer.id) || !("paint" in layer)) continue;
    for (const [prop, value] of Object.entries(layer.paint ?? {})) map.setPaintProperty(layer.id, prop, value);
  }
}
