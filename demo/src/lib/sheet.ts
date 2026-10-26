import type { FeatureCollection } from "geojson";
import { storeysLabel } from "../../../src/buildings";

// the public sheet scripts/fetch-*.py snapshot into the bundled JSON
const SHEET = "https://docs.google.com/spreadsheets/d/1St3ghkdXqslnXp3y6dtw8Z-9RdMlNP7-HPTFOZSFoQI/export?format=csv&gid=";
const BUILDINGS_TAB = 1926995448;
const FOOD_TAB = 1922262986;

/** RFC 4180 rows as objects keyed by the header row. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [[""]];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], row = rows[rows.length - 1];
    if (quoted) {
      if (c !== '"') row[row.length - 1] += c;
      else if (text[i + 1] === '"') row[row.length - 1] += text[i++];
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push("");
    else if (c === "\n") rows.push([""]);
    else if (c !== "\r") row[row.length - 1] += c;
  }
  const [header, ...body] = rows;
  return body.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

/** Matches fetch-buildings.py: storeys, else known_storeys with no source (typed by hand); "3+" is a housing minimum. */
export function sheetStoreys(row: Record<string, string>): number | undefined {
  const value = row.storeys || (row.source ? "" : row.known_storeys) || "";
  const n = parseInt(value, 10);
  return n > 0 && !value.endsWith("+") ? n : undefined;
}

/** Matches fetch-food.py hours_label; the font server has no en dash glyphs. */
export function hoursLabel(value: string): string | undefined {
  return value.trim().replace(/^Mo-Su\s+/, "").replace(/,\s*/g, ", ").replace(/[–—]/g, "-") || undefined;
}

const tab = async (gid: number) => {
  const res = await fetch(SHEET + gid);
  if (!res.ok) throw new Error(`sheet tab ${gid}: ${res.status}`);
  return parseCsv(await res.text());
};

/** Patches the bundled collections in place, so later setStyle calls see the sheet too. */
export async function applySheet(buildings: FeatureCollection, food: FeatureCollection): Promise<void> {
  const [buildingRows, foodRows] = await Promise.all([tab(BUILDINGS_TAB), tab(FOOD_TAB)]);
  const byName = new Map(buildingRows.map((r) => [r.name, r]));
  for (const { properties: p } of buildings.features) {
    const r = p && byName.get(p.name);
    const n = r && sheetStoreys(r);
    if (n) Object.assign(p, { levels: n, storeys: storeysLabel(n) });
  }
  const hand = new Map(foodRows.map((r) => [r.name, r]));
  for (const { properties: p } of food.features) {
    const r = p && hand.get(p.name);
    if (!r) continue;
    const hours = hoursLabel(r.hours || r.known_hours || "");
    if (hours) p.hours = hours;
    for (const k of ["app", "android", "ios", "web"]) if (r[k]) p[k] = r[k];
  }
}
