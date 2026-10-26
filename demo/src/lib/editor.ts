import maplibregl from "maplibre-gl";
import type { Feature, Polygon, Position } from "geojson";
import {
  BUILDING_LABEL_LAYER_ID,
  BUILDINGS_SOURCE_ID,
  IITB_BUILDINGS,
  PINNED_LABEL_LAYER_ID,
  PINS_SOURCE_ID,
  pinnedLabels,
  FOOD_DOT_LAYER_ID,
  FOOD_LABEL_LAYER_ID,
  FOOD_SOURCE_ID,
  IITB_FOOD,
} from "../../../src/index";
import { round } from "./edits";

const DRAFT_SOURCE_ID = "edit-draft";
const LABEL_LAYERS = [BUILDING_LABEL_LAYER_ID, PINNED_LABEL_LAYER_ID];
const FOOD_LAYERS = [FOOD_DOT_LAYER_ID, FOOD_LABEL_LAYER_ID];

export interface EditorHooks {
  /** Read on every event, so the listeners registered once see current state. */
  state: () => { editing: boolean; drawing: [number, number][] | null };
  pin: (name: string, at: [number, number] | null) => void;
  /** null puts the food place back at its snapshot position. */
  moveFood: (name: string, at: [number, number] | null) => void;
  addVertex: (at: [number, number]) => void;
  /** An unnamed tile building was clicked. */
  nameBuilding: (geometry: Polygon, building: string) => void;
}

function inRing([x, y]: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const isNamed = (at: Position) =>
  IITB_BUILDINGS.features.some((f) => f.geometry.type === "Polygon" && inRing(at, f.geometry.coordinates[0]));

/** Registers once; MapLibre layer listeners outlive setStyle. */
export function installEditor(map: maplibregl.Map, hooks: EditorHooks): void {
  let dragging = false; // stacked layers each fire mousedown; the first one drags

  /** Drag a named feature on these layers: preview per move, drop on release, shift-click drops null (reset). */
  const draggable = (layers: string[], preview: (name: string, at: [number, number]) => void, drop: (name: string, at: [number, number] | null) => void) => {
    for (const id of layers) {
      map.on("mousedown", id, (e) => {
        const { editing, drawing } = hooks.state();
        const name = e.features?.[0]?.properties?.name as string | undefined;
        if (!editing || drawing || !name || dragging) return;
        if (e.originalEvent.shiftKey) return drop(name, null);
        e.preventDefault(); // no drag-pan while dragging
        dragging = true;
        const canvas = map.getCanvas();
        canvas.style.cursor = "grabbing";
        const onMove = (ev: { lngLat: maplibregl.LngLat }) => preview(name, round(ev.lngLat.toArray()));
        onMove(e);
        map.on("mousemove", onMove);
        map.once("mouseup", (ev) => {
          map.off("mousemove", onMove);
          dragging = false;
          canvas.style.cursor = "";
          drop(name, round(ev.lngLat.toArray()));
        });
      });
      map.on("mouseenter", id, () => hooks.state().editing && (map.getCanvas().style.cursor = "grab"));
      map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
    }
  };
  const setData = (id: string, data: GeoJSON.FeatureCollection) => (map.getSource(id) as maplibregl.GeoJSONSource).setData(data);

  // food first: its layers sit above the building labels
  draggable(
    FOOD_LAYERS,
    (name, at) => {
      for (const f of IITB_FOOD.features) {
        if (f.properties.name !== name) continue;
        (f.properties as { original?: number[] }).original ??= f.geometry.coordinates; // what applyFoodEdits restores
        f.geometry.coordinates = at;
      }
      setData(FOOD_SOURCE_ID, IITB_FOOD);
    },
    hooks.moveFood,
  );
  // preview moves only the pins source; hooks.pin applies the edit on drop
  draggable(
    LABEL_LAYERS,
    (name, at) => {
      const first = !IITB_BUILDINGS.features.some((f) => f.properties?.name === name && f.properties.label);
      for (const f of IITB_BUILDINGS.features) if (f.properties?.name === name) f.properties.label = at;
      setData(PINS_SOURCE_ID, pinnedLabels());
      if (first) setData(BUILDINGS_SOURCE_ID, IITB_BUILDINGS); // label now hides the polygon's own label
    },
    hooks.pin,
  );

  map.on("click", (e) => {
    const { editing, drawing } = hooks.state();
    if (!editing) return;
    const at = round(e.lngLat.toArray());
    if (drawing) return hooks.addVertex(at);
    if (map.queryRenderedFeatures(e.point, { layers: [...LABEL_LAYERS, ...FOOD_LAYERS].filter((id) => map.getLayer(id)) }).length) return;
    const hit = map.queryRenderedFeatures(e.point, { layers: ["campus-building"] })[0];
    if (!hit || isNamed(at)) return;
    // ponytail: a building split across tiles returns only the clicked piece; draw those instead
    const rings = hit.geometry.type === "Polygon" ? hit.geometry.coordinates : hit.geometry.type === "MultiPolygon" ? hit.geometry.coordinates[0] : null;
    if (!rings) return;
    hooks.nameBuilding({ type: "Polygon", coordinates: [rings[0].map(round)] }, hit.properties?.building ?? "yes");
  });
}

/** The shape being drawn: its outline so far and its vertices. Call again after setStyle. */
export function drawDraft(map: maplibregl.Map, vertices: [number, number][] | null): void {
  const pts = vertices ?? [];
  const features: Feature[] = pts.map((p) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: p } }));
  if (pts.length > 1) {
    features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [...pts, pts[0]] } });
  }
  const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };
  const source = map.getSource(DRAFT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(data);
    return;
  }
  map.addSource(DRAFT_SOURCE_ID, { type: "geojson", data });
  map.addLayer({
    id: "edit-draft-line", type: "line", source: DRAFT_SOURCE_ID,
    filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": "#2563eb", "line-width": 2, "line-dasharray": [2, 1] },
  });
  map.addLayer({
    id: "edit-draft-vertex", type: "circle", source: DRAFT_SOURCE_ID,
    filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": 4, "circle-color": "#2563eb", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 },
  });
}
