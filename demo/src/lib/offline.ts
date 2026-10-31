// key shared with assets/sw.js, which serves tiles and glyphs from it cache-first
export const TILE_CACHE = "iitb-campus-map-tiles-v1";

/** Tile [z, x, y] covering a [[w, s], [e, n]] box at each zoom. */
export function tilesIn([[w, s], [e, n]]: [[number, number], [number, number]], minZoom: number, maxZoom: number): [number, number, number][] {
  const tiles: [number, number, number][] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const size = 2 ** z;
    const x = (lng: number) => Math.floor(((lng + 180) / 360) * size);
    const y = (lat: number) => Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * size);
    for (let tx = x(w); tx <= x(e); tx++) for (let ty = y(n); ty <= y(s); ty++) tiles.push([z, tx, ty]);
  }
  return tiles;
}

/** Fetches every URL into the tile cache, skipping cached ones; reports progress as done/total. */
export async function saveOffline(urls: string[], onProgress: (done: number, total: number) => void): Promise<void> {
  const cache = await caches.open(TILE_CACHE);
  let done = 0;
  let failed = 0;
  const queue = [...urls];
  const worker = async () => {
    for (let url = queue.pop(); url; url = queue.pop()) {
      if (!(await cache.match(url))) {
        const res = await fetch(url).catch(() => null);
        if (res?.ok) await cache.put(url, res);
        else if (res?.status !== 404) failed++; // tiles outside the data are 404s
      }
      onProgress(++done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  if (failed) throw new Error(`${failed} files didn't download; try again on a better connection`);
}
