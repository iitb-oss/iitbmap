import * as React from "react";
import maplibregl from "maplibre-gl";
import { Download, MapPin, Navigation, Settings, Share2, Utensils, X } from "lucide-react";

import {
  getCampusStyle,
  setCampusTheme,
  CAMPUS_CENTER,
  CAMPUS_MAX_BOUNDS,
  MIN_ZOOM,
  MAX_ZOOM,
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
  findRoutes,
  routeSteps,
  inCampusBbox,
  applyMapEdits,
  IITB_EDITS,
  type MapEdits,
  type Route,
  type RoutingProfile,
} from "../../src/index";
import { readSharedRoute, routeLink, writeSharedRoute, type SharedRoute } from "@/lib/route-url";
import { buildingPath, buildingSlug, slugFromPathname } from "@/lib/building-url";
import { encodeDigipin } from "@/lib/digipin";
import { foodPopup } from "@/lib/food-popup";
import { applySheet } from "@/lib/sheet";
import { EDIT_ENABLED, downloadEdits, loadEdits, saveEdits } from "@/lib/edits";
import { drawDraft, installEditor } from "@/lib/editor";
import { EditPanel } from "@/components/edit-panel";
import { MARKER_COLORS, MY_LOCATION_LABEL, PLACE_NAMES, findPlaceCentroid, formatRouteInfo, resolvePlace } from "@/lib/places";
import { haversineMeters } from "../../src/routing";

import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BuildingList } from "@/components/building-list";
import { groupBuildings } from "@/lib/building-groups";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BuildingCombobox } from "@/components/building-combobox";

const ROUTE_SOURCE_ID = "demo-route";
const ROUTE_LAYER_ID = "demo-route-line";

const buildingGroups = groupBuildings(
  IITB_BUILDINGS.features.flatMap((f) => (f.properties?.name ? [{ name: f.properties.name, building: f.properties.building }] : [])),
);

// map filter chips: the building list's groups, plus food places
const SHOW_OPTIONS = [...buildingGroups.map(({ id, label }) => ({ id: id as string, label })), { id: "food", label: "Food" }];
const SHOW_ALL = SHOW_OPTIONS.map((o) => o.id);

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
const IOS_BROWSER =
  /iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator as Navigator & { standalone?: boolean }).standalone;

const isFoodOnly = (shown: string[]) => shown.length === 1 && shown[0] === "food";

// Opened via a /b/<slug>/ share page: that place is the destination.
const sharedPlace = (() => {
  const slug = slugFromPathname(window.location.pathname);
  return slug ? PLACE_NAMES.find((name) => buildingSlug(name) === slug) : undefined;
})();

interface RouteState {
  routes: Route[];
  selectedIndex: number;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function setMarker(map: maplibregl.Map, marker: maplibregl.Marker | null, coords: [number, number], color: string): maplibregl.Marker {
  if (marker) {
    marker.setLngLat(coords);
    return marker;
  }
  return new maplibregl.Marker({ color }).setLngLat(coords).addTo(map);
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

// map.setStyle() wipes custom sources/layers, so this is called from both the
// route-sync effect and the style.load handler (the tile/glyph-URL "Apply" path
// still rebuilds the whole style). Dark mode uses setCampusTheme() instead, which
// doesn't call setStyle(), so it doesn't need this.
function drawRouteLayer(map: maplibregl.Map, routes: Route[], selectedIndex: number) {
  const features = routes
    .map((route, i) => ({ route, selected: i === selectedIndex }))
    .sort((a, b) => Number(a.selected) - Number(b.selected))
    .map(
      ({ route, selected }): GeoJSON.Feature<GeoJSON.LineString> => ({
        type: "Feature",
        properties: { selected },
        geometry: { type: "LineString", coordinates: route.coordinates },
      }),
    );
  const data: GeoJSON.FeatureCollection<GeoJSON.LineString> = { type: "FeatureCollection", features };

  const source = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(data);
  } else {
    map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data });
    map.addLayer({
      id: ROUTE_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["case", ["get", "selected"], MARKER_COLORS.route, "#94a3b8"],
        "line-width": ["case", ["get", "selected"], 5, 3],
        "line-opacity": ["case", ["get", "selected"], 0.9, 0.6],
      },
    });
  }
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
const FIT_PADDING = 48;

