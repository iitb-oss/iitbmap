import type { Feature, FeatureCollection, Polygon, Position } from "geojson";
import { buildingCentroid, buildingKind, IITB_BUILDINGS } from "./buildings";
import { STOREY_M } from "./geo";

export const LANDMARKS_SOURCE_ID = "landmarks";

/** Wall texture: window bands, or the ribs of the Convocation Hall's fan. */
type LandmarkPattern = "bands" | "ribs";

/** Steps above the walls: footprint scale, rise in metres; the last is in the roof tone. */
type Tiers = [scale: number, rise: number][];

interface Look {
  pattern?: LandmarkPattern;
  /** Wall height in metres, for halls taller than their floor count; default levels × STOREY_M. */
  height?: number;
  /** Default: a flat roof cap. "vault" arches and "gable" pitches across the short side. */
  roof?: Tiers | "vault" | "gable";
  /** Walls only around the edge, this fraction of the footprint left open in the middle. */
  courtyard?: number;
  /** A temple: a sanctum on a paved plinth under a stepped shikhara with a saffron flag. */
  shrine?: true;
}

const SHIKHARA: Tiers = [[0.42, 2.6], [0.34, 2.2], [0.26, 2], [0.18, 1.8], [0.09, 1.6]];
// the Gowshala's pitched roof
const HIP: Tiers = [[0.86, 0.9], [0.62, 0.9], [0.36, 0.8]];
const SHED: Look = { pattern: "ribs", height: 6, roof: "gable" };

/** Buildings shaped after the 2014 illustrated campus map (Shishir Bhagade), coloured by buildingKind. */
export const LANDMARK_LOOKS: Record<string, Look> = {
  // a single-floor auditorium under a stepped, ribbed roof
  "Convocation Hall": { pattern: "ribs", height: 10, roof: [[0.82, 1.4], [0.6, 1.4], [0.36, 1.2]] },
  // low wings around the open-air theatre's court
  SAC: { pattern: "bands", courtyard: 0.6 },
  "Indoor Basketball Court": { pattern: "bands", roof: "vault" },
  "Indoor Badminton Court": { pattern: "ribs", roof: "vault" },
  // high-bay workshops under corrugated pitched roofs
  "Machine Lab": SHED,
  "Machine Tool Lab": SHED,
  "N3 Bay": SHED,
  "Metal Forming Lab": SHED,
  "Structural Evaluation & Material Testing Lab": SHED,
  "RM Lab": SHED,
  "Ortho Cad Lab": SHED,
  "F1 Shed , Virtual Labs": SHED,
};

/** By OSM building tag, after LANDMARK_LOOKS. */
const LANDMARK_TAG_LOOKS: Record<string, Look> = {
  temple: { roof: SHIKHARA, shrine: true },
  cowshed: { height: STOREY_M, roof: HIP },
};

const ROOF_CAP: Tiers = [[1, 0.5]];
const PLINTH_M = 1.2;
const SANCTUM = { scale: 0.5, height: 5 };
const FLAG = { scale: 0.03, height: 2.5 };

const M_PER_DEG = 111_320;
const VAULT_SLABS = 7;
/** Rise over width; below 0.5 flattens the arch. */
const VAULT_RISE = 0.35;
const GABLE_SLABS = 5;
const GABLE_RISE = 0.2;

type Frame = ReturnType<typeof frame>;

/** Converts to and from (along, across) the longest side, about the centroid. */
function frame(f: Feature<Polygon>) {
  const ring = f.geometry.coordinates[0];
  const [cx, cy] = buildingCentroid(f);
  const k = Math.cos((cy * Math.PI) / 180);
  let u = [1, 0];
  let best = 0;
  for (let i = 1; i < ring.length; i++) {
    const dx = (ring[i][0] - ring[i - 1][0]) * k, dy = ring[i][1] - ring[i - 1][1];
    const len = Math.hypot(dx, dy);
    if (len > best) [best, u] = [len, [dx / len, dy / len]];
  }
  // (along, across) the longest side, in degrees of latitude
  const local = ([x, y]: Position) => {
    const dx = (x - cx) * k, dy = y - cy;
    return [dx * u[0] + dy * u[1], -dx * u[1] + dy * u[0]];
  };
  const back = (a: number, b: number): Position => [cx + (a * u[0] - b * u[1]) / k, cy + a * u[1] + b * u[0]];
  return { ring, local, back };
}

