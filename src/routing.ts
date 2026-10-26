import graphs from "./campus-routing.json";

export type RoutingProfile = "walk" | "drive";

export interface Route {
  coordinates: [number, number][];
  distanceMeters: number;
  /** Street name of each segment (coordinates[i] -> coordinates[i + 1]), null where unnamed. */
  streets: (string | null)[];
  /** Indices into coordinates of the junctions passed; turns happen only there. */
  junctions: number[];
}

/** [from, to, metres, index into names or -1, road shape between the two nodes]. */
type GraphEdge = [number, number, number, number, [number, number][]];

interface ProfileGraph {
  nodes: [number, number][];
  edges: GraphEdge[];
  names: string[];
}

const RAW_GRAPHS = graphs as Record<RoutingProfile, ProfileGraph>;

export function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

interface Neighbor {
  to: number;
  weight: number;
  name: string | null;
  /** Points strictly between the two nodes, in travel order. */
  shape: [number, number][];
}

interface Adjacency {
  nodes: [number, number][];
  neighbors: Neighbor[][];
}

const adjacencyCache = new Map<RoutingProfile, Adjacency>();

function getAdjacency(profile: RoutingProfile): Adjacency {
  let adjacency = adjacencyCache.get(profile);
  if (adjacency) return adjacency;

  const graph = RAW_GRAPHS[profile];
  const neighbors: Neighbor[][] = graph.nodes.map(() => []);
  for (const [u, v, weight, n, shape] of graph.edges) {
    const name = graph.names[n] ?? null;
    neighbors[u].push({ to: v, weight, name, shape });
    if (profile === "walk") neighbors[v].push({ to: u, weight, name, shape: [...shape].reverse() });
  }
  adjacency = { nodes: graph.nodes, neighbors };
  adjacencyCache.set(profile, adjacency);
  return adjacency;
}

function nearestNode(nodes: [number, number][], point: [number, number]): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = haversineMeters(nodes[i], point);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

interface PathResult {
  path: number[];
  distance: number;
}

// O(V^2) scan instead of a binary heap; fine at a few hundred nodes.
function dijkstra(
  adjacency: Adjacency,
  source: number,
  target: number,
  excludedEdges?: Set<string>,
  excludedNodes?: Set<number>,
): PathResult | null {
  const { neighbors } = adjacency;
  const dist = new Array(neighbors.length).fill(Infinity);
  const prev = new Array(neighbors.length).fill(-1);
  const visited = new Array(neighbors.length).fill(false);
  dist[source] = 0;

  for (let iter = 0; iter < neighbors.length; iter++) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < neighbors.length; i++) {
      if (!visited[i] && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    }
    if (u === -1 || u === target) break;
    visited[u] = true;
    for (const { to, weight } of neighbors[u]) {
      if (excludedNodes?.has(to) || excludedEdges?.has(`${u}-${to}`)) continue;
      const alt = dist[u] + weight;
      if (alt < dist[to]) {
        dist[to] = alt;
        prev[to] = u;
      }
    }
  }

  if (dist[target] === Infinity) return null;
  const path: number[] = [];
  for (let at = target; at !== -1; at = prev[at]) path.push(at);
  path.reverse();
  return { path, distance: dist[target] };
}

/** Cheapest edge u -> v; Dijkstra takes it over any parallel one. */
function edgeBetween(adjacency: Adjacency, u: number, v: number): Neighbor {
  let best = adjacency.neighbors[u][0];
  for (const n of adjacency.neighbors[u]) if (n.to === v && (best.to !== v || n.weight < best.weight)) best = n;
  return best;
}

