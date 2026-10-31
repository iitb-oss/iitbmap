import * as React from "react";
import type maplibregl from "maplibre-gl";
import { ArrowUpDown, Car, ChevronDown, Clock, CloudDownload, Download, Flag, Footprints, MapPin, Navigation, Settings, Share2, Star, Utensils, X } from "lucide-react";

import {
  getCampusStyle,
  setCampusTheme,
  CAMPUS_CENTER,
  CAMPUS_MAX_BOUNDS,
  MIN_ZOOM,
  MAX_ZOOM,
  CAMPUS_SOURCE_ID,
  filterBuildings,
  setFoodLabelsVisible,
  setFoodHighlight,
  NON_FOOD_AMENITIES,
  FOOD_DOT_LAYER_ID,
  FOOD_LABEL_LAYER_ID,
  type FoodProps,
  setBuildings3d,
  registerCampusImages,
  refreshCampusSources,
  IITB_BUILDINGS,
  IITB_FOOD,
  storeysByName,
  inCampusBbox,
  applyMapEdits,
  IITB_EDITS,
  type MapEdits,
  type Route,
  type RoutingProfile,
} from "../../src/index";
import { readSharedRoute, routeLink, writeSharedRoute, type SharedRoute } from "@/lib/route-url";
import { buildingPath, buildingSlug, slugFromPathname } from "@/lib/building-url";
import { decodeDigipin, encodeDigipin } from "@/lib/digipin";
import { saveOffline, tilesIn } from "@/lib/offline";
import { addRecent, loadPlaces, storePlaces, toggleSaved } from "@/lib/saved-places";
import { foodPopup } from "@/lib/food-popup";
import { applySheet } from "@/lib/sheet";
import { EDIT_ENABLED, downloadEdits, loadEdits, saveEdits } from "@/lib/edits";
import { drawDraft, installEditor } from "@/lib/editor";
import { EditPanel } from "@/components/edit-panel";
import { MY_LOCATION_LABEL, PLACE_NAMES, findPlace, findPlaceCentroid, formatRouteInfo, resolvePlace } from "@/lib/places";
import { haversineMeters } from "../../src/geo";
import { PALETTE } from "../../src/style";

// the routing graph is its own chunk, fetched after first paint
const routingModule = import("../../src/routing");
// so is the map library, so the panel paints without it
const maplibreModule = import("maplibre-gl");
// set once the map library loads, before the map exists
let MapLibre: typeof import("maplibre-gl");

import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BuildingList } from "@/components/building-list";
import { groupBuildings, groupFood } from "@/lib/building-groups";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BuildingCombobox } from "@/components/building-combobox";

const ROUTE_SOURCE_ID = "demo-route";
const ROUTE_LAYER_ID = "demo-route-line";
const ROUTE_LEG_LAYER_ID = "demo-route-leg";

const buildingGroups = groupBuildings(
  IITB_BUILDINGS.features.flatMap((f) => (f.properties?.name ? [{ name: f.properties.name, building: f.properties.building }] : [])),
);

// map filter chips: the building list's groups, plus food places
const SHOW_OPTIONS = [...buildingGroups.map(({ id, label }) => ({ id: id as string, label })), { id: "food", label: "Food" }];
const SHOW_ALL = SHOW_OPTIONS.map((o) => o.id);

const FOOD_FEATURES = IITB_FOOD.features.filter((f) => !NON_FOOD_AMENITIES.includes(f.properties.amenity));
const FOOD_GROUPS = groupFood(FOOD_FEATURES.map((f) => f.properties));
const shownGroupsOf = (shown: string[]) => buildingGroups.filter((g) => shown.includes(g.id));
const PITCH_3D = 55;
const sheetApplied = applySheet(IITB_BUILDINGS, IITB_FOOD);

const askName = () => window.prompt("Building name")?.trim() || null;

function applyShown(map: maplibregl.Map, shown: string[]) {
  const groups = shownGroupsOf(shown);
  filterBuildings(map, groups.length === buildingGroups.length ? null : groups.flatMap((g) => g.names));
  setFoodLabelsVisible(map, shown.includes("food"));
  setFoodHighlight(map, isFoodOnly(shown));
}

/** Chromium's beforeinstallprompt event; not in the DOM typings. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
}
// iOS installs only via Safari's Share menu
const STANDALONE =
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const UA = navigator.userAgent;
// Safari has no install prompt
const INSTALL_HINT = STANDALONE
  ? null
  : /iPhone|iPad|iPod/.test(UA)
    ? "Tap Share, then Add to Home Screen."
    : /Macintosh/.test(UA) && /Safari/.test(UA) && !/Chrome|Chromium|Edg|Firefox/.test(UA)
      ? "In Safari, choose File, then Add to Dock."
      : null;

// the service worker serves saved tiles, and it runs in production builds only
const OFFLINE_OK = "caches" in window && "serviceWorker" in navigator && !import.meta.env.DEV;

const isFoodOnly = (shown: string[]) => shown.length === 1 && shown[0] === "food";

// the URL the page opened with: a shared link names a place or a route
const START_URL = new URL(window.location.href);

// Opened via a /b/<slug>/ share page: that place is the destination.
const sharedPlace = (() => {
  const slug = slugFromPathname(window.location.pathname);
  return slug ? PLACE_NAMES.find((name) => buildingSlug(name) === slug) : undefined;
})();

interface RouteState {
  routes: Route[];
  selectedIndex: number;
}

const unknownPlace = (value: string) => `No place called "${value.trim()}". Pick one from the list, or type a DIGIPIN.`;

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Start is a ringed dot and the destination a pin, so they differ in shape as well as colour; the theme effect sets the colours. */
function setMarker(map: maplibregl.Map, marker: maplibregl.Marker | null, coords: [number, number], kind: "start" | "end", name: string): maplibregl.Marker {
  if (marker) {
    marker.setLngLat(coords);
  } else {
    const element = Object.assign(document.createElement("div"), { className: `${kind}-marker` });
    if (kind === "end") element.append(document.createElement("span"));
    marker = new MapLibre.Marker({ element, anchor: kind === "end" ? "bottom" : "center" }).setLngLat(coords).addTo(map);
  }
  const el = marker.getElement();
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", `${kind === "start" ? "Start" : "Destination"}: ${name}`);
  return marker;
}

