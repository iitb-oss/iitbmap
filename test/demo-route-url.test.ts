import { describe, expect, it } from "vitest";
import { readSharedRoute, writeSharedRoute } from "../demo/src/lib/route-url";

describe("shared demo route URLs", () => {
  it("reads a complete directions request", () => {
    expect(readSharedRoute(new URL("https://map.example/?from=Main+Gate&to=Library&profile=drive&route=2"))).toEqual({
      from: "Main Gate",
      to: "Library",
      profile: "drive",
      routeIndex: 2,
    });
  });

  it("requires both endpoints and defaults optional values", () => {
    expect(readSharedRoute(new URL("https://map.example/?from=Main+Gate"))).toBeNull();
    expect(readSharedRoute(new URL("https://map.example/?from=Main+Gate&to=Library"))).toEqual({
      from: "Main Gate",
      to: "Library",
      profile: "walk",
      routeIndex: 0,
    });
  });

  it("writes a compact URL without discarding unrelated state", () => {
    const url = writeSharedRoute(
      new URL("https://map.example/?theme=dark#map"),
      { from: "Main Gate", to: "Library", profile: "walk", routeIndex: 0 },
    );
    expect(url.href).toBe("https://map.example/?theme=dark&from=Main+Gate&to=Library&profile=walk#map");
  });
});