/** Shrinks the ring toward its centroid; with across, only across its longest side. */
function scaleRing({ ring, local, back }: Frame, s: number, across = false): Position[] {
  if (s === 1) return ring;
  return ring.map((p) => {
    const [a, b] = local(p);
    return back(across ? a : a * s, b * s);
  });
}

/** A barrel vault or a gable as slabs narrowing across the short side, sized to the building's width. */
function arch({ ring, local }: Frame, shape: "vault" | "gable"): Tiers {
  const across = ring.map((p) => local(p)[1]);
  const width = (Math.max(...across) - Math.min(...across)) * M_PER_DEG;
  if (shape === "gable") {
    return Array.from({ length: GABLE_SLABS }, (_, i) => [1 - (i + 0.5) / GABLE_SLABS, (width * GABLE_RISE) / GABLE_SLABS]);
  }
  const rise = width * VAULT_RISE;
  const angle = (i: number) => (i / VAULT_SLABS) * (Math.PI / 2);
  return Array.from({ length: VAULT_SLABS }, (_, i) => [
    Math.cos((angle(i) + angle(i + 1)) / 2),
    rise * (Math.sin(angle(i + 1)) - Math.sin(angle(i))),
  ]);
}

/** One extruded part; tone is a PALETTE key. */
function part(name: string, rings: Position[][], base: number, height: number, tone: string, pattern?: LandmarkPattern): Feature<Polygon> {
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: rings },
    properties: { name, base, height, tone, ...(pattern && { pattern }) },
  };
}

/** Walls, roofs and spires of every landmark; rebuild after IITB_BUILDINGS changes. Idempotent; marks each drawn building with a landmark prop. */
export function landmarkParts(): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = [];
  for (const f of IITB_BUILDINGS.features) {
    const p = f.properties ?? {};
    delete p.landmark;
    const look = LANDMARK_LOOKS[p.name] ?? LANDMARK_TAG_LOOKS[p.building];
    // like buildings3dLayer, only what has a height
    if (!look || p.area || f.geometry?.type !== "Polygon" || (p.levels == null && look.height == null && !look.shrine)) continue;
    p.landmark = true;
    const fr = frame(f as Feature<Polygon>);
    // the map colour of the building's kind, a PALETTE key
    const tone = buildingKind(p.building);
    const roof = `${tone}Roof`;
    // a hole winds the other way
    const hole = look.courtyard ? [scaleRing(fr, look.courtyard).reverse()] : [];
    const add = (s: number, base: number, top: number, tone: string, pattern?: LandmarkPattern) =>
      features.push(part(p.name, [scaleRing(fr, s), ...hole], base, top, tone, pattern));
    let top = 0;
    if (look.shrine) {
      add(1, 0, PLINTH_M, roof);
      add(SANCTUM.scale, PLINTH_M, (top = PLINTH_M + SANCTUM.height), tone);
    } else {
      add(1, 0, (top = look.height ?? p.levels * STOREY_M), tone, look.pattern);
    }
    const arched = typeof look.roof === "string";
    const tiers = typeof look.roof === "string" ? arch(fr, look.roof) : look.roof ?? ROOF_CAP;
    tiers.forEach(([s, rise], i) =>
      features.push(part(p.name, [scaleRing(fr, s, arched), ...hole], top, (top += rise), i === tiers.length - 1 || arched ? roof : tone)),
    );
    if (look.shrine) add(FLAG.scale, top, top + FLAG.height, "saffron");
  }
  return { type: "FeatureCollection", features };
}
