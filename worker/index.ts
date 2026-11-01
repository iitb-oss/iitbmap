// Share links /r (route) and /p (room in a place): OG tags for crawlers, a redirect for browsers; /og.png draws routes.
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import inter400 from "../demo/og/fonts/inter-400.ttf";
import inter700 from "../demo/og/fonts/inter-700.ttf";
import { findRoutes, type Route } from "../src/index";
import { buildingPath, placeLink } from "../demo/src/lib/building-url";
import { findPlace, formatRouteInfo, resolvePlace, SITE_TITLE } from "../demo/src/lib/places";
import { readSharedRoute, routeLink, writeSharedRoute, type SharedRoute } from "../demo/src/lib/route-url";
import { esc, loadBasemap, routeScene, sceneSvg, sceneView } from "../demo/og/render";
import { shareMetaTags, type ShareMeta } from "../demo/og/meta";
import { findRoomHit, roomDetail, roomIndex, roomTitle, type RoomData, type RoomHit, type RoomIndex } from "../demo/src/lib/rooms";

interface Env {
  APP_URL: string;
}

// only crawlers get the OG page; an unlisted one follows the redirect to the destination's preview
const CRAWLER = /bot|crawl|spider|preview|facebookexternalhit|whatsapp|slack|discord|telegram|linkedin|skype|embedly|vkshare|pinterest|snapchat|iframely/i;

let wasmReady: Promise<void> | undefined;
const FONTS = [new Uint8Array(inter400), new Uint8Array(inter700)];

function resolveRoute(shared: SharedRoute): Route | undefined {
  const from = resolvePlace(shared.from);
  const to = resolvePlace(shared.to);
  if (!from || !to) return undefined; // e.g. "My current location": no fixed start to draw
  const routes = findRoutes(from, to, shared.profile, shared.routeIndex + 1);
  return routes[Math.min(shared.routeIndex, routes.length - 1)];
}

// lazy; redirects never need it
let rooms: Promise<RoomIndex> | undefined;
async function sharedRoom(room: string | null | undefined, building: string): Promise<RoomHit | null> {
  if (!room) return null;
  rooms ??= import("../src/iitb-rooms.json").then((m) => roomIndex(m.default as RoomData));
  return findRoomHit(await rooms, room, building);
}

// one image per route, whatever the room
const routeImageUrl = (url: URL, shared: SharedRoute) => writeSharedRoute(new URL("/og.png", url), { ...shared, room: undefined });

/** "Room LA 001 (LA · Ground floor · 120 seats)" */
const roomText = (hit: RoomHit) => `${roomTitle(hit)} (${roomDetail(hit)})`;

const placeImage = (env: Env, place: string) => new URL(buildingPath(place) + "og.png", env.APP_URL).href;

function ogPage(meta: Omit<ShareMeta, "canonical">, target: string, linkText: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${shareMetaTags({ ...meta, canonical: target })}
  <meta http-equiv="refresh" content="0; url=${esc(target)}" />
</head>
<body>
  <p><a href="${esc(target)}">${esc(linkText)}</a></p>
  <script>location.replace(${JSON.stringify(target).replace(/</g, "\\u003c")});</script>
</body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

/** A room in a place: the app's /b/<slug>/?room= page, with the room in the preview. */
async function placePage(env: Env, url: URL, place: string, room: string | null): Promise<Response> {
  const target = placeLink(env.APP_URL, place, room ?? undefined);
  const hit = await sharedRoom(room, place);
  const title = `${hit ? `${roomTitle(hit)}, ` : ""}${place} | ${SITE_TITLE}`;
  return ogPage(
    {
      title,
      description: `${hit ? roomText(hit) : place} on the IIT Bombay campus map. Open for directions.`,
      url: url.href,
      image: placeImage(env, place),
      imageAlt: title,
      imageIsPreview: true,
    },
    target.href,
    `Open ${hit ? roomTitle(hit) : place}`,
  );
}

async function sharePage(env: Env, url: URL, shared: SharedRoute): Promise<Response> {
  const route = resolveRoute(shared);
  const target = routeLink(env.APP_URL, shared).href;
  const dest = findPlace(shared.to);
  const hit = await sharedRoom(shared.room, shared.to);
  const to = hit ? `${roomTitle(hit)}, ${shared.to}` : shared.to;
  const toText = hit ? roomText(hit) : shared.to;
  const { title, description, image } = route
    ? {
        title: `${shared.from} to ${to} | ${SITE_TITLE}`,
        description: `${formatRouteInfo(route, shared.profile)} from ${shared.from} to ${toText} on the IIT Bombay campus map.`,
        image: routeImageUrl(url, shared).href,
      }
    : {
        // Undrawable route (unknown or live-location start): use the destination's preview.
        title: `Directions to ${to} | ${SITE_TITLE}`,
        description: `${shared.profile === "walk" ? "Walking" : "Driving"} directions to ${toText} on the IIT Bombay campus map.`,
        image: dest ? placeImage(env, shared.to.trim()) : new URL("icons/icon-512.png", env.APP_URL).href,
      };
  return ogPage({ title, description, url: url.href, image, imageAlt: title, imageIsPreview: !!(route || dest) }, target, `Open directions to ${to}`);
}

async function routeImage(request: Request, url: URL, shared: SharedRoute, ctx: ExecutionContext): Promise<Response> {
  // canonical key so param order doesn't fragment the cache
  const key = new Request(routeImageUrl(url, shared).href);
  // the Cache API is a no-op on *.workers.dev; it works on a custom domain
  const cached = await caches.default.match(key);
  if (cached) return cached;

  const route = resolveRoute(shared);
  if (!route) return new Response("No route", { status: 404 });
  const scene = routeScene(shared.from, shared.to, route, shared.profile, findPlace(shared.to));
  const [basemap] = await Promise.all([loadBasemap(sceneView(scene).box), (wasmReady ??= initWasm(resvgWasm))]);
  const png = new Resvg(sceneSvg(basemap, scene), {
    font: { fontBuffers: FONTS, loadSystemFonts: false, defaultFontFamily: "Inter" },
  }).render().asPng();

  const response = new Response(png, { headers: { "content-type": "image/png", "cache-control": "public, max-age=604800" } });
  if (request.method === "GET") ctx.waitUntil(caches.default.put(key, response.clone()));
  return response;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const shared = readSharedRoute(url);
    if (url.pathname === "/r" || url.pathname === "/r/") {
      if (!shared) return Response.redirect(env.APP_URL, 302);
      if (!CRAWLER.test(request.headers.get("user-agent") ?? "")) return Response.redirect(routeLink(env.APP_URL, shared).href, 302);
      return sharePage(env, url, shared);
    }
    if (url.pathname === "/p" || url.pathname === "/p/") {
      const place = findPlace(url.searchParams.get("to") ?? "")?.properties?.name as string | undefined;
      if (!place) return Response.redirect(env.APP_URL, 302);
      const room = url.searchParams.get("room");
      if (!CRAWLER.test(request.headers.get("user-agent") ?? "")) {
        return Response.redirect(placeLink(env.APP_URL, place, room ?? undefined).href, 302);
      }
      return placePage(env, url, place, room);
    }
    if (url.pathname === "/og.png" && shared) return routeImage(request, url, shared, ctx);
    return Response.redirect(env.APP_URL, 302);
  },
};
