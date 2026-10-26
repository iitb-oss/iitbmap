import { applyMapEdits, IITB_EDITS, type MapEdits } from "../../../src/index";

const KEY = "iitbmap-edits";

/** Edit mode shows only with ?edit in the URL; it is for data maintainers. */
export const EDIT_ENABLED = new URLSearchParams(window.location.search).has("edit");

/** This browser's working copy, else the committed src/iitb-edits.json. */
export function loadEdits(): MapEdits {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // storage blocked or corrupt: start from the committed edits
  }
  return IITB_EDITS;
}

export function saveEdits(edits: MapEdits | null): void {
  try {
    if (edits) localStorage.setItem(KEY, JSON.stringify(edits));
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked: edits last for this visit only
  }
}

/** ~1 cm; keeps the committed file small and its diffs readable. */
export const round = ([lng, lat]: number[]): [number, number] => [+lng.toFixed(7), +lat.toFixed(7)];

/** Downloads the working copy; commit it as src/iitb-edits.json. */
export function downloadEdits(edits: MapEdits): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(edits, null, 1) + "\n"], { type: "application/json" }));
  a.download = "iitb-edits.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href));
}

// at import, before places.ts and the building list read the data
if (EDIT_ENABLED) applyMapEdits(loadEdits());
