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
    ["ese", "Department of Energy Science and Engineering"],
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
    ["ccd", "Department of Energy Science and Engineering"],
    ["cafe coffee day", "Department of Energy Science and Engineering"],
  ])("finds the short form %j", (q, name) => {
    expect(searchNames(q, names, BUILDING_ALIASES)).toContain(name);
  });

  it.each(["Hostel15", "hostel 15", "HOSTEL-15"])("finds every Hostel 15 building for %j", (q) => {
    expect(searchNames(q, names, BUILDING_ALIASES)).toEqual(expect.arrayContaining(["Hostel 15A", "Hostel 15 C", "H-15 Wing B"]));
  });

  it("splits letters from digits without losing names that join them", () => {
    expect(searchNames("hostel12", names, BUILDING_ALIASES)[0]).toBe("Hostel 12");
    expect(searchNames("A91", names, BUILDING_ALIASES)[0]).toBe("A91 Eco Hub");
    expect(searchNames("a91 eco", names, BUILDING_ALIASES)[0]).toBe("A91 Eco Hub");
    expect(searchNames("h15", names, BUILDING_ALIASES)).toContain("H-15 Wing B");
    expect(searchNames("2b12", names, BUILDING_ALIASES)[0]).toBe("2B-12 (67-72)");
  });

  it("only has aliases for places that exist", () => {
    for (const name of Object.keys(BUILDING_ALIASES)) expect(PLACE_NAMES).toContain(name);
  });

  it("does not match unrelated words", () => {
    expect(searchNames("zzzz", names)).toEqual([]);
    expect(searchNames("", names)).toEqual([]);
  });
});
