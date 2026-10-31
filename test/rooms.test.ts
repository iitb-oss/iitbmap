import { describe, expect, it } from "vitest";
import { findRooms, floorBand, floorLabel, roomDetail, roomIndex, roomsByFloor, type RoomData } from "../demo/src/lib/rooms";
import type { Feature, Polygon } from "geojson";
import { readFileSync } from "node:fs";
import data from "../src/iitb-rooms.json";

const index = roomIndex(data as RoomData);

describe("room search", () => {
  it("finds a room in every hostel that has it, whatever the case or dashes", () => {
    const hits = findRooms(index, "room a-906");
    const exact = hits.filter((h) => h.room === "A906");
    expect(hits.slice(0, exact.length)).toEqual(exact);
    expect(exact.map((h) => `${h.label} ${h.floor}`)).toEqual(["Hostel No 10 9", "Hostel 15A 9", "Hostel 16 A 9"]);
  });

  it("lists every building with a common room number, exact matches first", () => {
    const hits = findRooms(index, "101");
    expect(hits.length).toBeGreaterThan(1);
    expect(hits[0].room.replace(/\W/g, "")).toBe("101");
  });

  it("finds every classroom on the Academic Section's list in its building, with floor and seats", () => {
    const rows = readFileSync("data/classrooms.csv", "utf8").trim().split("\n").slice(1);
    expect(rows).toHaveLength(53);
    for (const row of rows) {
      const [, room, seats, , building, floor] = row.match(/^([^,]+),(\d+),(".*?"|[^,]*),([^,]+),([^,]*)$/)!;
      // typed loosely, as a visitor would
      const hit = findRooms(index, room.toLowerCase().replace(" ", ""))[0];
      expect(hit, room).toMatchObject({ room, building, floor, seats: Number(seats) });
    }
    expect(findRooms(index, "LH 301")[0]).toMatchObject({ floor: "3", building: "Lecture Hall" });
    expect(findRooms(index, "la-001")[0]).toMatchObject({ floor: "G", building: "Lecture Hall Complex 3" });
    expect(findRooms(index, "ese102")[0]).toMatchObject({ floor: "1" });
    expect(findRooms(index, "IC 01")[0]).toMatchObject({ floor: "", building: "SOM" });
  });

  it("ignores queries without a digit", () => {
    expect(findRooms(index, "Hostel")).toEqual([]);
  });

  it("only points at buildings on the map", async () => {
    const { IITB_BUILDINGS } = await import("../src/index");
    const names = new Set(IITB_BUILDINGS.features.map((f) => f.properties?.name));
    expect((data as RoomData).buildings.filter(([b]) => !names.has(b))).toEqual([]);
  });
});

describe("roomsByFloor", () => {
  it("lists a department's rooms floor by floor, ground up", () => {
    const groups = roomsByFloor(index, "Department of Chemical Engineering and Chemistry");
    expect(groups[0].heading).toBe("Ground floor");
    expect(groups.map((g) => g.heading)).toContain("1st floor");
    for (const g of groups) expect(g.rooms.every((r) => floorLabel(r.floor) === g.heading || g.heading === "Floor not recorded")).toBe(true);
  });

  it("keeps rooms of an unknown wing apart from the wing they route to", () => {
    const groups = roomsByFloor(index, "Hostel 6 A");
    expect(groups.at(-1)!.heading).toBe("Hostel 6, wing not recorded");
  });
});

describe("floorBand", () => {
  const square: Feature<Polygon> = {
    type: "Feature",
    properties: { levels: 4 },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
  };
  it("spans the room's storey", () => {
    expect(floorBand(square, "G", 3.2)?.properties).toEqual({ base: 0, top: 3.2 });
    expect(floorBand(square, "3", 3.2)?.properties?.top).toBeCloseTo(12.8);
  });
  it("marks nothing it can't place", () => {
    expect(["B", "", "4", "x"].map((f) => floorBand(square, f, 3.2))).toEqual([null, null, null, null]);
    expect(floorBand({ ...square, properties: {} }, "1", 3.2)).toBeNull();
  });
});

describe("roomDetail", () => {
  it("names the hostel only when the room's wing isn't the building shown", () => {
    const hit = { room: "299", floor: "2", building: "Hostel 6 A", label: "Hostel 6" };
    expect(roomDetail(hit)).toBe("Hostel 6 · 2nd floor");
    expect(roomDetail(hit, false)).toBe("Hostel 6 · 2nd floor");
    expect(roomDetail({ ...hit, label: "Hostel 6 A", seats: 60 }, false)).toBe("2nd floor · 60 seats");
  });
});

describe("floorLabel", () => {
  it("words floors as signs do", () => {
    expect(["G", "B", "1", "2", "3", "11", "21", ""].map(floorLabel)).toEqual([
      "Ground floor", "Basement", "1st floor", "2nd floor", "3rd floor", "11th floor", "21st floor", "",
    ]);
  });
});
