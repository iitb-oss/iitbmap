import type { LngLatBoundsLike } from "maplibre-gl";

// MapLibre bounds are ordered southwest, northeast.
export const CAMPUS_BOUNDS: LngLatBoundsLike = [
  [72.903, 19.115],
  [72.928, 19.157],
];
// How far the map pans: the master plan sheet's extent around the campus.
export const CAMPUS_MAX_BOUNDS: LngLatBoundsLike = [
  [72.898, 19.12],
  [72.924, 19.145],
];
export const CAMPUS_CENTER: [number, number] = [72.9155, 19.136];
export const CAMPUS_BBOX = { latMin: 19.115, latMax: 19.157, lngMin: 72.903, lngMax: 72.928 };
export const MIN_ZOOM = 13;
export const MAX_ZOOM = 19;
/** One storey, in metres. */
export const STOREY_M = 3.2;

export const MAP_BG = "#e4e9dc";
export const MAP_BG_DARK = "#1e2620";

export function inCampusBbox(lat: number, lng: number): boolean {
  return (
    lat >= CAMPUS_BBOX.latMin &&
    lat <= CAMPUS_BBOX.latMax &&
    lng >= CAMPUS_BBOX.lngMin &&
    lng <= CAMPUS_BBOX.lngMax
  );
}
