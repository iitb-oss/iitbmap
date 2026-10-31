import { describe, expect, it } from "vitest";
import { tilesIn } from "../demo/src/lib/offline";
import { addRecent, loadPlaces, toggleSaved, type SavedPlaces } from "../demo/src/lib/saved-places";

describe("tilesIn", () => {
  it("covers the box at each zoom", () => {
    const tiles = tilesIn([[72.898, 19.12], [72.924, 19.145]], 13, 16);
    expect(tiles.filter(([z]) => z === 13)).toEqual([[13, 5754, 3652], [13, 5755, 3652]]);
    expect(tiles.filter(([z]) => z === 16)).toHaveLength(30);
  });
});

describe("saved places", () => {
  it("keeps recents unique, newest first, at most five", () => {
    let p: SavedPlaces = { saved: [], recent: [] };
    for (const n of ["a", "b", "c", "d", "e", "f", "b"]) p = addRecent(p, n);
    expect(p.recent).toEqual(["b", "f", "e", "d", "c"]);
  });
  it("toggles a saved place", () => {
    const p = toggleSaved({ saved: [], recent: [] }, "a");
    expect(p.saved).toEqual(["a"]);
    expect(toggleSaved(p, "a").saved).toEqual([]);
  });
});

describe("loadPlaces", () => {
  it("drops corrupt storage", () => {
    const store = new Map<string, string>([["iitbmap-places", '{"saved":[1,"a",null],"recent":"x"}']]);
    globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null } as Storage;
    expect(loadPlaces()).toEqual({ saved: ["a"], recent: [] });
    store.set("iitbmap-places", "not json");
    expect(loadPlaces()).toEqual({ saved: [], recent: [] });
  });
});
