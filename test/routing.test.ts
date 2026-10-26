import { describe, expect, it } from "vitest";
import { findRoute, findRoutes, routeSteps } from "../src/routing";
import { buildingCentroid, IITB_BUILDINGS } from "../src/buildings";
import type { Feature, Polygon } from "geojson";

const from = buildingCentroid(IITB_BUILDINGS.features[0] as Feature<Polygon>);
const to = buildingCentroid(IITB_BUILDINGS.features[IITB_BUILDINGS.features.length - 1] as Feature<Polygon>);

describe("findRoute", () => {
  it.each(["walk", "drive"] as const)("finds a %s route between two campus buildings", (profile) => {
    const route = findRoute(from, to, profile);
    expect(route).not.toBeNull();
    expect(route!.coordinates.length).toBeGreaterThan(1);
    expect(route!.coordinates[0]).toEqual(from);
    expect(route!.coordinates[route!.coordinates.length - 1]).toEqual(to);
    expect(route!.distanceMeters).toBeGreaterThan(0);
    expect(Number.isFinite(route!.distanceMeters)).toBe(true);
  });

  it("routing a point to itself only pays the round-trip snap to the street network", () => {
    const route = findRoute(from, from, "walk");
    expect(route).not.toBeNull();
    expect(route!.distanceMeters).toBeLessThan(1000);
  });

  // Regression guard: a walk-graph coverage gap once left a building snapped to a
  // street node over 1km away, drawing a route straight across the lake.
  it.each(IITB_BUILDINGS.features.filter((_, i) => i % 15 === 0))(
    "snaps $properties.name to a nearby walk-network node",
    (feature) => {
      const point = buildingCentroid(feature as Feature<Polygon>);
      const route = findRoute(point, point, "walk");
      expect(route!.distanceMeters).toBeLessThan(600);
    },
  );
});

describe("findRoutes", () => {
  it.each(["walk", "drive"] as const)("returns up to k %s routes, ranked shortest first", (profile) => {
    const routes = findRoutes(from, to, profile, 3);
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < routes.length; i++) {
      expect(routes[i].distanceMeters).toBeGreaterThanOrEqual(routes[i - 1].distanceMeters);
    }
  });

  it("returns distinct route shapes, not the same path repeated", () => {
    const routes = findRoutes(from, to, "walk", 3);
    const shapes = new Set(routes.map((r) => JSON.stringify(r.coordinates)));
    expect(shapes.size).toBe(routes.length);
  });

  it("findRoute(...) matches the first result of findRoutes(..., 1)", () => {
    const single = findRoute(from, to, "walk");
    const [first] = findRoutes(from, to, "walk", 1);
    expect(single).toEqual(first);
  });
});

describe("routeSteps", () => {
  const route = (coordinates: [number, number][], streets: (string | null)[], distanceMeters = 0) => ({
    coordinates, streets, distanceMeters, junctions: coordinates.map((_, i) => i).slice(0, -1),
  });
  const at = (name: string): [number, number] => {
    const f = IITB_BUILDINGS.features.find((f) => f.properties!.name === name)!;
    return f.geometry.type === "Point" ? (f.geometry.coordinates as [number, number]) : buildingCentroid(f as Feature<Polygon>);
  };
  const texts = (r: ReturnType<typeof findRoute>) => routeSteps(r!).map((s) => s.text);

  it("turns left at a right-angle junction and names the new street", () => {
    // north ~110 m, then west ~105 m
    const steps = routeSteps(route([[72.91, 19.13], [72.91, 19.131], [72.909, 19.131]], ["A Road", "B Road"], 215));
    expect(steps.map((s) => s.text)).toEqual(["Head north on A Road", "Turn left onto B Road", "Arrive"]);
    expect(steps[0].distanceMeters + steps[1].distanceMeters).toBeCloseTo(215);
  });

  it("turns right the other way round", () => {
    const steps = routeSteps(route([[72.91, 19.13], [72.91, 19.131], [72.911, 19.131]], [null, null]));
    expect(steps.map((s) => s.text)).toEqual(["Head north", "Turn right", "Arrive"]);
  });

  it("keeps gentle bends in one step and announces a renamed street", () => {
    const r = route([[72.91, 19.13], [72.9101, 19.131], [72.9102, 19.132]], ["A Road", "C Road"]);
    expect(routeSteps(r).map((s) => s.text)).toEqual(["Head north on A Road", "Continue onto C Road", "Arrive"]);
  });

  it("walks from the Main Gate to the Research Park up Main Gate Road", () => {
    const r = findRoute(at("Main Gate (Gate 2)"), at("ASPIRE - IITB Research Park"), "walk")!;
    expect(texts(r)).toEqual(["Head northwest on Main Gate Road", "Turn right", "Bear left", "Arrive"]);
    const steps = routeSteps(r);
    expect(steps[0].distanceMeters).toBeGreaterThan(1500); // Main Gate Road runs to the hostels
    expect(steps.reduce((a, s) => a + s.distanceMeters, 0)).toBeCloseTo(r.distanceMeters);
  });

  it("drives from the Main Gate to the Research Park round the outside road", () => {
    const r = findRoute(at("Main Gate (Gate 2)"), at("ASPIRE - IITB Research Park"), "drive");
    expect(texts(r)).toEqual(["Head south", "Turn right onto Adi Sankaracharya Marg", "Bear right", "Arrive"]);
  });

  it("starts every step on the route and ends with Arrive", () => {
    for (const profile of ["walk", "drive"] as const) {
      const r = findRoute(from, to, profile)!;
      const steps = routeSteps(r);
      expect(steps.at(-1)!.text).toBe("Arrive");
      for (const s of steps) expect(r.coordinates).toContainEqual(s.at);
    }
  });
});
