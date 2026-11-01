import { describe, expect, it } from "vitest";
import { findPlaceCentroid, formatRouteInfo, PLACE_NAMES, unresolvedMessage } from "../demo/src/lib/places";
import { IITB_FOOD } from "../src/food";

describe("food places", () => {
  it("resolve to their own point and are listed", () => {
    const quantum = IITB_FOOD.features.find((f) => f.properties.name === "Quantum Cafe")!;
    const [x, y] = findPlaceCentroid("quantum cafe")!;
    expect(x).toBeCloseTo(quantum.geometry.coordinates[0], 7);
    expect(y).toBeCloseTo(quantum.geometry.coordinates[1], 7);
    expect(PLACE_NAMES).toContain("Quantum Cafe");
  });
});

describe("formatRouteInfo", () => {
  const route = (distanceMeters: number) => ({ coordinates: [], distanceMeters, streets: [], junctions: [] });
  it("gives metres under a kilometre and at least a minute", () => {
    expect(formatRouteInfo(route(248), "walk")).toBe("250 m, ~3 min walking");
    expect(formatRouteInfo(route(40), "drive")).toBe("40 m, ~1 min driving");
    expect(formatRouteInfo(route(1432), "walk")).toBe("1.4 km, ~17 min walking");
  });
});

describe("unresolvedMessage", () => {
  it("says an off-campus DIGIPIN is outside, and anything else is unknown", () => {
    expect(unresolvedMessage(" 39j-438-tjc7 ")).toBe("DIGIPIN 39J-438-TJC7 is outside IIT Bombay. The map covers the campus only.");
    expect(unresolvedMessage("zzz")).toMatch(/^No place called "zzz"/);
  });
});
