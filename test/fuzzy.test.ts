import { describe, expect, it } from "vitest";
import { searchNames } from "../demo/src/lib/fuzzy";
import { BUILDING_ALIASES } from "../demo/src/lib/aliases";
import { IITB_BUILDINGS } from "../src/buildings";
import { PLACE_NAMES } from "../demo/src/lib/places";

const names = [...new Set(IITB_BUILDINGS.features.map((f) => f.properties!.name as string))];

describe("searchNames", () => {
  it.each(["victor menezes", "Viktor", "victo", "menzes convention", "convention centre"])("finds the convention centre for %j", (q) => {
    expect(searchNames(q, names)).toContain("Viktor Menezes Convention Centre");
  });

  it("ranks exact substring matches first", () => {
    expect(searchNames("KReSIT", names)[0]).toBe("KReSIT");
    expect(searchNames("hostel no 10", names)[0]).toBe("Hostel No 10");
    expect(searchNames("h12", names)[0]).toBe("Hostel 12");
    expect(searchNames("sha", names, BUILDING_ALIASES)[0]).toBe("Staff Hostel Annexe");
  });

  it.each([
    ["cse", "Computer Science & Engineering Center (New)"],
    ["ese", "Department of Energy Sciences and Engineering"],
    ["bsbe", "Department of Bio sciences and Bio engineering"],
    ["kcdh", "KReSIT"],
    ["idc", "Industrial Design Center"],
    ["ee", "Department of Electrical engineering"],
    ["che", "Department of Chemical Engineering and Chemistry"],
    ["chem", "Department of Chemical Engineering and Chemistry"],
    ["phy", "Department of Physics"],
    ["gullu", "Gulmohar"],
    ["lhc", "Lecture Hall"],
    ["lhc", "Lecture Hall Complex 3"],
    ["gg", "Girish Gaitonde Building"],
    ["ccd", "Department of Energy Sciences and Engineering"],
    ["cafe coffee day", "Department of Energy Sciences and Engineering"],
  ])("finds the short form %j", (q, name) => {
    expect(searchNames(q, names, BUILDING_ALIASES)).toContain(name);
  });

  it("only has aliases for places that exist", () => {
    for (const name of Object.keys(BUILDING_ALIASES)) expect(PLACE_NAMES).toContain(name);
  });

  it("does not match unrelated words", () => {
    expect(searchNames("zzzz", names)).toEqual([]);
    expect(searchNames("", names)).toEqual([]);
  });
});
