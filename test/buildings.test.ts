import { describe, expect, it } from "vitest";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import { applyBuildingEdits, pinnedLabels, buildingCentroid, buildingLabelLayer, BUILDINGS_SOURCE_ID, IITB_BUILDINGS, storeysByName } from "../src/buildings";

describe("IITB_BUILDINGS", () => {
  it("is a non-empty FeatureCollection", () => {
    expect(IITB_BUILDINGS.type).toBe("FeatureCollection");
    expect(IITB_BUILDINGS.features.length).toBeGreaterThan(0);
  });
});

describe("buildingCentroid", () => {
  it("stays exact for a few-metre polygon at campus coordinates", () => {
    const [x, y, d] = [72.9165831, 19.1253176, 2e-5];
    const square: Feature<Polygon> = {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]] },
    };
    const [cx, cy] = buildingCentroid(square);
    expect(Math.abs(cx - x)).toBeLessThan(1e-9);
    expect(Math.abs(cy - y)).toBeLessThan(1e-9);
  });
});

describe("buildingLabelLayer", () => {
  it("reads from the buildings source and labels by name", () => {
    const layer = buildingLabelLayer();
    expect(layer.source).toBe(BUILDINGS_SOURCE_ID);
    const field = layer.layout?.["text-field"] as unknown[];
    // the short form (or name) alone until zoomed in
    expect(field.slice(0, 3)).toEqual(["step", ["zoom"], ["coalesce", ["get", "short"], ["get", "name"]]]);
  });

  it("gives long names a short label", () => {
    const cheme = IITB_BUILDINGS.features.find((f) => f.properties!.name === "Department of Chemical Engineering and Chemistry");
    expect(cheme!.properties!.short).toBe("Chemical Engg & Chemistry");
  });

  it("uses a different text color for dark mode", () => {
    const light = buildingLabelLayer({ dark: false });
    const dark = buildingLabelLayer({ dark: true });
    expect(light.paint?.["text-color"]).not.toBe(dark.paint?.["text-color"]);
  });
});

describe("storeysByName", () => {
  it("words known storeys, marking housing-listing minimums with a plus", () => {
    const storeys = storeysByName();
    expect(storeys.get("Hostel 17")).toBe("8 storeys"); // G+8: floors above ground
    expect(storeys.get("Convocation Hall")).toBe("Ground floor");
    expect([...storeys.values()].every((s) => /^(\d+\+? storeys?|Ground floor)$/.test(s))).toBe(true);
    expect([...storeys.values()].some((s) => s.includes("+"))).toBe(true);
  });
});

describe("applyBuildingEdits", () => {
  it("pins labels by name and adds buildings, and re-applying replaces rather than stacks", () => {
    const square: Polygon = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    const fc: FeatureCollection = { type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "A" }, geometry: square }] };
    const added: Feature<Polygon> = { type: "Feature", properties: { name: "B", building: "yes" }, geometry: square };
    applyBuildingEdits(fc, { pins: { A: [5, 5], B: [6, 6] }, added: [added] });
    applyBuildingEdits(fc, { pins: { B: [7, 7] }, added: [added] });
    expect(fc.features.map((f) => f.properties)).toEqual([{ name: "A" }, { name: "B", building: "yes", added: true, label: [7, 7] }]);
    expect(pinnedLabels(fc).features).toEqual([{ type: "Feature", properties: { name: "B" }, geometry: { type: "Point", coordinates: [7, 7] } }]);
  });
});