export default function App() {
  const mapContainerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  // isStyleLoaded() stays false until every tile loads
  const styleReadyRef = React.useRef(false);
  const fromMarkerRef = React.useRef<maplibregl.Marker | null>(null);
  const toMarkerRef = React.useRef<maplibregl.Marker | null>(null);
  const geolocateRef = React.useRef<maplibregl.GeolocateControl | null>(null);
  const lastRoutedFixRef = React.useRef<{ at: [number, number]; to: string } | null>(null);

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
    const map = mapRef.current;
    if (map && styleReadyRef.current) setCampusTheme(map, dark);
  }, [dark]);
  const [shown, setShown] = React.useState(SHOW_ALL);
  const listGroups = React.useMemo(() => shownGroupsOf(shown), [shown]); // stable, so BuildingList's memo holds
  const [buildings3d, setBuildings3dOn] = React.useState(true);
  const [tileUrlDraft, setTileUrlDraft] = React.useState(() =>
    import.meta.env.DEV && import.meta.env.VITE_LOCAL_TILES ? `${window.location.origin}/tiles/{z}/{x}/{y}.pbf` : "",
  );
  const [glyphsUrlDraft, setGlyphsUrlDraft] = React.useState(() => (import.meta.env.DEV ? "/fonts/{fontstack}/{range}.pbf" : ""));

  const [fromValue, setFromValue] = React.useState("");
  const [toValue, setToValue] = React.useState(sharedPlace ?? "");
  const [myLocation, setMyLocation] = React.useState<[number, number] | null>(null);
  const [profile, setProfile] = React.useState<RoutingProfile>("walk");
  const [routeState, setRouteState] = React.useState<RouteState>({ routes: [], selectedIndex: 0 });
  const selectedRoute = routeState.routes[routeState.selectedIndex];
  const steps = React.useMemo(() => (selectedRoute ? routeSteps(selectedRoute) : []), [selectedRoute]);
  const [error, setError] = React.useState("");
  const [linkCopied, setLinkCopied] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [directions, setDirections] = React.useState(false);
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
      return findPlaceCentroid(toValue) ? new URL(buildingPath(toValue.trim()), appBase).href : appBase.href;
    }
    const route = sharedRoute(routeState.selectedIndex);
    return (worker ? writeSharedRoute(new URL("r", worker), route) : routeLink(appBase, route)).href;
  };

  const shareLink = async () => {
    const url = shareUrl();
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (err) {
      setError(`Couldn't share: ${toErrorMessage(err)}`);
    }
  };

  const computeRoute = (routeIndex: number, { pushUrl, fit }: { pushUrl: boolean; fit: boolean }) => {
    const map = mapRef.current;
    if (!map) return;
    setError("");

    const from = fromIsMe ? myLocation : resolvePlace(fromValue);
    const to = toPlace;
    if (!from) {
      setError(fromIsMe ? "Waiting for your location…" : `Unknown "from": ${fromValue}`);
      return;
    }
    if (!to) {
      setError(`Unknown "to": ${toValue}`);
      return;
    }

    const found = findRoutes(from, to, profile, 3);
    if (found.length === 0) {
      setRouteState((s) => ({ ...s, routes: [] }));
      setError("No route found between those two points.");
      return;
    }

    const nextIndex = Math.min(routeIndex, found.length - 1);
    setRouteState({ routes: found, selectedIndex: nextIndex });
    if (pushUrl) pushRouteUrl(nextIndex);

    fromMarkerRef.current = setMarker(map, fromMarkerRef.current, from, MARKER_COLORS.start);
    toMarkerRef.current = setMarker(map, toMarkerRef.current, to, MARKER_COLORS.end);

    if (fit) fitClear(map, found.flatMap((r) => r.coordinates));
  };

  /** Fits the points in the map area the panel and the building list leave visible. */
  const fitClear = (map: maplibregl.Map, coords: [number, number][]) => {
    const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
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
    const food = IITB_FOOD.features.filter((f) => !NON_FOOD_AMENITIES.includes(f.properties.amenity));
    fitClear(map, food.map((f) => f.geometry.coordinates as [number, number]));
  };

  // Two named entry points instead of one boolean-flag parameter: a fresh user-initiated
  // search always starts at route 0 and updates the URL; a recompute (after a style reload
  // or a shareable-URL restore) keeps whatever route was already selected and doesn't.
  const searchDirections = () => computeRoute(0, { pushUrl: true, fit: true });
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
    setFromValue("");
    clearRoute();
  };

  // Bridges into MapLibre's persistent `style.load` listener, which is registered once
  // and would otherwise only ever see the state from the render it was created in.
  const latest = { fromValue, toValue, routeState, shown, buildings3d, recomputeRoute, dark, editing, drawing, pinLabel, addBuilding, moveFood };
  const latestRef = React.useRef(latest);
  latestRef.current = latest;

  React.useEffect(() => {
    if (!mapContainerRef.current) return;
    let style;
    try {
      style = getCampusStyle({ dark, tileUrl: tileUrlDraft || undefined, glyphsUrl: glyphsUrlDraft || undefined });
    } catch (err) {
      setError(toErrorMessage(err));
      return;
    }

    const sharedCentroid = sharedPlace ? findPlaceCentroid(sharedPlace) : undefined;
    const map = new maplibregl.Map({
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
    registerCampusImages(map);
    // layer listeners outlive setStyle, so register once
    for (const id of [FOOD_DOT_LAYER_ID, FOOD_LABEL_LAYER_ID]) {
      map.on("click", id, (e) => {
        const f = e.features?.[0];
        if (!f || f.geometry.type !== "Point" || latestRef.current.editing) return; // edit mode drags it
        const props = f.properties as FoodProps;
        setToValue(props.name); // the Share button then copies its link
        new maplibregl.Popup({ maxWidth: "240px", focusAfterOpen: false })
          .setLngLat(f.geometry.coordinates as [number, number])
          .setDOMContent(foodPopup(props))
          .addTo(map);
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
    if (sharedCentroid) toMarkerRef.current = setMarker(map, null, sharedCentroid, MARKER_COLORS.end);

    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
    });
    map.addControl(geolocate, "bottom-right");
    geolocate.on("geolocate", (pos: GeolocationPosition) => setMyLocation([pos.coords.longitude, pos.coords.latitude]));
    geolocateRef.current = geolocate;
    // Auto-track only on campus: off campus the camera would follow the user off the map.
    map.once("load", () => {
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
      setError("Map error: " + (e.error?.message ?? String(e)));
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the bundled snapshot stays if the sheet fails
  const [buildingStoreys, setBuildingStoreys] = React.useState(storeysByName);
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
      if (styleReadyRef.current) latestRef.current.recomputeRoute();
      // Otherwise the style.load handler picks up the now-populated from/to once the
      // map finishes (re)loading its style.
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // live directions from the GPS fix; only the first route fits the camera, so later fixes don't fight panning
  React.useEffect(() => {
    if (!directions || !myLocation || !inCampusBbox(myLocation[1], myLocation[0]) || !toPlace) return;
    if (!fromValue.trim()) {
      setFromValue(MY_LOCATION_LABEL);
      return;
    }
    if (!fromIsMe || !styleReadyRef.current) return;
    // skip GPS jitter; k-shortest-paths is too slow to rerun per fix
    const last = lastRoutedFixRef.current;
    if (routeState.routes.length > 0 && last?.to === toValue && haversineMeters(last.at, myLocation) < 10) return;
    lastRoutedFixRef.current = { at: myLocation, to: toValue };
    computeRoute(routeState.selectedIndex, { pushUrl: false, fit: routeState.routes.length === 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directions, myLocation, fromValue, toValue]);

  // computeRoute owns the camera in directions mode
  React.useEffect(() => {
    const map = mapRef.current;
    if (directions || !map || !toPlace) return;
    toMarkerRef.current = setMarker(map, toMarkerRef.current, toPlace, MARKER_COLORS.end);
    map.flyTo({ center: toPlace, zoom: Math.max(map.getZoom(), 17) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toValue, directions]);

  // Service worker registration, production only (avoids fighting Vite's dev HMR).
  React.useEffect(() => {
    if (!import.meta.env.DEV && "serviceWorker" in navigator) {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
    }
  }, []);

  // kept for the Install button; Chromium's own install banner still shows
  const [installPrompt, setInstallPrompt] = React.useState<InstallPromptEvent | null>(null);
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

  function useMyLocation() {
    setError("");
    setFromValue(MY_LOCATION_LABEL);
    if (!myLocation) geolocateRef.current?.trigger();
  }

  return (
    <>
      <Card
        ref={panelRef}
        className="absolute z-10 w-[min(320px,calc(100vw-24px))] gap-0 overflow-y-auto p-3 shadow-lg"
        style={{
          top: "max(12px, env(safe-area-inset-top))",
          left: "max(12px, env(safe-area-inset-left))",
          maxHeight: "calc(100vh - max(24px, env(safe-area-inset-top) + env(safe-area-inset-bottom) + 24px))",
        }}
      >
        <CardContent className="flex flex-col gap-3 p-0">
          <div className="flex items-center gap-2">
            {/* blue on transparent; the white backing keeps it legible in dark mode */}
            <img src={`${import.meta.env.BASE_URL}iitb-logo.svg`} alt="IIT Bombay logo" className="size-9 shrink-0 rounded-md bg-white p-0.5" />
            <span className="text-sm font-semibold leading-tight">IIT Bombay Campus Map</span>
          </div>
          {directions && (
            <div className="flex items-center gap-2">
              <BuildingCombobox
                id="fromInput"
                value={fromValue}
                onValueChange={setFromValue}
                buildingNames={PLACE_NAMES}
                placeholder="From (building, DIGIPIN, my location)"
                className="flex-1"
              />
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
          <div className="flex items-center gap-2">
            <BuildingCombobox
              id="toInput"
              value={toValue}
              onValueChange={setToValue}
              buildingNames={PLACE_NAMES}
              placeholder={directions ? "To (building or DIGIPIN)" : "Search buildings"}
              className="flex-1"
            />
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

          <DigipinHint label="To" place={toPlace} />
          {directions && (
            <>
              {fromIsMe && <DigipinHint label="You" place={myLocation} />}
              <ToggleGroup type="single" value={profile} onValueChange={(v) => v && setProfile(v as RoutingProfile)}>
                <ToggleGroupItem value="walk" className="flex-1">
                  Walk
                </ToggleGroupItem>
                <ToggleGroupItem value="drive" className="flex-1">
                  Drive
                </ToggleGroupItem>
              </ToggleGroup>
            </>
          )}

          <div className="flex gap-2">
            {directions ? (
              <Button className="flex-1" onClick={searchDirections}>
                Get directions
              </Button>
            ) : (
              <Button className="min-w-0 flex-1" onClick={() => setDirections(true)} disabled={!toPlace}>
                <Navigation className="size-4" />
                Directions
              </Button>
            )}
            <Button variant="outline" className="px-3" onClick={shareLink} disabled={!toPlace}>
              <Share2 className="size-4" />
              {linkCopied ? "Link copied" : "Share"}
            </Button>
            <Button variant={foodOnly ? "default" : "outline"} className="px-3" aria-pressed={foodOnly} title="Show only food places" onClick={toggleFood}>
              <Utensils className="size-4" />
              Food
            </Button>
            {directions && (
              <Button variant="ghost" size="icon" title="Close directions" aria-label="Close directions" onClick={exitDirections}>
                <X className="size-4" />
              </Button>
            )}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {routeState.routes.length > 0 && (
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
              <summary className="cursor-pointer text-muted-foreground">Step-by-step</summary>
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
                  className="w-full flex-wrap"
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
                <Label htmlFor="buildings3d">3D buildings</Label>
              </div>
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
                  <Label htmlFor="editMode">Edit mode</Label>
                </div>
              )}
              {installPrompt ? (
                <Button variant="outline" onClick={() => installPrompt.prompt().then(() => setInstallPrompt(null))}>
                  <Download className="size-4" />
                  Install app
                </Button>
              ) : (
                IOS_BROWSER && <p className="text-xs text-muted-foreground">To install, tap Share, then Add to Home Screen.</p>
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
      <BuildingList groups={listGroups} storeys={buildingStoreys} selected={toValue.trim()} dark={dark} wideQuery={WIDE_SCREEN} onPick={setToValue} />
      <div id="map" ref={mapContainerRef} />
    </>
  );
}
