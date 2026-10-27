import type {
  ExpressionSpecification,
  FillExtrusionLayerSpecification,
  FillLayerSpecification,
  GeoJSONSource,
  LayerSpecification,
  LineLayerSpecification,
  Map as MaplibreMap,
  StyleSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { CAMPUS_BBOX, MAP_BG, MAP_BG_DARK, MAX_ZOOM, MIN_ZOOM, STOREY_M } from "./geo";
import {
  BUILDING_KINDS, BUILDING_LABEL_FILTER, BUILDING_LABEL_LAYER_ID, buildingLabelLayer, BUILDINGS_SOURCE_ID, IITB_BUILDINGS,
  PINNED_LABEL_LAYER_ID, pinnedLabels, PINS_SOURCE_ID,
} from "./buildings";
import { DEFAULT_GLYPHS_URL, DEFAULT_TILE_URL } from "./config";
import { FOOD_SOURCE_ID, foodLayers, IITB_FOOD } from "./food";
import boundary from "./iitb-boundary.json";
import { landmarkParts, LANDMARKS_SOURCE_ID } from "./landmarks";
import pipeline from "./iitb-pipeline.json";
import roads from "./iitb-roads.json";
import sports from "./iitb-sports.json";

export const CAMPUS_SOURCE_ID = "campus";
export const BOUNDARY_SOURCE_ID = "boundary";
export const BOUNDARY_LAYER_ID = "campus-boundary";
/** The campus outline (OSM relation 8546708). */
export const IITB_BOUNDARY = boundary as FeatureCollection;
export const PIPELINE_SOURCE_ID = "pipeline";
export const PIPELINE_LAYER_ID = "pipeline";
/** The Tansa water mains along the north edge (OSM man_made=pipeline, scripts/fetch-pipeline.py). */
export const IITB_PIPELINE = pipeline as FeatureCollection;
export const ROADS_SOURCE_ID = "roads";
export const ROAD_WIDTH_LAYER_ID = "road-width";
/** OSM roads with their master plan width (width_m) and length (length_m); scripts/masterplan.py. */
export const IITB_ROADS = roads as FeatureCollection;
export const SPORTS_SOURCE_ID = "sports";
/** Pitches, pools, court markings and the running track's lanes (scripts/fetch-sports.py). */
export const IITB_SPORTS = sports as FeatureCollection;
/** From this zoom court markings, lanes and names show. */
export const SPORTS_DETAIL_MIN_ZOOM = 15.5;
/** From this zoom roads with a known width are labelled "12 m wide". */
export const ROAD_WIDTH_MIN_ZOOM = 16;

export const ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Campus layer colors; also used by link previews. */
export const PALETTE = {
  light: {
    green: "#c7dcb4", parking: "#d5dccf", water: "#a9cfe0", line: "#ffffff", path: "#a39e90",
    building: "#b9b3a6", academic: "#c98a5e", hostel: "#7d8fbf", residence: "#c9c2b2", boundary: "#1d5fd6",
    pipeline: "#3b9be8",
    // landmark roofs, paler than their walls as on the 2014 illustrated campus map
    buildingRoof: "#d3cec4", academicRoof: "#ddb08f", hostelRoof: "#a3b1d6", residenceRoof: "#ddd8cc", saffron: "#ee8a1e",
    court: "#9fb393", courtHard: "#a88a80", pool: "#9cc8d6", poolRim: "#ebe8df", lane: "#fbfaf4",
  },
  dark: {
    green: "#263a29", parking: "#2a332c", water: "#1d3b4c", line: "#3a443c", path: "#5c655c",
    building: "#45433d", academic: "#b07450", hostel: "#5e6fa0", residence: "#4a4a42", boundary: "#f2c94c",
    pipeline: "#4fa8f0",
    buildingRoof: "#5a5850", academicRoof: "#c48e6c", hostelRoof: "#7686b4", residenceRoof: "#5e5e55", saffron: "#d97a14",
    court: "#2f4a33", courtHard: "#4d3b36", pool: "#24506a", poolRim: "#5a645c", lane: "#9aa59b",
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

/** One value per building kind, matched on the OSM building tag like buildingKind. */
function byKind(v: Record<"hostel" | "academic" | "residence" | "building", string>): ExpressionSpecification {
  return [
    "match", ["get", "building"],
    [...BUILDING_KINDS.hostel], v.hostel,
    [...BUILDING_KINDS.academic], v.academic,
    [...BUILDING_KINDS.residence], v.residence,
    v.building,
  ];
}

const KIND_NAMES = { hostel: "hostel", academic: "academic", residence: "residence", building: "building" };

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
        "fill-color": byKind({ ...c, academic: c.building }),
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

const HARD_COURTS = ["basketball", "volleyball", "multi"];

/** Pitches (hard courts reddish, the rest grass) and pools, with white markings and lanes as drawn on the 2014 map. */
export function sportsLayers(dark = false): (FillLayerSpecification | LineLayerSpecification | SymbolLayerSpecification)[] {
  const c = dark ? PALETTE.dark : PALETTE.light;
  const lineWidth: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], SPORTS_DETAIL_MIN_ZOOM, 0.6, MAX_ZOOM, 2.4];
  const surface: ExpressionSpecification = [
    "case",
    ["==", ["get", "kind"], "pool"], c.pool,
    ["in", ["get", "sport"], ["literal", HARD_COURTS]], c.courtHard,
    c.court,
  ];
  return [
    {
      id: "sports-surface", type: "fill", source: SPORTS_SOURCE_ID, filter: ["in", ["get", "kind"], ["literal", ["pitch", "pool"]]],
      paint: { "fill-color": surface },
    },
    {
      id: "sports-pool-rim", type: "line", source: SPORTS_SOURCE_ID, filter: ["==", ["get", "kind"], "pool"],
      paint: { "line-color": c.poolRim, "line-width": ["interpolate", ["linear"], ["zoom"], MIN_ZOOM, 0.5, MAX_ZOOM, 4] },
    },
    {
      id: "sports-lines", type: "line", source: SPORTS_SOURCE_ID, minzoom: SPORTS_DETAIL_MIN_ZOOM,
      filter: ["in", ["get", "kind"], ["literal", ["markings", "lanes"]]],
      layout: { "line-join": "round" },
      paint: { "line-color": c.lane, "line-width": lineWidth },
    },
    {
      id: "sports-label", type: "symbol", source: SPORTS_SOURCE_ID, minzoom: SPORTS_DETAIL_MIN_ZOOM,
      // only pitches and pools carry names
      filter: ["has", "name"],
      layout: { "text-field": ["get", "name"], "text-font": ["Inter Regular"], "text-size": 11, "text-max-width": 8 },
      paint: {
        "text-color": c.lane,
        "text-halo-color": surface,
        "text-halo-width": 1.2,
      },
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

/** Water mains, blue on both themes. */
export function pipelineLayer(dark = false): LineLayerSpecification {
  const c = dark ? PALETTE.dark : PALETTE.light;
  return {
    id: PIPELINE_LAYER_ID, type: "line", source: PIPELINE_SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": c.pipeline, "line-width": ["interpolate", ["linear"], ["zoom"], MIN_ZOOM, 1.5, MAX_ZOOM, 6] },
  };
}

/** "12 m wide" along roads the master plan gives a width. */
export function roadWidthLayer(dark = false): SymbolLayerSpecification {
  const c = dark ? PALETTE.dark : PALETTE.light;
  return {
    id: ROAD_WIDTH_LAYER_ID, type: "symbol", source: ROADS_SOURCE_ID, minzoom: ROAD_WIDTH_MIN_ZOOM,
    layout: {
      "symbol-placement": "line",
      "text-field": ["concat", ["to-string", ["get", "width_m"]], " m wide"],
      "text-font": ["Inter Regular"],
      "text-size": 10,
    },
    paint: { "text-color": c.path, "text-halo-color": dark ? MAP_BG_DARK : MAP_BG, "text-halo-width": 1.4, "text-halo-blur": 0.2 },
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
    paint: { "fill-color": byKind(c), "fill-outline-color": c.line, "fill-opacity": BUILDING_OPACITY },
  };
}

export const BUILDINGS_3D_LAYER_ID = "buildings-3d";

// landmarkParts marks the buildings it draws
const BUILDINGS_3D_FILTER: ExpressionSpecification = ["all", ["has", "levels"], ["!", ["has", "landmark"]]];

/** Named buildings with a known storey count, extruded; hidden until setBuildings3d. */
const BUILDING_HEIGHT: ExpressionSpecification = ["*", ["get", "levels"], STOREY_M];

/** Named buildings with a known storey count, extruded with windowed walls as on the 2014 map; hidden until setBuildings3d. */
export function buildings3dLayer(dark = false): FillExtrusionLayerSpecification {
  return {
    id: BUILDINGS_3D_LAYER_ID, type: "fill-extrusion", source: BUILDINGS_SOURCE_ID,
    filter: BUILDINGS_3D_FILTER,
    layout: { visibility: "none" },
    paint: {
      // drawn by registerCampusImages, in the kind's colour
      "fill-extrusion-pattern": ["concat", "iitb-bands-", byKind(KIND_NAMES), dark ? "-dark" : "-light"],
      // ponytail: a "2+ storeys" minimum (3 levels) is drawn at 3; the housing listings give no more
      "fill-extrusion-height": BUILDING_HEIGHT,
      "fill-extrusion-opacity": 0.9,
    },
  };
}

export const BUILDINGS_3D_ROOF_LAYER_ID = "buildings-3d-roof";

/** A paler cap on buildings3dLayer. */
export function buildings3dRoofLayer(dark = false): FillExtrusionLayerSpecification {
  const c = dark ? PALETTE.dark : PALETTE.light;
  return {
    id: BUILDINGS_3D_ROOF_LAYER_ID, type: "fill-extrusion", source: BUILDINGS_SOURCE_ID,
    filter: BUILDINGS_3D_FILTER,
    layout: { visibility: "none" },
    paint: {
      "fill-extrusion-color": byKind({ hostel: c.hostelRoof, academic: c.academicRoof, residence: c.residenceRoof, building: c.buildingRoof }),
      "fill-extrusion-base": BUILDING_HEIGHT,
      "fill-extrusion-height": ["+", BUILDING_HEIGHT, 0.5],
      "fill-extrusion-opacity": 0.9,
    },
  };
}

export const LANDMARK_WALLS_LAYER_ID = "landmark-walls";
export const LANDMARK_SOLIDS_LAYER_ID = "landmark-solids";
const LANDMARK_WALLS_FILTER: ExpressionSpecification = ["has", "pattern"];
const LANDMARK_SOLIDS_FILTER: ExpressionSpecification = ["!", ["has", "pattern"]];

/** Landmarks (landmarks.ts) as textured walls, then roofs and spires; hidden until setBuildings3d. */
export function landmarkLayers(dark = false): FillExtrusionLayerSpecification[] {
  const c: Record<string, string> = dark ? PALETTE.dark : PALETTE.light;
  const theme = dark ? "dark" : "light";
  const extrude: FillExtrusionLayerSpecification["paint"] = { "fill-extrusion-base": ["get", "base"], "fill-extrusion-height": ["get", "height"] };
  return [
    {
      id: LANDMARK_WALLS_LAYER_ID, type: "fill-extrusion", source: LANDMARKS_SOURCE_ID,
      filter: LANDMARK_WALLS_FILTER, layout: { visibility: "none" },
      // drawn by registerCampusImages
      paint: { ...extrude, "fill-extrusion-pattern": ["concat", "iitb-", ["get", "pattern"], "-", ["get", "tone"], "-", theme] },
    },
    {
      id: LANDMARK_SOLIDS_LAYER_ID, type: "fill-extrusion", source: LANDMARKS_SOURCE_ID,
      filter: LANDMARK_SOLIDS_FILTER, layout: { visibility: "none" },
      paint: {
        ...extrude,
        "fill-extrusion-color": [
          "match", ["get", "tone"],
          ...[...Object.keys(BUILDING_KINDS), "building"].flatMap((t) => [t, c[t], `${t}Roof`, c[`${t}Roof`]]),
          "saffron", c.saffron,
          c.building,
        ] as unknown as ExpressionSpecification,
      },
    },
  ];
}

const PATTERN_PX = 16;

/** A wall texture: window bands, or vertical ribs, a shade darker than the wall. */
function patternImage(pattern: string, wall: string): { width: number; height: number; data: Uint8Array } {
  const rgb = [1, 3, 5].map((i) => parseInt(wall.slice(i, i + 2), 16));
  const data = new Uint8Array(PATTERN_PX * PATTERN_PX * 4);
  for (let y = 0; y < PATTERN_PX; y++) {
    for (let x = 0; x < PATTERN_PX; x++) {
      const shade = (pattern === "ribs" ? x % 8 < 2 : y >= 5 && y < 10) ? 0.72 : 1;
      data.set([...rgb.map((v) => Math.round(v * shade)), 255], (y * PATTERN_PX + x) * 4);
    }
  }
  return { width: PATTERN_PX, height: PATTERN_PX, data };
}

/** Draws landmark wall textures as the style asks for them; call once per map, it outlives setStyle. */
export function registerCampusImages(map: MaplibreMap): void {
  map.on("styleimagemissing", ({ id }: { id: string }) => {
    const m = /^iitb-(bands|ribs)-(\w+)-(light|dark)$/.exec(id);
    const wall = m && (PALETTE[m[3] as "light" | "dark"] as Record<string, string>)[m[2]];
    if (wall && !map.hasImage(id)) map.addImage(id, patternImage(m[1], wall));
  });
}

const LAYERS_3D = [BUILDINGS_3D_LAYER_ID, BUILDINGS_3D_ROOF_LAYER_ID, LANDMARK_WALLS_LAYER_ID, LANDMARK_SOLIDS_LAYER_ID];

/** Visibility only; the caller tilts the camera, so a style reload leaves it alone. */
export function setBuildings3d(map: MaplibreMap, on: boolean): void {
  for (const id of LAYERS_3D) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}

/** Label and extrude only these building names; null shows all. */
export function filterBuildings(map: MaplibreMap, names: string[] | null): void {
  const only: ExpressionSpecification | null = names && ["in", ["get", "name"], ["literal", names]];
  for (const [id, base] of [
    [BUILDING_LABEL_LAYER_ID, BUILDING_LABEL_FILTER],
    [PINNED_LABEL_LAYER_ID, BUILDING_LABEL_FILTER],
    [BUILDINGS_3D_LAYER_ID, BUILDINGS_3D_FILTER],
    [BUILDINGS_3D_ROOF_LAYER_ID, BUILDINGS_3D_FILTER],
    [LANDMARK_WALLS_LAYER_ID, LANDMARK_WALLS_FILTER],
    [LANDMARK_SOLIDS_LAYER_ID, LANDMARK_SOLIDS_FILTER],
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
    ...sportsLayers(dark),
    pipelineLayer(dark),
    addedBuildingsLayer(dark),
    boundaryLayer(dark),
    // below building labels, so buildings win label collisions
    roadWidthLayer(dark),
    buildings3dLayer(dark),
    buildings3dRoofLayer(dark),
    ...landmarkLayers(dark),
    buildingLabelLayer({ dark }),
    // above unpinned labels, so a pinned label wins collisions
    buildingLabelLayer({ dark, pinned: true }),
    // above building labels, so food names win label collisions
    ...foodLayers({ dark }),
  ];
}

/** Landmark walls also need registerCampusImages(map). */
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
      [PIPELINE_SOURCE_ID]: { type: "geojson", data: IITB_PIPELINE },
      [ROADS_SOURCE_ID]: { type: "geojson", data: IITB_ROADS },
      [SPORTS_SOURCE_ID]: { type: "geojson", data: IITB_SPORTS },
      [PINS_SOURCE_ID]: { type: "geojson", data: pinnedLabels() },
      [LANDMARKS_SOURCE_ID]: { type: "geojson", data: landmarkParts() },
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

/** Re-sends every source built from IITB_BUILDINGS or IITB_FOOD, after the sheet or hand edits change them. */
export function refreshCampusSources(map: MaplibreMap): void {
  // landmarkParts marks the buildings before they are sent
  for (const [id, data] of [
    [LANDMARKS_SOURCE_ID, landmarkParts()],
    [BUILDINGS_SOURCE_ID, IITB_BUILDINGS],
    [FOOD_SOURCE_ID, IITB_FOOD],
    [PINS_SOURCE_ID, pinnedLabels()],
  ] as const) {
    (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
  }
}

export function setCampusTheme(map: MaplibreMap, dark: boolean): void {
  for (const layer of themedLayers(dark)) {
    if (!map.getLayer(layer.id) || !("paint" in layer)) continue;
    for (const [prop, value] of Object.entries(layer.paint ?? {})) map.setPaintProperty(layer.id, prop, value);
  }
}
