import { describe, expect, it } from "vitest";
import type { FeatureCollection, Point } from "geojson";
import { applyFoodEdits, FOOD_LABEL_LAYER_ID, FOOD_NAMES, foodLayers, IITB_FOOD } from "../src/food";
import { buildingLabelLayer, BUILDING_LABEL_LAYER_ID } from "../src/buildings";
import { CAMPUS_BBOX, inCampusBbox } from "../src/geo";
import { getCampusStyle } from "../src/style";

describe("IITB_FOOD", () => {
  it("has named points inside the campus bbox, one per name", () => {
    expect(IITB_FOOD.features.length).toBeGreaterThan(0);
    for (const f of IITB_FOOD.features) {
      const [lng, lat] = f.geometry.coordinates;
      expect(inCampusBbox(lat, lng), `${f.properties.name} at ${lat},${lng} outside ${JSON.stringify(CAMPUS_BBOX)}`).toBe(true);
    }
    expect(new Set(FOOD_NAMES.map((n) => n.toLowerCase())).size).toBe(FOOD_NAMES.length);
  });

  it("words floors for display and shows them under the name", () => {
    const floors = IITB_FOOD.features.flatMap((f) => (f.properties.floor ? [f.properties.floor] : []));
    expect(floors.length).toBeGreaterThan(0);
    for (const floor of floors) expect(floor).toMatch(/^(Ground floor|Basement|\d+(st|nd|rd|th) floor)$/);
    expect(JSON.stringify(foodLayers()[1].layout?.["text-field"])).toContain('"floor"');
    expect(JSON.stringify(foodLayers()[1].layout?.["text-field"])).toContain('"hours"');
    expect(JSON.stringify(foodLayers()[1].layout?.["text-field"])).toContain('"app"');
  });

  it("uses names the Latin-only Inter glyphs can draw", () => {
    // ponytail: Latin-1 plus general punctuation; widen if the glyph set grows
    for (const name of FOOD_NAMES) expect(name, name).toMatch(/^[ -ÿ‐-‧]+$/);
  });
});

describe("food layers in the style", () => {
  it("sit above building labels so food names win collisions", () => {
    const ids = getCampusStyle().layers.map((l) => l.id);
    expect(ids.indexOf(FOOD_LABEL_LAYER_ID)).toBeGreaterThan(ids.indexOf(BUILDING_LABEL_LAYER_ID));
  });

  it("differ between light and dark", () => {
    expect(foodLayers({ dark: false }).map((l) => l.paint)).not.toEqual(foodLayers({ dark: true }).map((l) => l.paint));
  });

  it("building labels skip buildings the food layer already labels", () => {
    expect(JSON.stringify(buildingLabelLayer().filter)).toContain(FOOD_NAMES[0]);
  });
});

describe("applyFoodEdits", () => {
  it("moves a place by name and restores its snapshot position when the move is dropped", () => {
    const fc: FeatureCollection<Point> = {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: { name: "Cafe" }, geometry: { type: "Point", coordinates: [1, 1] } }],
    };
    const edits = { pins: {}, added: [] };
    applyFoodEdits(fc, { ...edits, food: { Cafe: [2, 2] } });
    applyFoodEdits(fc, { ...edits, food: { Cafe: [3, 3] } });
    expect(fc.features[0].geometry.coordinates).toEqual([3, 3]);
    applyFoodEdits(fc, edits);
    expect(fc.features[0]).toEqual({ type: "Feature", properties: { name: "Cafe" }, geometry: { type: "Point", coordinates: [1, 1] } });
  });
});
