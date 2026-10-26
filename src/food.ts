import type { CircleLayerSpecification, ExpressionSpecification, Map as MaplibreMap, SymbolLayerSpecification } from "maplibre-gl";
import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import food from "./iitb-food.json";
import edits from "./iitb-edits.json";
import { MAP_BG, MAP_BG_DARK } from "./geo";

export interface FoodProps {
  name: string;
  amenity: string;
  floor?: string; // "1st floor"
  hours?: string; // "09:00-23:00"
  app?: string; // ordering app, with its store links
  android?: string;
  ios?: string;
  web?: string; // ordering website
}

/** Named food places on campus, as points. */
export const IITB_FOOD = food as FeatureCollection<Point, FoodProps>;

/** Hand edits over the OSM snapshot; the fetch scripts leave src/iitb-edits.json alone. */
export interface MapEdits {
  /** Building label positions, by name. */
  pins: Record<string, [number, number]>;
  /** Buildings OSM lacks. */
  added: Feature<Polygon>[];
  /** Food place positions, by name. */
  food?: Record<string, [number, number]>;
}

/** Idempotent; a moved place keeps its snapshot position in original, for un-moving. */
export function applyFoodEdits(fc: FeatureCollection<Point>, e: MapEdits): void {
  for (const f of fc.features) {
    const p = f.properties as Record<string, unknown>;
    const at = e.food?.[p.name as string];
    if (at) {
      p.original ??= f.geometry.coordinates;
      f.geometry.coordinates = at;
    } else if (p.original) {
      f.geometry.coordinates = p.original as number[];
      delete p.original;
    }
  }
}
// JSON types pins as number[]
export const IITB_EDITS = edits as unknown as MapEdits;
applyFoodEdits(IITB_FOOD, IITB_EDITS);

export const FOOD_SOURCE_ID = "food";
export const FOOD_DOT_LAYER_ID = "food-dot";
export const FOOD_LABEL_LAYER_ID = "food-label";
/** Below this zoom the dots would crowd the campus. */
export const FOOD_MIN_ZOOM = 15;
export const FOOD_HOURS_MIN_ZOOM = 17;

// a smaller line under the name, or nothing
const subline = (prop: string, prefix = ""): ExpressionSpecification =>
  ["case", ["has", prop], ["concat", "\n", prefix, ["get", prop]], ""];
const label = (...lines: ExpressionSpecification[]): ExpressionSpecification =>
  ["format", ["get", "name"], {}, ...lines.flatMap((l) => [l, { "font-scale": 0.82 }])] as unknown as ExpressionSpecification;
const FLOOR = subline("floor");
const APP = subline("app", "App: ");

/** Berry: clear of the red destination pin, the yellow main roads and the building fills. */
export const FOOD_COLORS = {
  light: { dot: "#b4407a", text: "#8a2c5c", halo: MAP_BG, ring: "#ffffff" },
  dark: { dot: "#e07aae", text: "#f0a8cb", halo: MAP_BG_DARK, ring: MAP_BG_DARK },
} as const;

/** A building with one of these names is labelled by the food layer. */
export const FOOD_NAMES = IITB_FOOD.features.map((f) => f.properties.name);

export function foodLayers(opts: { dark?: boolean } = {}): [CircleLayerSpecification, SymbolLayerSpecification] {
  const c = FOOD_COLORS[opts.dark ? "dark" : "light"];
  return [
    {
      id: FOOD_DOT_LAYER_ID,
      type: "circle",
      source: FOOD_SOURCE_ID,
      minzoom: FOOD_MIN_ZOOM,
      paint: {
        "circle-color": c.dot,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], FOOD_MIN_ZOOM, 3.5, 18, 6.5],
        "circle-stroke-color": c.ring,
        "circle-stroke-width": 1.5,
      },
    },
    {
      id: FOOD_LABEL_LAYER_ID,
      type: "symbol",
      source: FOOD_SOURCE_ID,
      minzoom: FOOD_MIN_ZOOM + 1,
      layout: {
        "text-field": ["step", ["zoom"], label(FLOOR, APP), FOOD_HOURS_MIN_ZOOM, label(FLOOR, subline("hours"), APP)],
        "text-font": ["Inter Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], FOOD_MIN_ZOOM + 1, 11, 18, 14],
        "text-max-width": 8,
        // beside the dot, on whichever side is clear
        "text-variable-anchor": ["left", "right", "top", "bottom"],
        "text-radial-offset": 0.7,
        "text-justify": "auto",
      },
      paint: {
        "text-color": c.text,
        "text-halo-color": c.halo,
        "text-halo-width": 1.4,
        "text-halo-blur": 0.2,
      },
    },
  ];
}

export function setFoodLabelsVisible(map: MaplibreMap, visible: boolean): void {
  for (const id of [FOOD_DOT_LAYER_ID, FOOD_LABEL_LAYER_ID]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
}