function pathDistance(adjacency: Adjacency, path: number[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += edgeBetween(adjacency, path[i - 1], path[i]).weight;
  return total;
}

function sameRoot(path: number[], root: number[]): boolean {
  return root.every((node, i) => path[i] === node);
}

function kShortestPaths(adjacency: Adjacency, source: number, target: number, k: number): PathResult[] {
  const first = dijkstra(adjacency, source, target);
  if (!first) return [];
  const found: PathResult[] = [first];
  const candidates: PathResult[] = [];

  for (let i = 1; i < k; i++) {
    const prevPath = found[i - 1].path;
    for (let spurIndex = 0; spurIndex < prevPath.length - 1; spurIndex++) {
      const spurNode = prevPath[spurIndex];
      const rootPath = prevPath.slice(0, spurIndex + 1);

      const excludedEdges = new Set<string>();
      for (const p of found) {
        if (p.path.length > spurIndex && sameRoot(p.path, rootPath)) {
          excludedEdges.add(`${p.path[spurIndex]}-${p.path[spurIndex + 1]}`);
        }
      }
      const excludedNodes = new Set(rootPath.slice(0, -1));

      const spur = dijkstra(adjacency, spurNode, target, excludedEdges, excludedNodes);
      if (!spur) continue;

      const totalPath = [...rootPath.slice(0, -1), ...spur.path];
      const totalDistance = pathDistance(adjacency, rootPath) + spur.distance;
      const isDuplicate =
        candidates.some((c) => sameRoot(c.path, totalPath) && c.path.length === totalPath.length) ||
        found.some((f) => sameRoot(f.path, totalPath) && f.path.length === totalPath.length);
      if (!isDuplicate) candidates.push({ path: totalPath, distance: totalDistance });
    }

    if (candidates.length === 0) break;
    candidates.sort((a, b) => a.distance - b.distance);
    found.push(candidates.shift()!);
  }

  return found;
}

function toRoute(adjacency: Adjacency, result: PathResult, from: [number, number], to: [number, number]): Route {
  const { nodes } = adjacency;
  const { path } = result;
  const coordinates: [number, number][] = [from, nodes[path[0]]];
  const streets: (string | null)[] = [null];
  const junctions = [1];
  for (let i = 1; i < path.length; i++) {
    const edge = edgeBetween(adjacency, path[i - 1], path[i]);
    for (const p of [...edge.shape, nodes[path[i]]]) {
      coordinates.push(p);
      streets.push(edge.name);
    }
    junctions.push(coordinates.length - 1);
  }
  coordinates.push(to);
  streets.push(null);
  // edge weights follow road curves
  const distanceMeters = haversineMeters(from, nodes[path[0]]) + result.distance + haversineMeters(nodes[path[path.length - 1]], to);
  return { coordinates, distanceMeters, streets, junctions };
}

export interface RouteStep {
  /** "Turn left onto Hillside Road", "Head north", "Arrive". */
  text: string;
  /** Metres covered by this step, before the next instruction. */
  distanceMeters: number;
  /** Where the step starts, [lng, lat]. */
  at: [number, number];
}

function bearing(a: [number, number], b: [number, number]): number {
  const [lng1, lat1, lng2, lat2] = [a[0], a[1], b[0], b[1]].map((d) => (d * Math.PI) / 180);
  const y = Math.sin(lng2 - lng1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
/** Smallest announced bend, in degrees. */
const STRAIGHT_DEG = 30;
/** How far along the route to look either side of a junction for its heading, in metres. */
const LOOK_M = 15;

function turnText(delta: number): string {
  const side = delta > 0 ? "right" : "left";
  const a = Math.abs(delta);
  if (a < 60) return `Bear ${side}`;
  if (a < 135) return `Turn ${side}`;
  if (a < 165) return `Turn sharp ${side}`;
  return "Make a U-turn";
}

/** Turn-by-turn instructions, one per junction where the route bends past STRAIGHT_DEG or changes street. */
export function routeSteps(route: Route): RouteStep[] {
  const pts = route.coordinates;
  // cumulative metres along the route at each point
  const along = [0];
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + haversineMeters(pts[i - 1], pts[i]));
  // ponytail: scaled to the routed total; chords miss small wiggles
  const scale = along[pts.length - 1] > 0 ? route.distanceMeters / along[pts.length - 1] : 1;
  // the point LOOK_M away from pts[i] (dir -1 back, +1 ahead), or the route's end
  const reach = (i: number, dir: 1 | -1) => {
    let j = i;
    while (j + dir >= 0 && j + dir < pts.length && Math.abs(along[j] - along[i]) < LOOK_M) j += dir;
    return pts[j];
  };

  // first heading is the street's; the snap onto it can point anywhere
  const first = route.junctions[0];
  const b0 = bearing(pts[first], reach(first, 1));
  const steps: RouteStep[] = [
    { text: `Head ${COMPASS[Math.round(b0 / 45) % 8]}${route.streets[first] ? ` on ${route.streets[first]}` : ""}`, distanceMeters: 0, at: pts[first] },
  ];
  let stepStart = 0;
  for (const j of route.junctions.slice(1)) {
    if (j >= pts.length - 1) break;
    const delta = ((bearing(pts[j], reach(j, 1)) - bearing(reach(j, -1), pts[j]) + 540) % 360) - 180;
    const next = route.streets[j];
    let text: string | null = null;
    if (Math.abs(delta) >= STRAIGHT_DEG) text = `${turnText(delta)}${next ? ` onto ${next}` : ""}`;
    else if (next && next !== route.streets[j - 1]) text = `Continue onto ${next}`;
    if (!text) continue;
    steps[steps.length - 1].distanceMeters = (along[j] - along[stepStart]) * scale;
    steps.push({ text, distanceMeters: 0, at: pts[j] });
    stepStart = j;
  }
  steps[steps.length - 1].distanceMeters = (along[pts.length - 1] - along[stepStart]) * scale;
  steps.push({ text: "Arrive", distanceMeters: 0, at: pts[pts.length - 1] });
  return steps;
}

export function findRoute(from: [number, number], to: [number, number], profile: RoutingProfile = "walk"): Route | null {
  return findRoutes(from, to, profile, 1)[0] ?? null;
}

export function findRoutes(
  from: [number, number],
  to: [number, number],
  profile: RoutingProfile = "walk",
  k = 3,
): Route[] {
  const adjacency = getAdjacency(profile);
  const sourceNode = nearestNode(adjacency.nodes, from);
  const targetNode = nearestNode(adjacency.nodes, to);
  return kShortestPaths(adjacency, sourceNode, targetNode, k).map((r) => toRoute(adjacency, r, from, to));
}
