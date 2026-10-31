import type { Feature, Polygon } from "geojson";
import { IITB_BUILDINGS, IITB_FOOD, FOOD_NAMES, buildingCentroid, inCampusBbox, type Route, type RoutingProfile } from "../../../src/index";
import { decodeDigipin } from "./digipin";

export const MY_LOCATION_LABEL = "My current location";
export const SITE_TITLE = "IIT Bombay Campus Map";

// ponytail: food places as ~4 m squares, so they share, route and preview like buildings
const FOOD_SQUARES: Feature<Polygon>[] = IITB_FOOD.features.map((f) => {
  const [x, y] = f.geometry.coordinates, d = 2e-5;
  const ring = [[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]];
  return { type: "Feature", properties: f.properties, geometry: { type: "Polygon", coordinates: [ring] } };
});

/** A building, else a food place, by name (any case). */
export function findPlace(name: string): Feature<Polygon> | undefined {
  const key = name.trim().toLowerCase();
  const named = (f: Feature) => f.properties?.name?.toLowerCase() === key;
  return (IITB_BUILDINGS.features.find(named) as Feature<Polygon> | undefined) ?? FOOD_SQUARES.find(named);
}

/** Buildings first, so a shared name resolves to the building. */
export const PLACE_NAMES = [...new Set([
  ...IITB_BUILDINGS.features.flatMap((f) => (f.properties?.name ? [f.properties.name as string] : [])),
  ...FOOD_NAMES,
])];

export function findPlaceCentroid(name: string): [number, number] | undefined {
  const feature = findPlace(name);
  return feature ? buildingCentroid(feature) : undefined;
}

/** A building or food place name, or an on-campus DIGIPIN, as [lng, lat]. */
export function resolvePlace(value: string): [number, number] | undefined {
  const place = findPlaceCentroid(value);
  if (place) return place;
  const pin = decodeDigipin(value);
  return pin && inCampusBbox(pin[1], pin[0]) ? pin : undefined;
}

/** "250 m, ~3 min walking": metres under a kilometre. */
export function formatRouteInfo(route: Route, profile: RoutingProfile, sep = ", "): string {
  const m = route.distanceMeters;
  const distance = m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
  const minutes = Math.max(1, Math.round((m / 1000 / (profile === "walk" ? 5 : 20)) * 60));
  return `${distance}${sep}~${minutes} min ${profile === "walk" ? "walking" : "driving"}`;
}
