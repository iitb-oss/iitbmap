// rooms placed on map buildings by scripts/match-rooms.py
import type { Feature, Polygon } from "geojson";
import { buildingCentroid } from "../../../src/buildings";
import { OFFICE_BY_NAME } from "./aliases";
import { normalizeName } from "./building-url";

export interface RoomHit {
  room: string;
  /** "G", "B", "1".."20", or "" when the portal records none */
  floor: string;
  /** map building to route to */
  building: string;
  /** what the room is in, e.g. "Hostel 6" when the wing isn't known */
  label: string;
  /** seats, for the Academic Section's classrooms */
  seats?: number;
  /** an office found by its alias, e.g. IRCC */
  office?: boolean;
  /** where in the building to pin it; default its middle */
  at?: [number, number];
}

/** An office alias with a known floor, as a hit in its building. */
export function officeHit(alias: string): RoomHit | null {
  const o = OFFICE_BY_NAME.get(alias);
  return o ? { room: alias, floor: o.floor, building: o.building, label: o.building, office: true, at: o.at } : null;
}

export interface RoomData {
  buildings: [string, string][];
  rooms: [string, string, number, number?][];
}

export type RoomIndex = Map<string, RoomHit[]>;

// case, spaces and dashes don't matter: "a-906", "A 906" and "Room A906" find A906
const key = (s: string) => normalizeName(s).replace(/^room /, "").replace(/ /g, "");

export function roomIndex(data: RoomData): RoomIndex {
  const index: RoomIndex = new Map();
  for (const [room, floor, b, seats] of data.rooms) {
    const [building, label] = data.buildings[b];
    const hits = index.get(key(room)) ?? [];
    if (!hits.some((h) => h.label === label)) hits.push({ room, floor, building, label, seats });
    index.set(key(room), hits);
  }
  return index;
}

/** A shared "room=" in its building: an office alias or a room number. */
export function findRoomHit(index: RoomIndex, room: string, building: string | undefined): RoomHit | null {
  const office = officeHit(room);
  if (office) return office.building === building ? office : null;
  return findRooms(index, room).find((h) => h.room === room && h.building === building) ?? null;
}

/** "Room LA 001", or an office's own name. */
export const roomTitle = (hit: RoomHit) => (hit.office ? hit.room : `Room ${hit.room}`);

/** Exact room numbers first, then ones that start with the query; only for queries with a digit. */
export function findRooms(index: RoomIndex, query: string, limit = 8): RoomHit[] {
  const q = key(query);
  if (!/\d/.test(q) || q.length > 12) return [];
  const hits = [...(index.get(q) ?? [])];
  // ponytail: linear scan of the room keys per keystroke, fine for the campus's rooms
  for (const [k, more] of index) {
    if (hits.length >= limit) break;
    if (k !== q && k.startsWith(q)) hits.push(...more);
  }
  return hits.slice(0, limit);
}

// the institute's venue booking (IRBS), where the Academic Section's classrooms are booked
export const BOOKING_URL = "https://portal.iitb.ac.in/irbs/VenueBookings";

export interface FloorGroup {
  heading: string;
  rooms: RoomHit[];
}

/** -1 for the basement, 0 for the ground floor, else the floor; null when unknown. */
export function floorNumber(floor: string): number | null {
  const n = floor === "B" ? -1 : floor === "G" ? 0 : floor ? Number(floor) : NaN;
  return Number.isInteger(n) ? n : null;
}

// "LT 102" before "LT 1001"
const byNumber = new Intl.Collator(undefined, { numeric: true });

/** A building's rooms by floor, ground up; rooms whose wing isn't known come last, under their hostel. */
export function roomsByFloor(index: RoomIndex, building: string): FloorGroup[] {
  const rank = (h: RoomHit) => (h.label !== h.building ? 1000 : floorNumber(h.floor) ?? 999);
  const hits = [...index.values()]
    .flat()
    .filter((h) => h.building === building)
    .sort((a, b) => rank(a) - rank(b) || byNumber.compare(a.room, b.room));
  const groups = new Map<string, RoomHit[]>();
  for (const h of hits) {
    const heading = h.label !== h.building ? `${h.label}, wing not recorded` : floorLabel(h.floor) || "Floor not recorded";
    const group = groups.get(heading);
    if (group) group.push(h);
    else groups.set(heading, [h]);
  }
  return [...groups].map(([heading, rooms]) => ({ heading, rooms }));
}

/** The room's storey, extruded around its building; null where the data can't place it. */
export function floorBand(building: Feature<Polygon>, floor: string, storeyM: number): Feature<Polygon> | null {
  const levels = building.properties?.levels as number | undefined;
  const n = floorNumber(floor);
  if (!levels || n === null || n < 0 || n >= levels) return null;
  const ring = building.geometry.coordinates[0];
  const [cx, cy] = buildingCentroid(building);
  // a little outside the walls, so the band shows over them
  const around = ring.map(([x, y]) => [cx + (x - cx) * 1.03, cy + (y - cy) * 1.03]);
  return { type: "Feature", properties: { base: n * storeyM, top: (n + 1) * storeyM }, geometry: { type: "Polygon", coordinates: [around] } };
}

/** "Hostel 6 · 2nd floor · 60 seats"; the label is left out where it is just the building's name. */
export function roomDetail(hit: RoomHit, withBuilding = true): string {
  const label = withBuilding || hit.label !== hit.building ? hit.label : "";
  return [label, floorLabel(hit.floor), hit.seats && `${hit.seats} seats`].filter(Boolean).join(" · ");
}

export function floorLabel(floor: string): string {
  const n = floorNumber(floor);
  if (n === null) return "";
  if (n === 0) return "Ground floor";
  if (n === -1) return "Basement";
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix} floor`;
}
