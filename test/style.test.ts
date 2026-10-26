import { describe, expect, it } from "vitest";
import { BUILDING_LABEL_FILTER, BUILDING_LABEL_LAYER_ID } from "../src/buildings";
import { addedBuildingsLayer, BUILDINGS_3D_LAYER_ID, buildings3dLayer, campusLayers, filterBuildings, getCampusStyle, mergeCampusLayers, STOREY_M } from "../src/style";

describe("campusLayers", () => {
  it("defines one layer per campus source-layer, bottom to top", () => {
    expect(campusLayers().map((l) => l.id)).toEqual([
      "campus-green",
      "campus-parking",
      "campus-streets",
      "campus-paths",
      "campus-building",
      "campus-water",
      "campus-waterway",
    ]);
  });

  it("every layer reads from the campus vector source", () => {
    for (const layer of campusLayers()) {
      expect(layer.source).toBe("campus");
    }
  });

  it("light and dark produce different paint colors per layer", () => {
    const light = campusLayers(false);
    const dark = campusLayers(true);
    for (let i = 0; i < light.length; i++) {
      expect(light[i].paint).not.toEqual(dark[i].paint);
    }
  });

  it("colors buildings by type, with distinct academic / hostel / residence fills", () => {
    for (const dark of [false, true]) {
      const fill = addedBuildingsLayer(dark).paint!["fill-color"] as unknown[];
      expect(fill[0]).toBe("match");
      const colors = [fill[3], fill[5], fill[7], fill[8]];
      expect(new Set(colors).size).toBe(4);
    }
  });

  it("leaves academic tile buildings plain, since the tiles reach off campus", () => {
    const fill = (campusLayers().find((l) => l.id === "campus-building")!.paint as Record<string, unknown>)["fill-color"] as unknown[];
    expect(fill[5]).toBe(fill[8]);
  });

  it("splits streets and footpaths into separate layers, only footpaths dashed", () => {
    const byId = Object.fromEntries(campusLayers().map((l) => [l.id, l]));
    expect((byId["campus-paths"].paint as Record<string, unknown>)["line-dasharray"]).toBeDefined();
    expect((byId["campus-streets"].paint as Record<string, unknown>)["line-dasharray"]).toBeUndefined();
  });

  it("dark streets are darker than light streets (no glare at night)", () => {
    const lineOf = (dark: boolean) =>
      (campusLayers(dark).find((l) => l.id === "campus-streets")!.paint as Record<string, unknown>)["line-color"] as string;
    expect(hexLightness(lineOf(true))).toBeLessThan(hexLightness(lineOf(false)));
  });
});

function hexLightness(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (r + g + b) / 3;
}

describe("getCampusStyle", () => {
  it("requires a tileUrl/glyphsUrl when neither an override nor a default is available", () => {
    expect(() => getCampusStyle({ tileUrl: "", glyphsUrl: "" })).toThrow(/no (tileUrl|glyphsUrl) configured/);
  });

  it("falls back to the package's default tileUrl/glyphsUrl when none is passed", () => {
    const style = getCampusStyle();
    expect(style.sources.campus).toBeDefined();
  });

  it("builds a full style when urls are passed explicitly", () => {
    const style = getCampusStyle({ tileUrl: "https://example.com/{z}/{x}/{y}.pbf", glyphsUrl: "https://example.com/{fontstack}/{range}.pbf" });
    expect(style.sources.campus).toBeDefined();
    expect(style.sources.buildings).toBeDefined();
    expect(style.layers.map((l) => l.id)).toContain("campus-building");
    expect(style.layers.map((l) => l.id)).toContain("building-label");
  });
});

describe("mergeCampusLayers", () => {
  const baseUrl = { tileUrl: "https://example.com/{z}/{x}/{y}.pbf" };

  it("appends campus layers to an existing style by default", () => {
    const base = { version: 8 as const, sources: {}, layers: [{ id: "my-layer", type: "background" as const, paint: {} }] };
    const merged = mergeCampusLayers(base, baseUrl);
    expect(merged.layers[0].id).toBe("my-layer");
    expect(merged.layers.at(-1)?.id).toBe("campus-waterway");
  });

  it("inserts before a given layer id when beforeId is set", () => {
    const base = { version: 8 as const, sources: {}, layers: [{ id: "markers", type: "circle" as const, source: "x", paint: {} }] };
    const merged = mergeCampusLayers(base, { ...baseUrl, beforeId: "markers" });
    expect(merged.layers[0].id).toBe("campus-green");
    expect(merged.layers.at(-1)?.id).toBe("markers");
  });

  it("throws if the target style already has a source with the same id", () => {
    const base = { version: 8 as const, sources: { campus: { type: "vector" as const, tiles: [] } }, layers: [] };
    expect(() => mergeCampusLayers(base, baseUrl)).toThrow(/already has a source/);
  });
});

describe("buildings3dLayer", () => {
  it("extrudes only buildings with a storey count, hidden until switched on, below the labels", () => {
    const layer = buildings3dLayer();
    expect(layer.filter).toEqual(["has", "levels"]);
    expect(layer.layout?.visibility).toBe("none");
    expect(layer.paint?.["fill-extrusion-height"]).toEqual(["*", ["get", "levels"], STOREY_M]);
    const ids = getCampusStyle({ tileUrl: "t", glyphsUrl: "g" }).layers.map((l) => l.id);
    expect(ids.indexOf(BUILDINGS_3D_LAYER_ID)).toBeLessThan(ids.indexOf("building-label"));
  });
});

describe("filterBuildings", () => {
  it("narrows the label and 3D layers to the names, and null restores their own filters", () => {
    const filters = new Map<string, unknown>();
    const map = { getLayer: () => ({}), setFilter: (id: string, f: unknown) => filters.set(id, f) } as never;
    filterBuildings(map, ["Hostel 1"]);
    const only = ["in", ["get", "name"], ["literal", ["Hostel 1"]]];
    expect(filters.get(BUILDINGS_3D_LAYER_ID)).toEqual(["all", ["has", "levels"], only]);
    expect(filters.get(BUILDING_LABEL_LAYER_ID)).toEqual(["all", BUILDING_LABEL_FILTER, only]);
    filterBuildings(map, null);
    expect(filters.get(BUILDINGS_3D_LAYER_ID)).toEqual(buildings3dLayer().filter);
    expect(filters.get(BUILDING_LABEL_LAYER_ID)).toEqual(BUILDING_LABEL_FILTER);
  });
});