type ThemePref = "system" | "light" | "dark";
// key shared with the inline script in index.html
const THEME_KEY = "iitbmap-theme";
const DARK_QUERY = window.matchMedia("(prefers-color-scheme: dark)");

function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    // storage blocked: fall back to the system theme
  }
  return "system";
}

function writeThemePref(pref: ThemePref): void {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // storage blocked: the choice lasts for this visit only
  }
}

// alternatives in the theme's routeAlt, which keeps 4:1 against the campus green
function routeColor(dark: boolean): maplibregl.ExpressionSpecification {
  const c = PALETTE[dark ? "dark" : "light"];
  return ["case", ["get", "selected"], c.route, c.routeAlt];
}

// map.setStyle() wipes custom sources/layers, so this is called from both the
// route-sync effect and the style.load handler (the tile/glyph-URL "Apply" path
// still rebuilds the whole style). Dark mode uses setCampusTheme() instead, which
// doesn't call setStyle(), so it doesn't need this.

function drawRouteLayer(map: maplibregl.Map, routes: Route[], selectedIndex: number) {
  const features = routes
    .map((route, i) => ({ route, selected: i === selectedIndex }))
    .sort((a, b) => Number(a.selected) - Number(b.selected))
    // endpoint-to-road legs follow no mapped path
    .flatMap(({ route: { coordinates: c }, selected }): GeoJSON.Feature<GeoJSON.LineString>[] =>
      [
        { leg: true, coordinates: c.slice(0, 2) },
        { leg: true, coordinates: c.slice(-2) },
        { leg: false, coordinates: c.slice(1, -1) },
      ].map(({ leg, coordinates }) => ({
        type: "Feature",
        properties: { selected, leg },
        geometry: { type: "LineString", coordinates },
      })),
    );
  const data: GeoJSON.FeatureCollection<GeoJSON.LineString> = { type: "FeatureCollection", features };

  const source = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(data);
  } else {
    map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data });
    const paint = {
      "line-color": routeColor(document.documentElement.classList.contains("dark")),
      "line-width": ["case", ["get", "selected"], 5, 3],
      "line-opacity": ["case", ["get", "selected"], 0.9, 0.6],
    } satisfies maplibregl.LineLayerSpecification["paint"];
    map.addLayer({
      id: ROUTE_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      filter: ["!", ["get", "leg"]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint,
    });
    map.addLayer({
      id: ROUTE_LEG_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      filter: ["get", "leg"],
      paint: { ...paint, "line-dasharray": [0.5, 1.5] },
    });
  }
}

function openFoodPopup(map: maplibregl.Map, props: FoodProps, at: [number, number]) {
  new MapLibre.Popup({ maxWidth: "240px", focusAfterOpen: false }).setLngLat(at).setDOMContent(foodPopup(props)).addTo(map);
}

function LabeledInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function DigipinHint({ label, place }: { label: string; place: [number, number] | null | undefined }) {
  if (!place) return null;
  return (
    <p className="-mt-1 px-1 text-xs text-muted-foreground">
      {label} · DIGIPIN <span className="font-mono select-all">{encodeDigipin(place)}</span>
    </p>
  );
}

// panel starts open and routes fit beside it from this width up
const WIDE_SCREEN = "(min-width: 640px)";
// phones fold the panel after routing, upright or on their side
const FOLD_SCREEN = "(max-width: 639px), (max-height: 500px)";
const FIT_PADDING = 48;
const NEW_ISSUE_URL = "https://github.com/iitb-oss/iitbmap/issues/new";

// a building's centroid can sit this far inside it
const ARRIVE_M = 30;
// beyond this the fix can't place you on the right path
const ROUGH_FIX_M = 50;
// the glyphs the labels use: Latin and general punctuation
const GLYPH_RANGES = ["0-255", "8192-8447"];

