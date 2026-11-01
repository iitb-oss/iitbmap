// shared by app, page generator and Worker so slugs round-trip

/** Lowercase ASCII words separated by single spaces; also what search matches against. */
export function normalizeName(name: string): string {
  return name.normalize("NFKD").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

export function buildingSlug(name: string): string {
  return normalizeName(name).replace(/ /g, "-");
}

/** Path (relative to the app base) of a building's share page. */
export function buildingPath(name: string): string {
  return `b/${buildingSlug(name)}/`;
}

/** A place's share page, reopening a picked room or office. */
export function placeLink(base: string | URL, place: string, room?: string): URL {
  const url = new URL(buildingPath(place), base);
  if (room) url.searchParams.set("room", room);
  return url;
}

/** The slug in a pathname like "/iitbmap/b/<slug>/", or null. */
export function slugFromPathname(pathname: string): string | null {
  return pathname.match(/\/b\/([^/]+)\/?$/)?.[1] ?? null;
}
