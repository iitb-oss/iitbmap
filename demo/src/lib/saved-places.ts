const KEY = "iitbmap-places";
const RECENT_MAX = 5;

export interface SavedPlaces {
  saved: string[];
  recent: string[];
}

export function loadPlaces(): SavedPlaces {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const names = (x: unknown) => (Array.isArray(x) ? x.filter((n): n is string => typeof n === "string") : []);
    return { saved: names(v?.saved), recent: names(v?.recent) };
  } catch {
    return { saved: [], recent: [] };
  }
}

export function storePlaces(places: SavedPlaces): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(places));
  } catch {
    // storage blocked: the list lasts for this visit only
  }
}

export const addRecent = (p: SavedPlaces, name: string): SavedPlaces => ({
  ...p,
  recent: [name, ...p.recent.filter((n) => n !== name)].slice(0, RECENT_MAX),
});

export const toggleSaved = (p: SavedPlaces, name: string): SavedPlaces => ({
  ...p,
  saved: p.saved.includes(name) ? p.saved.filter((n) => n !== name) : [...p.saved, name],
});