export default function App() {
  const mapContainerRef = React.useRef<HTMLElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  // isStyleLoaded() stays false until every tile loads
  const styleReadyRef = React.useRef(false);
  const fromMarkerRef = React.useRef<maplibregl.Marker | null>(null);
  const toMarkerRef = React.useRef<maplibregl.Marker | null>(null);
  const geolocateRef = React.useRef<maplibregl.GeolocateControl | null>(null);
  const [mapReady, setMapReady] = React.useState(false);
  const lastRoutedFixRef = React.useRef<{ at: [number, number]; to: string; profile: RoutingProfile } | null>(null);
  // autofill "from" once per destination, so clearing it sticks
  const autoFromForRef = React.useRef<string | null>(null);

  const [themePref, setThemePref] = React.useState<ThemePref>(readThemePref);
  const [systemDark, setSystemDark] = React.useState(() => DARK_QUERY.matches);
  const dark = themePref === "system" ? systemDark : themePref === "dark";

  React.useEffect(() => {
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    DARK_QUERY.addEventListener("change", onChange);
    return () => DARK_QUERY.removeEventListener("change", onChange);
  }, []);

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    const c = PALETTE[dark ? "dark" : "light"];
    for (const [name, value] of [["--marker-line", c.route], ["--marker-pin", c.pin], ["--marker-fill", c.markerFill]]) {
      document.documentElement.style.setProperty(name, value);
    }
    const map = mapRef.current;
    if (map && styleReadyRef.current) setCampusTheme(map, dark);
    for (const id of [ROUTE_LAYER_ID, ROUTE_LEG_LAYER_ID]) if (map?.getLayer(id)) map.setPaintProperty(id, "line-color", routeColor(dark));
  }, [dark]);
  const [shown, setShown] = React.useState(SHOW_ALL);
  const listGroups = React.useMemo(() => shownGroupsOf(shown), [shown]); // stable, so BuildingList's memo holds
  const [buildings3d, setBuildings3dOn] = React.useState(true);
  const [tileUrlDraft, setTileUrlDraft] = React.useState(() =>
    import.meta.env.DEV && import.meta.env.VITE_LOCAL_TILES ? `${window.location.origin}/tiles/{z}/{x}/{y}.pbf` : "",
  );
  const [glyphsUrlDraft, setGlyphsUrlDraft] = React.useState(() => (import.meta.env.DEV ? "/fonts/{fontstack}/{range}.pbf" : ""));

  const [fromValue, setFromValue] = React.useState("");
  const [toValue, setToValue] = React.useState(sharedPlace ?? START_URL.searchParams.get("to") ?? "");
  const [myLocation, setMyLocation] = React.useState<[number, number] | null>(null);
  const [accuracy, setAccuracy] = React.useState(0);
  // a denied permission disables MapLibre's button without an error event
  const [geoDenied, setGeoDenied] = React.useState(false);
  React.useEffect(() => {
    let stop = () => {};
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((status) => {
        const update = () => setGeoDenied(status.state === "denied");
        update();
        status.addEventListener("change", update);
        stop = () => status.removeEventListener("change", update);
      })
      .catch(() => {}); // no Permissions API: the error event still covers failures
    return () => stop();
  }, []);
  const [profile, setProfile] = React.useState<RoutingProfile>("walk");
  const [routeState, setRouteState] = React.useState<RouteState>({ routes: [], selectedIndex: 0 });
  const selectedRoute = routeState.routes[routeState.selectedIndex];
  const [routing, setRouting] = React.useState<Awaited<typeof routingModule> | null>(null);
  React.useEffect(() => {
    routingModule.then(setRouting);
  }, []);
  const steps = React.useMemo(
    () => (selectedRoute && routing ? routing.routeSteps(selectedRoute, toValue.trim()) : []),
    [selectedRoute, routing, toValue],
  );
  const [error, setError] = React.useState("");
  const [linkCopied, setLinkCopied] = React.useState(false);
  const [manualLink, setManualLink] = React.useState("");
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [directions, setDirections] = React.useState(false);
  // phones fold the panel to a one-line summary so the route stays visible
  const [collapsed, setCollapsed] = React.useState(false);
  const foldOnPhone = () => {
    if (window.matchMedia(FOLD_SCREEN).matches) setCollapsed(true);
  };
  const compact = collapsed && directions && routeState.routes.length > 0;
  const [editing, setEditing] = React.useState(false);
  const [drawing, setDrawing] = React.useState<[number, number][] | null>(null);
  const [edits, setEdits] = React.useState<MapEdits>(() => (EDIT_ENABLED ? loadEdits() : IITB_EDITS));
  const [editHistory, setEditHistory] = React.useState<MapEdits[]>([]);

  const commitEdits = (next: MapEdits) => {
    setEditHistory((h) => [...h, edits]);
    setEdits(next);
    saveEdits(next);
  };
  const undoEdit = () => {
    const prev = editHistory.at(-1);
    if (!prev) return;
    setEditHistory((h) => h.slice(0, -1));
    setEdits(prev);
    saveEdits(prev);
  };
  const addBuilding = (geometry: GeoJSON.Polygon, building: string) => {
    const name = askName();
    if (name) commitEdits({ ...edits, added: [...edits.added, { type: "Feature", properties: { name, building }, geometry }] });
  };
  const pinLabel = (name: string, at: [number, number] | null) => {
    const { [name]: _, ...pins } = edits.pins;
    commitEdits({ ...edits, pins: at ? { ...pins, [name]: at } : pins });
  };
  const moveFood = (name: string, at: [number, number] | null) => {
    const { [name]: _, ...food } = edits.food ?? {};
    commitEdits({ ...edits, food: at ? { ...food, [name]: at } : food });
  };
  const finishDrawing = () => {
    if (!drawing || drawing.length < 3) return;
    addBuilding({ type: "Polygon", coordinates: [[...drawing, drawing[0]]] }, "yes");
    setDrawing(null);
  };

  const applyStyleOverrides = () => {
    const map = mapRef.current;
    if (!map) return;
    try {
      setError("");
      const style = getCampusStyle({ dark, tileUrl: tileUrlDraft || undefined, glyphsUrl: glyphsUrlDraft || undefined });
      styleReadyRef.current = false;
      // a diffed setStyle skips style.load, which redraws the route
      map.setStyle(style, { diff: false });
    } catch (err) {
      setError(toErrorMessage(err));
    }
  };

  const fromIsMe = fromValue.trim() === MY_LOCATION_LABEL;
  const fromPlace = fromIsMe ? myLocation : resolvePlace(fromValue);
  const toPlace = resolvePlace(toValue);
  const appBase = new URL(import.meta.env.BASE_URL, window.location.origin);
  const sharedRoute = (routeIndex: number): SharedRoute => ({ from: fromValue.trim(), to: toValue.trim(), profile, routeIndex });

  const pushRouteUrl = (routeIndex: number) => {
    window.history.pushState(null, "", routeLink(appBase, sharedRoute(routeIndex)));
  };

  // route links use the share Worker when configured, so the preview shows the route
  const shareUrl = () => {
    const worker = import.meta.env.VITE_SHARE_URL;
    if (routeState.routes.length === 0) {
      if (findPlaceCentroid(toValue)) return new URL(buildingPath(toValue.trim()), appBase).href;
      if (!decodeDigipin(toValue)) return appBase.href;
      const pin = new URL(appBase);
      pin.searchParams.set("to", toValue.trim());
      return pin.href;
    }
    const route = sharedRoute(routeState.selectedIndex);
    return (worker ? writeSharedRoute(new URL("r", worker), route) : routeLink(appBase, route)).href;
  };

  // GitHub's new-issue form, filled with this page's link; a shown route titles it
  const issueLink = () => {
    const url = new URL(NEW_ISSUE_URL);
    if (routeState.routes.length > 0) {
      url.searchParams.set("title", `Wrong route: ${fromIsMe ? MY_LOCATION_LABEL : fromValue.trim()} → ${toValue.trim()} (${profile})`);
    }
    url.searchParams.set("body", `**What's wrong?**\n\n\n**Link:** ${shareUrl()}\n**Browser:** ${navigator.userAgent}`);
    return url.href;
  };

  const shareLink = async () => {
    const url = shareUrl();
    // phones get the share sheet (WhatsApp, Messages...)
    if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title: document.title, url });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // clipboard refused (page not focused, or blocked): hand the link over to copy by hand
      setManualLink(url);
    }
  };

  const computeRoute = (routeIndex: number, { pushUrl, fit }: { pushUrl: boolean; fit: boolean }) => {
    const map = mapRef.current;
    if (!map) return;
    setError("");

    const to = toPlace;
    if (!fromPlace) {
      if (!fromIsMe) setError(unknownPlace(fromValue)); // waiting for a GPS fix isn't an error
      return;
    }
    if (!to) {
      setError(unknownPlace(toValue));
      return;
    }

    if (!routing) return; // the effects re-run once it loads
    const found = routing.findRoutes(fromPlace, to, profile, 3);
    if (found.length === 0) {
      setRouteState((s) => ({ ...s, routes: [] }));
      setError(profile === "drive" ? "No road for cars reaches there. Try Walk." : "No mapped path connects these two places.");
      return;
    }

    const nextIndex = Math.min(routeIndex, found.length - 1);
    setRouteState({ routes: found, selectedIndex: nextIndex });
    if (pushUrl) pushRouteUrl(nextIndex);
    if (!(document.activeElement instanceof HTMLInputElement)) foldOnPhone();

    fromMarkerRef.current = setMarker(map, fromMarkerRef.current, fromPlace, "start", fromIsMe ? "your location" : fromValue.trim());
    toMarkerRef.current = setMarker(map, toMarkerRef.current, to, "end", toValue.trim());

    // after the panel folds, so the fit uses the space it frees
    if (fit) requestAnimationFrame(() => fitClear(map, found.flatMap((r) => r.coordinates)));
  };

  /** Fits the points in the map area the panel and the building list leave visible. */
  const fitClear = (map: maplibregl.Map, coords: [number, number][]) => {
    const bounds = coords.reduce((b, c) => b.extend(c), new MapLibre.LngLatBounds(coords[0], coords[0]));
    const wide = window.matchMedia(WIDE_SCREEN).matches;
    const panel = panelRef.current?.getBoundingClientRect();
    // the panel sits beside the map when wide, over its top otherwise
    const panelRight = wide ? (panel?.right ?? 0) : 0;
    const panelBottom = wide ? 0 : (panel?.bottom ?? 0);
    const listLeft = wide ? document.getElementById("building-list")?.getBoundingClientRect().left : undefined;
    const listWidth = listLeft === undefined ? 0 : window.innerWidth - listLeft;
    map.fitBounds(bounds, {
      padding: { top: panelBottom + FIT_PADDING, right: listWidth + FIT_PADDING, bottom: FIT_PADDING, left: panelRight + FIT_PADDING },
    });
  };

  const changeShown = (next: string[]) => {
    setShown(next);
    const map = mapRef.current;
    if (map && styleReadyRef.current) applyShown(map, next);
  };
  const foodOnly = isFoodOnly(shown);
  const toggleFood = () => {
    changeShown(foodOnly ? SHOW_ALL : ["food"]);
    const map = mapRef.current;
    if (foodOnly || !map) return;
    // after the food list opens, so the fit clears it
    requestAnimationFrame(() => fitClear(map, FOOD_FEATURES.map((f) => f.geometry.coordinates as [number, number])));
  };
  const pickFood = (name: string) => {
    setToValue(name);
    const f = IITB_FOOD.features.find((f) => f.properties.name === name);
    if (f && mapRef.current) openFoodPopup(mapRef.current, f.properties, f.geometry.coordinates as [number, number]);
  };

  // a recompute after a style reload keeps the selected route
  const recomputeRoute = () => computeRoute(routeState.selectedIndex, { pushUrl: false, fit: true });

  const clearRoute = () => {
    setRouteState({ routes: [], selectedIndex: 0 });
    fromMarkerRef.current?.remove();
    toMarkerRef.current?.remove();
    fromMarkerRef.current = null;
    toMarkerRef.current = null;
  };

  // clear From too, or style.load re-routes
  const exitDirections = () => {
    setDirections(false);
    setCollapsed(false);
    setFromValue("");
    clearRoute();
  };

  // Bridges into MapLibre's persistent `style.load` listener, which is registered once
  // and would otherwise only ever see the state from the render it was created in.
  const latest = { fromValue, toValue, routeState, shown, buildings3d, recomputeRoute, dark, editing, drawing, pinLabel, addBuilding, moveFood };
  const latestRef = React.useRef(latest);
  latestRef.current = latest;

  React.useEffect(() => {
    let cancelled = false;
    let removeMap = () => {};
    maplibreModule.then((mod) => {
      if (cancelled) return;
      // the UMD build arrives as the module's default export
      MapLibre = mod.default ?? mod;
      if (!mapContainerRef.current) return;
      let style;
      try {
        style = getCampusStyle({ dark, tileUrl: tileUrlDraft || undefined, glyphsUrl: glyphsUrlDraft || undefined });
      } catch (err) {
        setError(toErrorMessage(err));
        return;
      }

      const sharedCentroid = sharedPlace ? findPlaceCentroid(sharedPlace) : undefined;
      const map = new MapLibre.Map({
        container: mapContainerRef.current,
        style,
        center: sharedCentroid ?? CAMPUS_CENTER,
        zoom: sharedCentroid ? 17 : 16,
        pitch: buildings3d ? PITCH_3D : 0,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        maxBounds: CAMPUS_MAX_BOUNDS,
      });
      mapRef.current = map;
      removeMap = () => map.remove();
      // load-time marks
      performance.mark("map-created");
      map.once("idle", () => performance.mark("map-idle"));
      registerCampusImages(map);
      // layer listeners outlive setStyle, so register once
      for (const id of [FOOD_DOT_LAYER_ID, FOOD_LABEL_LAYER_ID]) {
        map.on("click", id, (e) => {
          const f = e.features?.[0];
          if (!f || f.geometry.type !== "Point" || latestRef.current.editing) return; // edit mode drags it
          const props = f.properties as FoodProps;
          setToValue(props.name); // the Share button then copies its link
          openFoodPopup(map, props, f.geometry.coordinates as [number, number]);
        });
        map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
      }
      if (EDIT_ENABLED) {
        installEditor(map, {
          state: () => latestRef.current,
          pin: (name, at) => latestRef.current.pinLabel(name, at),
          moveFood: (name, at) => latestRef.current.moveFood(name, at),
          addVertex: (at) => setDrawing((d) => [...(d ?? []), at]),
          nameBuilding: (geometry, building) => latestRef.current.addBuilding(geometry, building),
        });
      }
      // narrow screens open compact attribution expanded over the map; collapse it after MapLibre's resize handler
      const collapseAttribution = () => {
        const attrib = map.getContainer().querySelector(".maplibregl-ctrl-attrib.maplibregl-compact");
        attrib?.removeAttribute("open");
        attrib?.classList.remove("maplibregl-compact-show");
      };
      map.once("load", collapseAttribution);
      map.on("resize", collapseAttribution);
      if (sharedCentroid) toMarkerRef.current = setMarker(map, null, sharedCentroid, "end", sharedPlace!);

      const geolocate = new MapLibre.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      });
      map.addControl(geolocate, "bottom-right");
      geolocate.on("geolocate", (pos: GeolocationPosition) => {
        setMyLocation([pos.coords.longitude, pos.coords.latitude]);
        setAccuracy(pos.coords.accuracy);
      });
      // MapLibre labels these markers without a role; it makes them once, on the first fix
      geolocate.once("geolocate", () => {
        const dot = map.getContainer().querySelector(".maplibregl-user-location-dot");
        dot?.setAttribute("role", "img");
        dot?.setAttribute("aria-label", "Your location");
        map.getContainer().querySelector(".maplibregl-user-location-accuracy-circle")?.setAttribute("aria-hidden", "true");
      });
      geolocate.on("error", () => {
        if (latestRef.current.fromValue.trim() === MY_LOCATION_LABEL) setError("Can't get your location. Allow location access, or type where you are in From.");
      });
      geolocateRef.current = geolocate;
      map.on("dragstart", foldOnPhone);
      // right-click, or a long press: iOS Safari fires no contextmenu
      const dropPin = (at: maplibregl.LngLat) => {
        if (latestRef.current.editing || !inCampusBbox(at.lat, at.lng)) return;
        navigator.vibrate?.(10);
        setToValue(encodeDigipin([at.lng, at.lat]));
      };
      map.on("contextmenu", (e) => dropPin(e.lngLat));
      let press: ReturnType<typeof setTimeout> | undefined;
      map.on("touchstart", (e) => {
        clearTimeout(press);
        if (e.originalEvent.touches.length === 1) press = setTimeout(() => dropPin(e.lngLat), 500);
      });
      for (const type of ["touchend", "touchcancel", "movestart"] as const) map.on(type, () => clearTimeout(press));
      // Auto-track only on campus: off campus the camera would follow the user off the map.
      map.once("load", () => {
        // tracking would pull the camera off a shared place or route; the location button still starts it
        if ((sharedPlace || START_URL.searchParams.has("to")) && readSharedRoute(START_URL)?.from !== MY_LOCATION_LABEL) return;
        navigator.geolocation?.getCurrentPosition(
          (pos) => {
            if (inCampusBbox(pos.coords.latitude, pos.coords.longitude)) geolocate.trigger();
          },
          () => {}, // denied/unavailable: the control's button still lets the user retry
          { enableHighAccuracy: true },
        );
      });

      // `setStyle()` replaces layers, so restore visibility/route on every load. A
      // URL-specified route (from/to populated, not yet resolved into routes) is
      // re-requested here rather than redrawn, since it hasn't been computed yet.
      map.on("style.load", () => {
        styleReadyRef.current = true;
        const current = latestRef.current;
        applyShown(map, current.shown);
        setBuildings3d(map, current.buildings3d);
        setCampusTheme(map, current.dark); // the theme may have changed while the style loaded
        if (current.drawing) drawDraft(map, current.drawing);
        if (current.fromValue.trim() && current.toValue.trim() && current.routeState.routes.length === 0) {
          current.recomputeRoute();
        } else if (current.routeState.routes.length > 0) {
          drawRouteLayer(map, current.routeState.routes, current.routeState.selectedIndex);
        }
      });
      map.on("error", (e) => {
        // offline, unsaved tiles fail one by one; one message covers them
        if (!navigator.onLine && "sourceId" in e) setError("You're offline, so parts of the map you haven't saved stay blank.");
        else {
          console.warn("iitbmap: map error", e.error ?? e);
          setError("Part of the map didn't load. Check your connection, then reload the page.");
        }
      });

      setMapReady(true);
    });

    return () => {
      cancelled = true;
      removeMap();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the bundled snapshot stays if the sheet fails
  const [buildingStoreys, setBuildingStoreys] = React.useState(storeysByName);
  // re-read when the sheet lands, which patches hours and apps alongside storeys
  const foodDetails = React.useMemo(
    () => new Map(IITB_FOOD.features.map(({ properties: p }) => [p.name, [p.hours, p.app].filter(Boolean).join(" · ")])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buildingStoreys],
  );
  React.useEffect(() => {
    sheetApplied.then(() => {
      if (mapRef.current) refreshCampusSources(mapRef.current);
      setBuildingStoreys(storeysByName());
    }, (err) => console.warn("iitbmap: sheet not loaded", err));
  }, []);

  React.useEffect(() => {
    if (!EDIT_ENABLED) return;
    applyMapEdits(edits);
    if (mapRef.current) refreshCampusSources(mapRef.current);
    setBuildingStoreys(storeysByName());
  }, [edits]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (map && styleReadyRef.current) drawDraft(map, drawing);
  }, [drawing]);

  // Route layer sync: the single place that draws `routeState` onto the map in response
  // to state changes. `style.load` separately redraws the same way after a style reload
  // (see above), since setStyle() wipes what this effect doesn't recreate on its own.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    drawRouteLayer(map, routeState.routes, routeState.selectedIndex);
  }, [routeState]);

  React.useEffect(() => {
    function restoreFromUrl(): boolean {
      const shared = readSharedRoute(new URL(window.location.href));
      if (!shared) return false;
      setDirections(true);
      setFromValue(shared.from);
      setToValue(shared.to);
      setProfile(shared.profile);
      setRouteState((s) => ({ ...s, selectedIndex: shared.routeIndex }));
      return true;
    }

    restoreFromUrl();

    function onPopState() {
      if (!restoreFromUrl()) {
        exitDirections();
        return;
      }
      // the route effect re-routes after render, or style.load if the style is loading
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // live directions from the GPS fix; only the first route fits the camera, so later fixes don't fight panning
  React.useEffect(() => {
    if (!directions || !myLocation || !inCampusBbox(myLocation[1], myLocation[0]) || !toPlace) return;
    if (!fromValue.trim() && autoFromForRef.current !== toValue) {
      autoFromForRef.current = toValue;
      setFromValue(MY_LOCATION_LABEL);
      return;
    }
    if (!fromIsMe || !styleReadyRef.current) return;
    // skip GPS jitter; k-shortest-paths is too slow to rerun per fix
    const last = lastRoutedFixRef.current;
    if (routeState.routes.length > 0 && last?.to === toValue && last.profile === profile && haversineMeters(last.at, myLocation) < 10) return;
    lastRoutedFixRef.current = { at: myLocation, to: toValue, profile };
    computeRoute(routeState.selectedIndex, { pushUrl: false, fit: routeState.routes.length === 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directions, myLocation, fromValue, toValue, profile, routing]);

  // a shown route always matches From, To and the profile; the GPS effect owns "my location"
  React.useEffect(() => {
    if (!directions || fromIsMe || !styleReadyRef.current) return;
    if (!fromPlace || !toPlace) {
      if (routeState.routes.length > 0) clearRoute();
      return;
    }
    // typing "Hostel 1" on the way to "Hostel 12" would route and push history per exact match
    const timer = setTimeout(() => {
      // back/forward: the URL already names this route and index
      const shared = readSharedRoute(new URL(window.location.href));
      const restored = shared?.from === fromValue.trim() && shared.to === toValue.trim() && shared.profile === profile;
      if (restored) computeRoute(shared.routeIndex, { pushUrl: false, fit: true });
      else computeRoute(0, { pushUrl: true, fit: true });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directions, profile, fromValue, toValue, routing]);

  // computeRoute owns the camera in directions mode
  React.useEffect(() => {
    const map = mapRef.current;
    if (directions || !map || !toPlace) return;
    toMarkerRef.current = setMarker(map, toMarkerRef.current, toPlace, "end", toValue.trim());
    map.flyTo({ center: toPlace, zoom: Math.max(map.getZoom(), 17) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toValue, directions, mapReady]);

  // Service worker registration, production only (avoids fighting Vite's dev HMR).
  React.useEffect(() => {
    if (!import.meta.env.DEV && "serviceWorker" in navigator) {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
    }
  }, []);

  // drives the header Install button; Chromium's own install banner still shows
  const [installPrompt, setInstallPrompt] = React.useState<InstallPromptEvent | null>(null);
  const [installHintOpen, setInstallHintOpen] = React.useState(false);
  React.useEffect(() => {
    const onPrompt = (e: Event) => setInstallPrompt(e as InstallPromptEvent);
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const [places, setPlaces] = React.useState(loadPlaces);
  const updatePlaces = (change: (p: typeof places) => typeof places) =>
    setPlaces((p) => {
      const next = change(p);
      storePlaces(next);
      return next;
    });
  const toName = findPlace(toValue)?.properties?.name as string | undefined;
  // after a pause, so names passed while typing aren't kept
  React.useEffect(() => {
    if (!toName) return;
    const timer = setTimeout(() => updatePlaces((p) => addRecent(p, toName)), 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toName]);
  const isSaved = !!toName && places.saved.includes(toName);
  const quickPlaces = [...new Set([...places.saved, ...places.recent])].filter((n) => findPlace(n)).slice(0, 6);

  // live guidance: the GPS effect re-routes from each fix, so steps[1] is the next turn
  const guiding = directions && fromIsMe && myLocation && selectedRoute ? myLocation : null;
  const arrived = !!guiding && !!toPlace && haversineMeters(guiding, toPlace) < ARRIVE_M;
  const toNextTurn = guiding && steps.length > 1 ? haversineMeters(guiding, steps[1].at) : null;
  const arrivedText = `You've arrived at ${toValue.trim()}`;
  React.useEffect(() => {
    if (arrived) navigator.vibrate?.([100, 50, 100]);
  }, [arrived]);

  const [offline, setOffline] = React.useState("");
  const saveForOffline = async () => {
    const map = mapRef.current;
    if (!map) return;
    // what the live style fetches: its tile source, and the glyphs of every font stack it uses
    const style = map.getStyle();
    const source = style.sources[CAMPUS_SOURCE_ID] as maplibregl.VectorSourceSpecification;
    const tileUrl = source.tiles![0];
    const stacks = new Set(
      style.layers.flatMap((l) => {
        const font = l.type === "symbol" ? l.layout?.["text-font"] : undefined;
        return Array.isArray(font) && font.every((f) => typeof f === "string") ? [font.join(",")] : [];
      }),
    );
    const bounds = map.getMaxBounds()!;
    const urls = [
      ...tilesIn([bounds.getSouthWest().toArray(), bounds.getNorthEast().toArray()], source.minzoom ?? MIN_ZOOM, source.maxzoom ?? MAX_ZOOM).map(
        ([z, x, y]) => tileUrl.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)),
      ),
      ...[...stacks].flatMap((stack) => GLYPH_RANGES.map((range) => style.glyphs!.replace("{fontstack}", stack).replace("{range}", range))),
    ];
    if (!navigator.onLine) {
      setOffline("You're offline. Connect to the internet to save the map.");
      return;
    }
    setOffline("Saving…");
    try {
      await saveOffline(urls, (done, total) => setOffline(`Saving… ${Math.round((done / total) * 100)}%`));
      setOffline("Saved. The map now works without a connection.");
    } catch (err) {
      setOffline(err instanceof DOMException && err.name === "QuotaExceededError" ? "This device is out of storage space." : toErrorMessage(err));
    }
  };

  // "/" focuses search
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key !== "/" || typing || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      setCollapsed(false);
      requestAnimationFrame(() => document.getElementById("toInput")?.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function useMyLocation() {
    setError("");
    setFromValue(MY_LOCATION_LABEL);
    if (!myLocation) geolocateRef.current?.trigger();
  }

  return (
    <>
      <Card
        ref={panelRef}
        role="region"
        aria-label="Search and directions"
        className="absolute z-10 w-[min(320px,calc(100vw-24px))] gap-0 overflow-y-auto rounded-lg p-3 shadow-[var(--float-shadow)]"
        style={{
          top: "max(12px, env(safe-area-inset-top))",
          left: "max(12px, env(safe-area-inset-left))",
          maxHeight: "calc(100dvh - max(24px, env(safe-area-inset-top) + env(safe-area-inset-bottom) + 24px))",
        }}
      >
        <CardContent className="flex flex-col gap-3 p-0">
          <div className="flex items-center gap-2">
            {/* blue on transparent; the white backing keeps it legible in dark mode */}
            <img src={`${import.meta.env.BASE_URL}iitb-logo.svg`} alt="IIT Bombay logo" className="size-9 shrink-0 rounded-md bg-white p-0.5" />
            <span className="min-w-0 flex-1 text-sm font-semibold leading-tight break-words">IIT Bombay Campus Map</span>
            {(installPrompt || INSTALL_HINT) && (
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                title="Install app"
                aria-label="Install app"
                aria-expanded={installPrompt ? undefined : installHintOpen}
                onClick={() => (installPrompt ? installPrompt.prompt().then(() => setInstallPrompt(null)) : setInstallHintOpen((o) => !o))}
              >
                <Download className="size-4" />
              </Button>
            )}
            {directions && (
              <Button variant="ghost" size="icon" className="shrink-0" title="Close directions" aria-label="Close directions" onClick={exitDirections}>
                <X className="size-4" />
              </Button>
            )}
          </div>
          {installHintOpen && INSTALL_HINT && (
            <p role="status" className="text-sm text-muted-foreground">
              Install the map as an app: {INSTALL_HINT}
            </p>
          )}
          {guiding && (arrived || toNextTurn !== null) && (
            <p className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
              {arrived ? arrivedText : `${steps[1].text} in ${Math.round(toNextTurn! / 10) * 10} m`}
              {accuracy > ROUGH_FIX_M && <span className="block text-xs font-normal">GPS is rough here (±{Math.round(accuracy)} m)</span>}
            </p>
          )}
          {/* announces turns; distance updates stay silent */}
          <p role="status" className="sr-only">
            {guiding ? (arrived ? arrivedText : steps[1]?.text) : ""}
          </p>
          {compact && selectedRoute && (
            <button
              type="button"
              className="flex min-h-11 items-center gap-2 rounded-md border px-3 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              aria-expanded={false}
              onClick={() => setCollapsed(false)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {fromIsMe ? "Your location" : fromValue.trim()} → {toValue.trim()}
                </span>
                <span className="block text-xs text-muted-foreground">{formatRouteInfo(selectedRoute, profile)}</span>
              </span>
              <ChevronDown className="size-4 shrink-0" aria-hidden />
              <span className="sr-only">Edit route</span>
            </button>
          )}
          {!compact && directions && (
            <div className="flex items-center gap-2">
              <BuildingCombobox
                id="fromInput"
                value={fromValue}
                onValueChange={setFromValue}
                buildingNames={PLACE_NAMES}
                placeholder="From (building, DIGIPIN, my location)"
                className="flex-1"
              />
              {/* To accepts only places */}
              <Button
                variant="outline"
                size="icon"
                title="Swap From and To"
                aria-label="Swap From and To"
                disabled={fromIsMe || !fromValue.trim() || !toValue.trim()}
                onClick={() => {
                  setFromValue(toValue);
                  setToValue(fromValue);
                }}
              >
                <ArrowUpDown className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                title="Use my current location"
                aria-label="Use my current location"
                onClick={useMyLocation}
              >
                <MapPin className="size-4" />
              </Button>
            </div>
          )}
          {!compact && (
            <>
              <div className="flex items-center gap-2">
                <BuildingCombobox
                  id="toInput"
                  value={toValue}
                  onValueChange={setToValue}
                  buildingNames={PLACE_NAMES}
                  placeholder={directions ? "To (building or DIGIPIN)" : "Search buildings"}
                  className="flex-1"
                />
                {toName && (
                  <Button
                    variant="ghost"
                    size="icon"
                    title={isSaved ? "Remove from saved places" : "Save place"}
                    aria-label="Save place"
                    aria-pressed={isSaved}
                    onClick={() => updatePlaces((p) => toggleSaved(p, toName))}
                  >
                    <Star className={isSaved ? "size-4 fill-current" : "size-4"} />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  title="Settings"
                  aria-label="Settings"
                  aria-expanded={settingsOpen}
                  onClick={() => setSettingsOpen((o) => !o)}
                >
                  <Settings className="size-4" />
                </Button>
              </div>

              {!toValue.trim() && quickPlaces.length > 0 && (
                <ul aria-label="Saved and recent places" className="flex flex-wrap gap-1.5">
                  {quickPlaces.map((name) => (
                    <li key={name} className="max-w-full">
                      <Button variant="outline" size="sm" className="max-w-full" onClick={() => setToValue(name)}>
                        {places.saved.includes(name) ? <Star className="size-3.5 fill-current" aria-label="Saved" /> : <Clock className="size-3.5" aria-label="Recent" />}
                        <span className="truncate">{name}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {/* a dropped pin's To already is its DIGIPIN */}
              {!decodeDigipin(toValue) && <DigipinHint label="To" place={toPlace} />}
              {directions && (
                <>
                  {fromIsMe && <DigipinHint label="You" place={myLocation} />}
                  <ToggleGroup type="single" value={profile} onValueChange={(v) => v && setProfile(v as RoutingProfile)}>
                    <ToggleGroupItem value="walk" className="flex-1">
                      <Footprints className="size-4" aria-hidden />
                      Walk
                    </ToggleGroupItem>
                    <ToggleGroupItem value="drive" className="flex-1">
                      <Car className="size-4" aria-hidden />
                      Drive
                    </ToggleGroupItem>
                  </ToggleGroup>
                </>
              )}

              {/* the panel is too narrow for three labels in a row; large text wraps further */}
              <div className="flex flex-wrap gap-2">
                {/* in directions mode the route follows From, To and Walk/Drive by itself */}
                {!directions && (
                  <Button className="basis-full" onClick={() => setDirections(true)} disabled={!toPlace}>
                    <Navigation className="size-4" />
                    Directions
                  </Button>
                )}
                <Button variant="outline" className="flex-1 px-3" onClick={shareLink} disabled={!toPlace}>
                  <Share2 className="size-4" />
                  {linkCopied ? "Link copied" : "Share"}
                </Button>
                <Button variant={foodOnly ? "default" : "outline"} className="flex-1 px-3" aria-pressed={foodOnly} title="Show only food places" onClick={toggleFood}>
                  <Utensils className="size-4" />
                  Food
                </Button>
              </div>
            </>
          )}

          {/* a link for an earlier destination would mislead */}
          {manualLink && manualLink === shareUrl() && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="shareLink" className="text-xs text-muted-foreground">
                Copy this link
              </Label>
              <Input id="shareLink" readOnly value={manualLink} autoFocus onFocus={(e) => e.currentTarget.select()} />
            </div>
          )}
          {directions && fromIsMe && !myLocation && !error && (
            <p role="status" className="px-1 text-sm text-muted-foreground">
              {geoDenied ? "Location access is off. Allow it for this site, or type where you are in From." : "Finding your location…"}
            </p>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!compact && routeState.routes.length > 0 && (
            <ToggleGroup
              type="single"
              orientation="vertical"
              value={String(routeState.selectedIndex)}
              onValueChange={(v) => {
                if (!v) return;
                const i = Number(v);
                setRouteState((s) => ({ ...s, selectedIndex: i }));
                pushRouteUrl(i);
              }}
            >
              {routeState.routes.map((route, i) => (
                <ToggleGroupItem key={i} value={String(i)}>
                  {formatRouteInfo(route, profile)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}

          {steps.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground pointer-coarse:py-3">Step-by-step</summary>
              <ol className="mt-1 flex max-h-64 flex-col overflow-y-auto">
                {steps.map((step, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className="flex w-full justify-between gap-2 rounded px-1 py-1 text-left hover:bg-accent pointer-coarse:min-h-11"
                      onClick={() => mapRef.current?.flyTo({ center: step.at, zoom: Math.max(mapRef.current.getZoom(), 17) })}
                    >
                      <span>{step.text}</span>
                      {step.distanceMeters >= 1 && (
                        <span className="shrink-0 text-muted-foreground">{Math.round(step.distanceMeters)} m</span>
                      )}
                    </button>
                  </li>
                ))}
              </ol>
            </details>
          )}

          {!compact && routeState.routes.length > 0 && (
            <a href={issueLink()} target="_blank" rel="noopener" className="self-start rounded-sm px-1 text-sm text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:py-3">
              Route wrong? Report it
            </a>
          )}

          {editing && (
            <EditPanel
              edits={edits}
              drawing={drawing}
              canUndo={editHistory.length > 0}
              onDraw={() => setDrawing([])}
              onFinish={finishDrawing}
              onCancel={() => setDrawing(null)}
              onUndo={undoEdit}
              onExport={() => downloadEdits(edits)}
              onDiscard={() => {
                saveEdits(null);
                setEdits(IITB_EDITS);
                setEditHistory([]);
              }}
              onClose={() => {
                setEditing(false);
                setDrawing(null);
              }}
            />
          )}

          {settingsOpen && (
            <>
              <Separator />
              <div className="flex flex-col gap-1">
                <Label id="theme-label" className="text-xs text-muted-foreground">
                  Theme
                </Label>
                <ToggleGroup
                  type="single"
                  aria-labelledby="theme-label"
                  value={themePref}
                  onValueChange={(v) => {
                    if (!v) return;
                    setThemePref(v as ThemePref);
                    writeThemePref(v as ThemePref);
                  }}
                >
                  <ToggleGroupItem value="system" className="flex-1">
                    System
                  </ToggleGroupItem>
                  <ToggleGroupItem value="light" className="flex-1">
                    Light
                  </ToggleGroupItem>
                  <ToggleGroupItem value="dark" className="flex-1">
                    Dark
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              <div className="flex flex-col gap-1">
                <Label id="show-label" className="text-xs text-muted-foreground">
                  Show
                </Label>
                <ToggleGroup
                  type="multiple"
                  aria-labelledby="show-label"
                  className="w-full flex-wrap gap-0.5"
                  value={shown}
                  onValueChange={changeShown}
                >
                  {SHOW_OPTIONS.map((o) => (
                    <ToggleGroupItem key={o.id} value={o.id} className="flex-1">
                      {o.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="buildings3d"
                  checked={buildings3d}
                  onCheckedChange={(v) => {
                    const next = v === true;
                    setBuildings3dOn(next);
                    const map = mapRef.current;
                    if (!map || !styleReadyRef.current) return;
                    setBuildings3d(map, next);
                    map.easeTo(next ? { pitch: PITCH_3D } : { pitch: 0, bearing: 0 });
                  }}
                />
                <Label htmlFor="buildings3d" className="flex-1 pointer-coarse:min-h-11">
                  3D buildings
                </Label>
              </div>
              {OFFLINE_OK && (
                <div className="flex flex-col gap-1">
                  <Button variant="outline" size="wrap" onClick={saveForOffline} disabled={offline.startsWith("Saving")}>
                    <CloudDownload className="size-4" />
                    Save map for offline use
                  </Button>
                  {offline && (
                    <p role="status" className="text-xs text-muted-foreground">
                      {offline}
                    </p>
                  )}
                </div>
              )}
              <Button variant="outline" size="wrap" asChild>
                <a href={issueLink()} target="_blank" rel="noopener">
                  <Flag className="size-4" />
                  Report an issue
                </a>
              </Button>
              {EDIT_ENABLED && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="editMode"
                    checked={editing}
                    onCheckedChange={(v) => {
                      setEditing(v === true);
                      setDrawing(null);
                    }}
                  />
                  <Label htmlFor="editMode" className="flex-1 pointer-coarse:min-h-11">
                    Edit mode
                  </Label>
                </div>
              )}
              {/* developer-only overrides */}
              {EDIT_ENABLED && (
                <>
                  <LabeledInput id="tileUrl" label="Tile URL template" value={tileUrlDraft} onChange={setTileUrlDraft} />
                  <LabeledInput id="glyphsUrl" label="Glyphs URL template" value={glyphsUrlDraft} onChange={setGlyphsUrlDraft} />
                  <Button onClick={applyStyleOverrides}>Apply</Button>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
      {foodOnly ? (
        <BuildingList
          key="food"
          title="Food"
          icon={Utensils}
          defaultOpen
          expanded
          groups={FOOD_GROUPS}
          details={foodDetails}
          selected={toValue.trim()}
          dark={dark}
          wideQuery={WIDE_SCREEN}
          onPick={pickFood}
        />
      ) : (
        <BuildingList key="buildings" groups={listGroups} details={buildingStoreys} selected={toValue.trim()} dark={dark} wideQuery={WIDE_SCREEN} onPick={setToValue} />
      )}
      <main id="map" ref={mapContainerRef} aria-label="Campus map" />
    </>
  );
}
