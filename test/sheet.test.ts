import { describe, expect, it } from "vitest";
import { hoursLabel, parseCsv, sheetStoreys } from "../demo/src/lib/sheet";

describe("sheet", () => {
  it("parses quoted CSV", () => {
    expect(parseCsv('name,hours\r\n"H1, Canteen","13:00-15:00,18:00-03:00"\r\nCafe 97,""\r\n')).toEqual([
      { name: "H1, Canteen", hours: "13:00-15:00,18:00-03:00" },
      { name: "Cafe 97", hours: "" },
    ]);
    expect(parseCsv('a\n"say ""hi"""')).toEqual([{ a: 'say "hi"' }]);
  });

  it("reads storeys like fetch-buildings.py", () => {
    const rows: Record<string, string>[] = [{ storeys: "5", known_storeys: "3" }, { known_storeys: "4*" }, { known_storeys: "3+" }, { storeys: "" }, { known_storeys: "3", source: "OSM" }];
    expect(rows.map(sheetStoreys))
      .toEqual([5, 4, undefined, undefined, undefined]);
  });

  it("formats hours like fetch-food.py", () => {
    expect(["Mo-Su 13:00-15:00,18:00-03:00", "09:00–17:00", " "].map(hoursLabel)).toEqual(["13:00-15:00, 18:00-03:00", "09:00-17:00", undefined]);
  });
});
