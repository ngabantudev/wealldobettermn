"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import polylabel from "polylabel";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { RepProperties } from "@/lib/types";
import { getUpcomingHearings } from "@/lib/hearings";
import {
  CITY_ACCENT,
  CITY_PALETTES,
  CONTESTED_COLOR,
  NEUTRAL_PARTY_COLOR,
  PARTY_COLORS,
  partyColor,
  partyColorSoft,
} from "@/lib/cityTheme";
import { MN_GREEN, MN_NAVY } from "@/lib/brandTheme";
import WardModal, { areaLabel, roleLabel } from "./WardModal";

// Matches the OpenFreeMap "Liberty" style used by the get-flocked project,
// for visual consistency across these MN civic-data map tools.
const LIBERTY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const WARDS_SOURCE_ID = "wards-source";
const WARDS_FILL_LAYER_ID = "wards-fill";
const WARDS_OUTLINE_LAYER_ID = "wards-outline";
const WARDS_PULSE_LAYER_ID = "wards-pulse";
const WARDS_LABEL_LAYER_ID = "wards-label";

const COMMISSIONERS_SOURCE_ID = "commissioners-source";
const COMMISSIONERS_FILL_LAYER_ID = "commissioners-fill";
const COMMISSIONERS_OUTLINE_LAYER_ID = "commissioners-outline";
const COMMISSIONERS_PULSE_LAYER_ID = "commissioners-pulse";
const COMMISSIONERS_LABEL_LAYER_ID = "commissioners-label";

const STATE_LEG_SOURCE_ID = "state-legislature-source";
const STATE_LEG_FILL_LAYER_ID = "state-legislature-fill";
const STATE_LEG_OUTLINE_LAYER_ID = "state-legislature-outline";
const STATE_LEG_PULSE_LAYER_ID = "state-legislature-pulse";
const STATE_LEG_LABEL_LAYER_ID = "state-legislature-label";

const CITIES = [
  "Minneapolis",
  "St. Paul",
  "Bloomington",
  "Plymouth",
  "Minnetonka",
  "St. Louis Park",
  "Richfield",
  "Blaine",
  "Brooklyn Park",
  "Coon Rapids",
] as const;
type City = (typeof CITIES)[number];

const CHAMBERS = ["house", "senate"] as const;
type Chamber = (typeof CHAMBERS)[number];
const CHAMBER_LABELS: Record<Chamber, string> = { house: "MN House", senate: "MN Senate" };

// Wards, commissioner districts, and state legislative districts are three
// different government layers covering different areas — showing more
// than one as overlapping fills at once would just be visual noise, so
// only one is ever on screen. Mayors are city-level, so they only make
// sense alongside wards.
type LayerMode = "wards" | "commissioners" | "state-legislature";

// A Hennepin County commissioner district covers plenty of suburbs
// "Minneapolis" doesn't literally describe — the checkbox label should say
// so. Only Minneapolis/St. Paul need an override here: every other city's
// commissioner-mode (and state-legislature-mode) label is a dead entry —
// see MODE_VISIBLE_CITIES below for why those never actually render — so
// it falls back to "" rather than needing its own line per city.
const COMMISSIONER_LABEL_OVERRIDES: Partial<Record<City, string>> = {
  Minneapolis: "Hennepin County",
  "St. Paul": "Ramsey County",
};

// Derived from CITIES so adding a city there is enough to get it a correct
// wards-mode label — no separate list to keep in sync (this used to be one,
// and needing a 9th/10th hand-written entry per mode is what prompted
// deriving it instead).
const MODE_FILTER_LABELS: Record<LayerMode, Record<City, string>> = {
  wards: Object.fromEntries(CITIES.map((city) => [city, city])) as Record<City, string>,
  commissioners: Object.fromEntries(CITIES.map((city) => [city, COMMISSIONER_LABEL_OVERRIDES[city] ?? ""])) as Record<
    City,
    string
  >,
  "state-legislature": Object.fromEntries(CITIES.map((city) => [city, ""])) as Record<City, string>,
};

// Which of the CITIES checkboxes actually make sense to show per mode.
// Commissioner districts only ever carry city:"Minneapolis"/"St. Paul"
// (see fetch-commissioners.mjs — Hennepin/Ramsey aren't broken out by
// suburb), so listing the newer ward-only cities there would just be dead
// checkboxes that filter nothing. State legislature mode doesn't use the
// city filter at all — see the comment above.
const MODE_VISIBLE_CITIES: Record<LayerMode, readonly City[]> = {
  wards: CITIES,
  commissioners: ["Minneapolis", "St. Paul"],
  "state-legislature": [],
};

// User-facing names for the mode toggle — "which level of government."
const MODE_LABELS: Record<LayerMode, string> = {
  wards: "City",
  commissioners: "County",
  "state-legislature": "State",
};

const OUTLINE_COLOR = "#44403c";

function cityMatchExpression(city: City, numberField: string): unknown[] {
  const palette = CITY_PALETTES[city];
  return [
    "match",
    ["%", ["to-number", ["coalesce", ["get", numberField], 0]], palette.length],
    ...palette.flatMap((color, i) => [i, color]),
    palette[0],
  ];
}

// Data-driven over CITY_PALETTES rather than a hardcoded per-city case, so
// adding a new city's palette to cityTheme.ts is enough to color it here —
// no second edit needed. Commissioner districts only ever carry
// city:"Minneapolis"/"St. Paul", so the extra branches for newer cities
// are inert (never matched) when this builds COMMISSIONER_FILL_COLOR_EXPRESSION.
function fillColorExpression(numberField: string): maplibregl.ExpressionSpecification {
  const branches = (Object.keys(CITY_PALETTES) as City[]).flatMap((city) => [
    ["==", ["get", "city"], city],
    cityMatchExpression(city, numberField),
  ]);
  return ["case", ...branches, "#e5e7eb"] as unknown as maplibregl.ExpressionSpecification;
}

const WARD_FILL_COLOR_EXPRESSION = fillColorExpression("ward");
const COMMISSIONER_FILL_COLOR_EXPRESSION = fillColorExpression("district");

// State legislative districts don't belong to one city the way wards or
// commissioner districts do, so the city-hue scheme above doesn't apply —
// party is the one dimension actually worth coloring this layer by. Built
// from the same PARTY_COLORS map WardModal's party-unity bar uses, so the
// map and the modal never disagree on which color means which party.
const STATE_LEG_FILL_COLOR_EXPRESSION = [
  "match",
  ["get", "repParty"],
  ...Object.entries(PARTY_COLORS).flatMap(([party, color]) => [party, color]),
  NEUTRAL_PARTY_COLOR, // vacant or minor-party seats
] as unknown as maplibregl.ExpressionSpecification;

// The pulse layers' permanent filter (same property name on both
// sources) — city visibility gets ANDed onto this in applyCityFilter
// rather than replacing it, since the pulse layer always needs both
// conditions at once.
const CONTESTED_FILTER = ["==", ["get", "isContested"], true] as unknown as maplibregl.FilterSpecification;

const TWIN_CITIES_CENTER: [number, number] = [-93.185, 44.955];
const DEFAULT_ZOOM = 10.4;
// How far around a point marker (mayor pin) to pad when "zooming to" it —
// there's no polygon to fitBounds to, so this fakes one.
const POINT_ZOOM_PADDING_DEGREES = 0.01;

interface SelectedRep {
  properties: RepProperties;
  pinned: boolean;
}

interface PinMarker {
  marker: maplibregl.Marker;
  properties: RepProperties;
  // Which layer mode this pin belongs to — mayors ride along with wards,
  // commissioners with commissioner districts — so visibility toggling can
  // tell the two groups of pins apart without a second ref/loop per type.
  mode: LayerMode;
}

// Pin diameter scales with how much ground the office actually covers: a
// citywide executive (one mayor) reads as more prominent than one of
// several countywide board seats, which in turn outranks a single ward.
const PIN_DIAMETER_BY_ROLE: Partial<Record<RepProperties["role"], number>> = {
  Mayor: 52,
  "County Commissioner": 40,
  "State Senator": 38,
  "State Representative": 36,
  "Council Member": 34,
};
const DEFAULT_PIN_DIAMETER = 44;
// Center-to-center pixel gap for wards that seat more than one member off
// a shared polygon (Blaine, Brooklyn Park) — Council Member pins are 34px,
// so 38px center-to-center leaves a small visible gap between edges
// rather than the pins touching or overlapping.
const PIN_SIDE_BY_SIDE_SPACING_PX = 38;

function boundsFromFeature(feature: Feature<Geometry>): maplibregl.LngLatBounds {
  const bounds = new maplibregl.LngLatBounds();
  const geom = feature.geometry;
  const polygons = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  for (const rings of polygons) {
    for (const ring of rings) {
      for (const [lng, lat] of ring as [number, number][]) {
        bounds.extend([lng, lat]);
      }
    }
  }
  return bounds;
}

// A polygon's bounding-box center can land outside the polygon itself for
// any non-convex shape (a crescent, an L, or — concretely — Coon Rapids
// Ward 4's dissolved MultiPolygon, which carries a small disconnected
// sliver alongside its main body — see fetch-wards.mjs) — landing a pin
// on a shared boundary line or inside a neighboring ward instead of
// clearly within its own. Pole of inaccessibility (the point farthest
// from any edge) reliably stays inside. For a MultiPolygon, each part is
// checked and the one with the largest resulting distance wins — the
// same "pick the more substantial piece" behavior this needs. polylabel
// is purpose-built for exactly this at interactive/real-time scale (it's
// what Mapbox GL JS itself uses for automatic label placement), so
// running it once per feature at load time — a few hundred wards and
// districts total — isn't a real performance concern. Falls back to the
// bounding-box center for a degenerate/empty geometry (an empty ring, or
// a feature with no polygon at all) rather than throwing.
function pinPositionForFeature(feature: Feature<Geometry>, bounds: maplibregl.LngLatBounds): maplibregl.LngLat {
  const geom = feature.geometry;
  const polygons = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  let best: ([number, number] & { distance: number }) | null = null;
  for (const rings of polygons) {
    if (rings.length === 0 || rings[0].length < 4) continue;
    const result = polylabel(rings as unknown as [number, number][][], 0.000001);
    if (!best || result.distance > best.distance) best = result;
  }
  return best ? new maplibregl.LngLat(best[0], best[1]) : bounds.getCenter();
}

function boundsFromFeatureCollection(data: FeatureCollection): maplibregl.LngLatBounds {
  const bounds = new maplibregl.LngLatBounds();
  for (const feature of data.features) {
    if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") continue;
    bounds.extend(boundsFromFeature(feature as Feature<Geometry>));
  }
  return bounds;
}

// MapLibre tiles GeoJSON sources internally (even client-side ones), and
// that vector-tile-style property encoding has no null type — a `null` in
// the source data comes back as `undefined` on features returned by
// queryRenderedFeatures. Every nullable RepProperties field is checked
// with strict `!== null` downstream (the hearings guard below, WardModal's
// role/area labels), so re-normalize undefined back to null here, once,
// right where features leave MapLibre's hands. Mayor markers don't need
// this — their properties come straight from the fetched JSON, never
// through MapLibre's tiling.
function normalizeRepProperties(raw: Record<string, unknown> | null | undefined): RepProperties {
  const p = (raw ?? {}) as unknown as RepProperties;
  return {
    ...p,
    county: p.county ?? null,
    ward: p.ward ?? null,
    wardName: p.wardName ?? null,
    district: p.district ?? null,
    repName: p.repName ?? null,
    repPhotoUrl: p.repPhotoUrl ?? null,
    repEmail: p.repEmail ?? null,
    repPhone: p.repPhone ?? null,
    officeRoom: p.officeRoom ?? null,
    profileUrl: p.profileUrl ?? null,
    candidates: Array.isArray(p.candidates) ? p.candidates : [],
    isContested: p.isContested === true,
    stateDistrict: p.stateDistrict ?? null,
    chamber: p.chamber ?? null,
    partyUnityPercent: typeof p.partyUnityPercent === "number" ? p.partyUnityPercent : null,
    recentVotes: Array.isArray(p.recentVotes) ? p.recentVotes : [],
  };
}

function boundsAroundPoint(lng: number, lat: number): maplibregl.LngLatBounds {
  return new maplibregl.LngLatBounds(
    [lng - POINT_ZOOM_PADDING_DEGREES, lat - POINT_ZOOM_PADDING_DEGREES],
    [lng + POINT_ZOOM_PADDING_DEGREES, lat + POINT_ZOOM_PADDING_DEGREES],
  );
}

function isMobileViewport(): boolean {
  return window.innerWidth < 768;
}

// Paired with isMobileViewport for the sidebar's default-collapsed state
// via useSyncExternalStore. A real subscription, not a no-op — without
// one, isMobile would permanently lock in whatever it read on the very
// first render and never re-check, which is fragile: a real user resizing
// the window (or an actual mobile browser's viewport settling a beat
// after first paint, as its own chrome finishes laying out) would get
// stuck on a stale reading.
function subscribeToResize(onStoreChange: () => void): () => void {
  window.addEventListener("resize", onStoreChange);
  return () => window.removeEventListener("resize", onStoreChange);
}

function isMobileServerSnapshot(): boolean {
  return false;
}

// Sidebar collapse/expand affordance — mobile header trigger and desktop
// pull-tab both use this, rotated differently for each (see call sites).
function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A circular headshot "pin" — plain DOM rather than a symbol-layer icon,
// since clipping a photo to a circle with a colored ring is trivial in CSS
// and painful to pre-bake into a sprite. Reused for every office that gets
// a point marker (currently mayors and county commissioners); diameter is
// the caller's way of expressing how much ground the office covers. The
// ring/background color identifies the office-holder by party — real
// party for state legislators, the shared neutral color for every
// nonpartisan city/county role — not by city (see PARTY_COLORS's comment
// in cityTheme.ts for why those are kept separate).
//
// Two nested elements, not one: maplibregl.Marker positions its element by
// writing `transform: translate(...)` directly onto it on every render. The
// hover "pop" effect also wants to set `transform: scale(...)` — on the
// same element, that overwrites Marker's translate and the pin jumps to
// the map's untransformed top-left corner. Scaling the inner element
// instead leaves Marker's own transform on the outer one alone.
function createRepPinElement(rep: RepProperties, diameter: number = DEFAULT_PIN_DIAMETER): HTMLDivElement {
  const accent = partyColor(rep.repParty);
  const outer = document.createElement("div");
  outer.setAttribute("role", "button");
  outer.setAttribute("aria-label", `${areaLabel(rep)} ${roleLabel(rep)}${rep.repName ? ` ${rep.repName}` : ""}`);
  // Bigger pins render on top of smaller ones wherever two roles' pins
  // land close enough to overlap (mainly Mayor over Council Member — the
  // only two roles that ever share a mode/screen) — z-index tracks
  // diameter directly rather than a separate role table, so the stacking
  // order can never drift out of sync with the size hierarchy it's
  // reinforcing. All markers are siblings in MapLibre's own marker
  // container, so z-index here does control their relative stacking.
  outer.style.cssText = `cursor: pointer; z-index: ${Math.round(diameter)};`;

  const inner = document.createElement("div");
  inner.style.cssText = `
    width: ${diameter}px; height: ${diameter}px; border-radius: 9999px;
    border: 3px solid ${accent}; box-shadow: 0 2px 8px rgba(0,0,0,0.35);
    background: ${partyColorSoft(rep.repParty)}; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    transition: transform 0.15s ease; background-size: cover; background-position: center;
  `;
  outer.appendChild(inner);

  if (rep.repPhotoUrl) {
    const img = document.createElement("img");
    img.src = rep.repPhotoUrl;
    img.alt = rep.repName ?? "Representative photo";
    img.style.cssText = "width: 100%; height: 100%; object-fit: cover;";
    inner.appendChild(img);
  } else {
    inner.textContent = (rep.repName ?? "?").slice(0, 1).toUpperCase();
    inner.style.color = accent;
    inner.style.fontWeight = "700";
  }
  outer.addEventListener("mouseenter", () => {
    inner.style.transform = "scale(1.08)";
  });
  outer.addEventListener("mouseleave", () => {
    inner.style.transform = "scale(1)";
  });
  return outer;
}

export default function WardMap() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const wardsBoundsRef = useRef<maplibregl.LngLatBounds | null>(null);
  const commissionersBoundsRef = useRef<maplibregl.LngLatBounds | null>(null);
  const stateLegBoundsRef = useRef<maplibregl.LngLatBounds | null>(null);
  // The untouched fetch results, kept around so a click can look up a
  // ward/district's true full geometry — see the comment on the click
  // handler for why queryRenderedFeatures's own geometry isn't good
  // enough for that.
  const wardsDataRef = useRef<FeatureCollection | null>(null);
  const commissionersDataRef = useRef<FeatureCollection | null>(null);
  const stateLegDataRef = useRef<FeatureCollection | null>(null);
  const pinMarkersRef = useRef<PinMarker[]>([]);
  const pulseAnimationFrameRef = useRef<number | null>(null);
  const [selected, setSelected] = useState<SelectedRep | null>(null);
  const selectedRef = useRef<SelectedRep | null>(null);
  const [layerMode, setLayerMode] = useState<LayerMode>("wards");
  const layerModeRef = useRef(layerMode);
  const [visibleCities, setVisibleCities] = useState<Record<City, boolean>>(
    () => Object.fromEntries(CITIES.map((city) => [city, true])) as Record<City, boolean>,
  );
  const visibleCitiesRef = useRef(visibleCities);
  const [chamber, setChamber] = useState<Chamber>("house");
  const chamberRef = useRef(chamber);
  // Desktop default (expanded) matches the panel's previous always-open
  // behavior. Mobile starts collapsed instead — with 10 cities, the filter
  // list is now tall enough to fill the whole screen on a phone, which
  // defeats the point of a *map* app.
  //
  // isMobile is read via useSyncExternalStore rather than a plain
  // useState+useEffect pair: window.innerWidth isn't available during
  // server rendering, and a useState lazy initializer runs during the
  // client's very first (hydration) render too, before it's had a chance
  // to differ from the server — React would flag that as a hydration
  // mismatch. useSyncExternalStore is the hook built specifically to read
  // a browser-only value without that problem (it renders the server
  // snapshot first, then corrects to the real one). sidebarCollapsed
  // itself stays a plain override so a manual toggle isn't clobbered by
  // isMobile settling to its real value right after — it only *defaults*
  // to isMobile until the user clicks the toggle for the first time.
  const isMobile = useSyncExternalStore(subscribeToResize, isMobileViewport, isMobileServerSnapshot);
  const [sidebarCollapsedOverride, setSidebarCollapsedOverride] = useState<boolean | null>(null);
  const sidebarCollapsed = sidebarCollapsedOverride ?? isMobile;

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    visibleCitiesRef.current = visibleCities;
  }, [visibleCities]);

  useEffect(() => {
    chamberRef.current = chamber;
  }, [chamber]);

  useEffect(() => {
    layerModeRef.current = layerMode;
  }, [layerMode]);

  const zoomToBounds = (bounds: maplibregl.LngLatBounds) => {
    const map = mapRef.current;
    if (!map) return;
    // Reserve space for whatever chrome is actually on screen so
    // fitBounds doesn't center the target *under* it: the topbar (both),
    // the collapsed sidebar's header row (mobile — it isn't full-height
    // there, so it only eats a little, not the whole left edge), the
    // full-height sidebar (desktop left), and the modal itself, which is
    // a bottom sheet on mobile but bottom-right on desktop — see its
    // wrapper's sm: classes below.
    map.fitBounds(bounds, {
      padding: isMobileViewport() ? { top: 110, bottom: 260, left: 40, right: 40 } : { top: 80, bottom: 40, left: 320, right: 420 },
      duration: 600,
    });
  };

  const zoomToDefault = (mode: LayerMode = layerModeRef.current) => {
    const map = mapRef.current;
    const bounds =
      mode === "wards" ? wardsBoundsRef.current : mode === "commissioners" ? commissionersBoundsRef.current : stateLegBoundsRef.current;
    if (!map || !bounds) return;
    // No modal to clear here (deselecting implies it's closing/closed) —
    // just the topbar and, on desktop, the persistent left sidebar.
    map.fitBounds(bounds, {
      padding: isMobileViewport() ? { top: 110, bottom: 40, left: 16, right: 16 } : { top: 80, bottom: 40, left: 320, right: 40 },
      duration: 600,
    });
  };

  const deselect = () => {
    setSelected(null);
    zoomToDefault();
  };

  const applyCityFilter = (cities: Record<City, boolean>) => {
    const map = mapRef.current;
    if (map) {
      const visible = CITIES.filter((c) => cities[c]);
      const filter = ["in", ["get", "city"], ["literal", visible]] as unknown as maplibregl.FilterSpecification;
      for (const layerId of [
        WARDS_FILL_LAYER_ID,
        WARDS_OUTLINE_LAYER_ID,
        WARDS_LABEL_LAYER_ID,
        COMMISSIONERS_FILL_LAYER_ID,
        COMMISSIONERS_OUTLINE_LAYER_ID,
        COMMISSIONERS_LABEL_LAYER_ID,
      ]) {
        if (map.getLayer(layerId)) map.setFilter(layerId, filter);
      }
      // The pulse layers additionally require isContested — city
      // visibility is ANDed onto that rather than overwriting it.
      for (const layerId of [WARDS_PULSE_LAYER_ID, COMMISSIONERS_PULSE_LAYER_ID]) {
        if (map.getLayer(layerId)) {
          map.setFilter(layerId, ["all", CONTESTED_FILTER, filter] as unknown as maplibregl.FilterSpecification);
        }
      }
    }
    for (const { marker, properties, mode } of pinMarkersRef.current) {
      if (mode === "state-legislature") continue; // governed by applyChamberFilter instead
      const visible = mode === layerModeRef.current && cities[properties.city as City];
      marker.getElement().style.display = visible ? "" : "none";
    }
  };

  // State legislature mode's equivalent of applyCityFilter above —
  // districts are filtered by chamber (House/Senate) instead of by city,
  // since a district doesn't cleanly belong to one Twin City the way a
  // ward does.
  const applyChamberFilter = (nextChamber: Chamber) => {
    const map = mapRef.current;
    if (map) {
      const filter = ["==", ["get", "chamber"], nextChamber] as unknown as maplibregl.FilterSpecification;
      for (const layerId of [STATE_LEG_FILL_LAYER_ID, STATE_LEG_OUTLINE_LAYER_ID, STATE_LEG_LABEL_LAYER_ID]) {
        if (map.getLayer(layerId)) map.setFilter(layerId, filter);
      }
      if (map.getLayer(STATE_LEG_PULSE_LAYER_ID)) {
        map.setFilter(STATE_LEG_PULSE_LAYER_ID, ["all", CONTESTED_FILTER, filter] as unknown as maplibregl.FilterSpecification);
      }
    }
    // Chamber match alone isn't enough — without also checking the current
    // mode, every House (or Senate) pin turns visible the moment this runs
    // during setup, regardless of which top-level mode is actually active.
    // (applyLayerMode already gates state-legislature pins on chamber too,
    // but only runs on a mode *switch* — this is the one that has to hold
    // on initial load, when the mode never "switches" at all.)
    const showStateLegPins = layerModeRef.current === "state-legislature";
    for (const { marker, properties, mode } of pinMarkersRef.current) {
      if (mode !== "state-legislature") continue;
      marker.getElement().style.display = showStateLegPins && properties.chamber === nextChamber ? "" : "none";
    }
  };

  const applyLayerMode = (mode: LayerMode) => {
    const map = mapRef.current;
    if (!map) return;
    const layerGroups: [LayerMode, string[]][] = [
      ["wards", [WARDS_FILL_LAYER_ID, WARDS_OUTLINE_LAYER_ID, WARDS_PULSE_LAYER_ID, WARDS_LABEL_LAYER_ID]],
      [
        "commissioners",
        [COMMISSIONERS_FILL_LAYER_ID, COMMISSIONERS_OUTLINE_LAYER_ID, COMMISSIONERS_PULSE_LAYER_ID, COMMISSIONERS_LABEL_LAYER_ID],
      ],
      [
        "state-legislature",
        [STATE_LEG_FILL_LAYER_ID, STATE_LEG_OUTLINE_LAYER_ID, STATE_LEG_PULSE_LAYER_ID, STATE_LEG_LABEL_LAYER_ID],
      ],
    ];
    for (const [groupMode, layerIds] of layerGroups) {
      for (const layerId of layerIds) {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", groupMode === mode ? "visible" : "none");
      }
    }
    for (const { marker, properties, mode: pinMode } of pinMarkersRef.current) {
      const visible =
        pinMode === mode &&
        (mode === "state-legislature"
          ? properties.chamber === chamberRef.current
          : visibleCitiesRef.current[properties.city as City]);
      marker.getElement().style.display = visible ? "" : "none";
    }
  };

  const toggleCity = (city: City) => {
    setVisibleCities((prev) => {
      const next = { ...prev, [city]: !prev[city] };
      applyCityFilter(next);
      // If the pinned/hovered rep belongs to a city that just got hidden,
      // clear it rather than leave a modal open for something invisible.
      if (!next[city] && selectedRef.current?.properties.city === city) {
        deselect();
      }
      return next;
    });
  };

  const switchChamber = (next: Chamber) => {
    if (next === chamberRef.current) return;
    setChamber(next);
    setSelected(null);
    applyChamberFilter(next);
  };

  const switchMode = (mode: LayerMode) => {
    if (mode === layerModeRef.current) return;
    setLayerMode(mode);
    setSelected(null);
    applyLayerMode(mode);
    zoomToDefault(mode);
  };

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: LIBERTY_STYLE_URL,
      center: TWIN_CITIES_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
      cooperativeGestures: isMobileViewport(),
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    const isDesktopHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    map.on("error", (e) => {
      console.error("[MapLibre ERROR]", e.error?.message ?? e);
    });

    map.on("load", async () => {
      // The canvas's WebGL drawing buffer is sized from the container at
      // construction time; if layout settles a beat after that (webfonts,
      // flex sizing), the buffer is left smaller than the CSS box and only
      // that top-left region ever gets painted. Forcing a resize once the
      // container has its final size fixes that.
      setTimeout(() => map.resize(), 100);

      // no-store: this is static JSON re-fetched every election cycle (see
      // scripts/fetch-*.mjs) — a browser-cached copy from before a field
      // got added crashes the modal on a field the current component code
      // expects to exist.
      const [wardsRes, mayorsRes, commissionersRes, stateLegRes] = await Promise.all([
        fetch("/wards.geojson", { cache: "no-store" }),
        fetch("/mayors.geojson", { cache: "no-store" }),
        fetch("/commissioners.geojson", { cache: "no-store" }),
        fetch("/state-legislature.geojson", { cache: "no-store" }),
      ]);
      const data: FeatureCollection = await wardsRes.json();
      const mayorsData: FeatureCollection = await mayorsRes.json();
      const commissionersData: FeatureCollection = await commissionersRes.json();
      const stateLegData: FeatureCollection = await stateLegRes.json();
      wardsDataRef.current = data;
      commissionersDataRef.current = commissionersData;
      stateLegDataRef.current = stateLegData;

      // Guards the whole "add sources/layers/markers" block as a unit —
      // without it, a second 'load' firing would duplicate every pin
      // marker on top of itself (Marker instances aren't deduped the way
      // map.addSource/addLayer already are below).
      if (map.getSource(WARDS_SOURCE_ID)) return;

      // Shared by every pin type (mayors, council members, commissioners):
      // creates the marker, wires up the same hover/click behavior, and
      // registers it for the mode/city visibility toggles. One place to
      // get this right instead of a near-identical loop body per role.
      const addPin = (
        properties: RepProperties,
        coordinates: maplibregl.LngLatLike,
        diameter: number = DEFAULT_PIN_DIAMETER,
        mode: LayerMode,
        zoomBounds: maplibregl.LngLatBounds,
        // Pixel offset, not a coordinate nudge — stays a constant visual
        // distance apart regardless of zoom level (a fixed-degree lng/lat
        // offset would shrink to nothing when zoomed out). Used for wards
        // that seat more than one member off a single shared polygon.
        pixelOffset: maplibregl.PointLike = [0, 0],
      ) => {
        const el = createRepPinElement(properties, diameter);
        const marker = new maplibregl.Marker({ element: el, anchor: "center", offset: pixelOffset })
          .setLngLat(coordinates)
          .addTo(map);

        el.addEventListener("mouseenter", () => {
          if (!isDesktopHover || selectedRef.current?.pinned) return;
          setSelected({ properties, pinned: false });
        });
        el.addEventListener("mouseleave", () => {
          if (!isDesktopHover || selectedRef.current?.pinned) return;
          setSelected(null);
        });
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          setSelected({ properties, pinned: true });
          zoomToBounds(zoomBounds);
        });

        pinMarkersRef.current.push({ marker, properties, mode });
      };

      for (const feature of mayorsData.features) {
        if (feature.geometry.type !== "Point") continue;
        const properties = feature.properties as RepProperties;
        const [lng, lat] = feature.geometry.coordinates as [number, number];
        addPin(properties, [lng, lat], PIN_DIAMETER_BY_ROLE.Mayor, "wards", boundsAroundPoint(lng, lat));
      }

      // One pin per council member, positioned inside their ward — grouped
      // by (city, ward) first because a handful of wards (Blaine's,
      // Brooklyn Park's) seat two members off one shared polygon. Each
      // group's anchor point (pole of inaccessibility, not bounds-center —
      // see pinPositionForFeature) is computed once and shared; members
      // within a group fan out left-to-right around it via a fixed pixel
      // offset, so two-member wards read as clearly side-by-side rather
      // than stacked on the same point. The polygon itself (fill/outline/
      // zoom target) is untouched either way — only the pin coordinate.
      const wardGroups = new Map<string, { feature: (typeof data.features)[number]; properties: RepProperties }[]>();
      for (const feature of data.features) {
        if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") continue;
        const properties = feature.properties as RepProperties;
        const wardKey = `${properties.city}-${properties.ward}`;
        if (!wardGroups.has(wardKey)) wardGroups.set(wardKey, []);
        wardGroups.get(wardKey)!.push({ feature, properties });
      }
      for (const group of wardGroups.values()) {
        const bounds = boundsFromFeature(group[0].feature as Feature<Geometry>);
        const anchor = pinPositionForFeature(group[0].feature as Feature<Geometry>, bounds);
        group.forEach(({ properties }, i) => {
          const offsetX = group.length > 1 ? (i - (group.length - 1) / 2) * PIN_SIDE_BY_SIDE_SPACING_PX : 0;
          addPin(properties, anchor, PIN_DIAMETER_BY_ROLE["Council Member"], "wards", bounds, [offsetX, 0]);
        });
      }

      // One pin per commissioner, same interaction pattern as mayors, but
      // there's no office address to anchor to — pinPositionForFeature
      // stands in for "somewhere well inside the district" (as opposed to
      // fitBounds, which needs the real shape, hence bounds staying separate).
      for (const feature of commissionersData.features) {
        if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") continue;
        const properties = feature.properties as RepProperties;
        const bounds = boundsFromFeature(feature as Feature<Geometry>);
        const position = pinPositionForFeature(feature as Feature<Geometry>, bounds);
        addPin(properties, position, PIN_DIAMETER_BY_ROLE["County Commissioner"], "commissioners", bounds);
      }

      // One pin per state legislator — role (and so pin size) varies
      // feature-to-feature here, unlike the loops above, since a single
      // source covers both House and Senate districts.
      for (const feature of stateLegData.features) {
        if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") continue;
        const properties = feature.properties as RepProperties;
        const bounds = boundsFromFeature(feature as Feature<Geometry>);
        const position = pinPositionForFeature(feature as Feature<Geometry>, bounds);
        addPin(properties, position, PIN_DIAMETER_BY_ROLE[properties.role], "state-legislature", bounds);
      }

      map.addSource(WARDS_SOURCE_ID, { type: "geojson", data });
      map.addSource(COMMISSIONERS_SOURCE_ID, { type: "geojson", data: commissionersData });
      map.addSource(STATE_LEG_SOURCE_ID, { type: "geojson", data: stateLegData });

      map.addLayer({
        id: WARDS_FILL_LAYER_ID,
        type: "fill",
        source: WARDS_SOURCE_ID,
        paint: { "fill-color": WARD_FILL_COLOR_EXPRESSION, "fill-opacity": 0.6 },
      });
      map.addLayer({
        id: WARDS_OUTLINE_LAYER_ID,
        type: "line",
        source: WARDS_SOURCE_ID,
        paint: { "line-color": OUTLINE_COLOR, "line-width": 1.5 },
      });
      // Highlights wards with a contested election, on top of the normal
      // outline but below labels. Starts matching zero features today —
      // isContested is false everywhere until real candidate-filing data
      // is sourced — the animation loop below drives its paint properties.
      map.addLayer({
        id: WARDS_PULSE_LAYER_ID,
        type: "line",
        source: WARDS_SOURCE_ID,
        filter: CONTESTED_FILTER,
        paint: { "line-color": CONTESTED_COLOR, "line-width": 3, "line-opacity": 0.85 },
      });
      map.addLayer({
        id: WARDS_LABEL_LAYER_ID,
        type: "symbol",
        source: WARDS_SOURCE_ID,
        layout: {
          // Falls back to "Ward N" only when there's no city-given name for
          // the area (Brooklyn Park's Central/East/West districts carry a
          // wardName instead — see the field's comment in types.ts).
          "text-field": ["coalesce", ["get", "wardName"], ["concat", "Ward ", ["to-string", ["get", "ward"]]]],
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
        },
        paint: { "text-color": "#1f2937", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
      });

      map.addLayer({
        id: COMMISSIONERS_FILL_LAYER_ID,
        type: "fill",
        source: COMMISSIONERS_SOURCE_ID,
        layout: { visibility: "none" },
        paint: { "fill-color": COMMISSIONER_FILL_COLOR_EXPRESSION, "fill-opacity": 0.6 },
      });
      map.addLayer({
        id: COMMISSIONERS_OUTLINE_LAYER_ID,
        type: "line",
        source: COMMISSIONERS_SOURCE_ID,
        layout: { visibility: "none" },
        paint: { "line-color": OUTLINE_COLOR, "line-width": 1.5 },
      });
      map.addLayer({
        id: COMMISSIONERS_PULSE_LAYER_ID,
        type: "line",
        source: COMMISSIONERS_SOURCE_ID,
        layout: { visibility: "none" },
        filter: CONTESTED_FILTER,
        paint: { "line-color": CONTESTED_COLOR, "line-width": 3, "line-opacity": 0.85 },
      });
      map.addLayer({
        id: COMMISSIONERS_LABEL_LAYER_ID,
        type: "symbol",
        source: COMMISSIONERS_SOURCE_ID,
        layout: {
          "text-field": ["concat", "District ", ["to-string", ["get", "district"]]],
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
          visibility: "none",
        },
        paint: { "text-color": "#1f2937", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
      });

      // Starts filtered to the default chamber (House) — switchChamber
      // updates this filter, switchMode's visibility toggle is separate.
      const defaultChamberFilter = ["==", ["get", "chamber"], chamberRef.current] as unknown as maplibregl.FilterSpecification;
      map.addLayer({
        id: STATE_LEG_FILL_LAYER_ID,
        type: "fill",
        source: STATE_LEG_SOURCE_ID,
        layout: { visibility: "none" },
        filter: defaultChamberFilter,
        paint: { "fill-color": STATE_LEG_FILL_COLOR_EXPRESSION, "fill-opacity": 0.6 },
      });
      map.addLayer({
        id: STATE_LEG_OUTLINE_LAYER_ID,
        type: "line",
        source: STATE_LEG_SOURCE_ID,
        layout: { visibility: "none" },
        filter: defaultChamberFilter,
        paint: { "line-color": OUTLINE_COLOR, "line-width": 1.5 },
      });
      map.addLayer({
        id: STATE_LEG_PULSE_LAYER_ID,
        type: "line",
        source: STATE_LEG_SOURCE_ID,
        layout: { visibility: "none" },
        filter: ["all", CONTESTED_FILTER, defaultChamberFilter] as unknown as maplibregl.FilterSpecification,
        paint: { "line-color": CONTESTED_COLOR, "line-width": 3, "line-opacity": 0.85 },
      });
      map.addLayer({
        id: STATE_LEG_LABEL_LAYER_ID,
        type: "symbol",
        source: STATE_LEG_SOURCE_ID,
        layout: {
          "text-field": ["concat", "District ", ["get", "stateDistrict"]],
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
          visibility: "none",
        },
        filter: defaultChamberFilter,
        paint: { "text-color": "#1f2937", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
      });

      // Registered here, after both fill layers exist, rather than
      // synchronously at effect setup — map.on(event, layerId, handler) is
      // itself a layer-scoped query, and MapLibre throws the same "layer
      // does not exist" error queryRenderedFeatures does if the mouse moves
      // over the canvas before the target layer has been added.
      map.on("mousemove", WARDS_FILL_LAYER_ID, handleHoverMove);
      map.on("mouseleave", WARDS_FILL_LAYER_ID, handleHoverLeave);
      map.on("mousemove", COMMISSIONERS_FILL_LAYER_ID, handleHoverMove);
      map.on("mouseleave", COMMISSIONERS_FILL_LAYER_ID, handleHoverLeave);
      map.on("mousemove", STATE_LEG_FILL_LAYER_ID, handleHoverMove);
      map.on("mouseleave", STATE_LEG_FILL_LAYER_ID, handleHoverLeave);

      applyCityFilter(visibleCitiesRef.current);
      // Mode/chamber can change via a click while these fetches were still
      // in flight — setLayerMode/setChamber happened, but applyLayerMode/
      // applyChamberFilter's map.getLayer() guards no-opped since these
      // layers didn't exist yet. Re-apply whatever's current now that they
      // do, rather than trusting each layer's just-added default state.
      applyLayerMode(layerModeRef.current);
      applyChamberFilter(chamberRef.current);

      // Only animate if something's actually contested — with today's data
      // that's never true (see the isContested comment in types.ts), so
      // this costs nothing until real candidate-filing data changes that.
      const anyContested =
        data.features.some((f) => f.properties?.isContested) ||
        commissionersData.features.some((f) => f.properties?.isContested) ||
        stateLegData.features.some((f) => f.properties?.isContested);
      if (anyContested) {
        const animatePulse = (timestamp: number) => {
          // ~2.6s period, slow and steady rather than an alarm-like strobe.
          const t = (Math.sin(timestamp / 420) + 1) / 2; // 0..1
          const width = 2.5 + t * 2.5;
          const opacity = 0.5 + t * 0.5;
          for (const layerId of [WARDS_PULSE_LAYER_ID, COMMISSIONERS_PULSE_LAYER_ID, STATE_LEG_PULSE_LAYER_ID]) {
            if (map.getLayer(layerId)) {
              map.setPaintProperty(layerId, "line-width", width);
              map.setPaintProperty(layerId, "line-opacity", opacity);
            }
          }
          pulseAnimationFrameRef.current = requestAnimationFrame(animatePulse);
        };
        pulseAnimationFrameRef.current = requestAnimationFrame(animatePulse);
      }

      // Fit the map to each layer's actual extent rather than a hardcoded
      // bounding box, so this keeps working if boundaries shift. Stored so
      // clicking away (or switching modes) can fly back to the right view
      // — commissioner districts reach well past the wards' extent, out
      // into the surrounding suburbs.
      const wardsBounds = boundsFromFeatureCollection(data);
      const commissionersBounds = boundsFromFeatureCollection(commissionersData);
      const stateLegBounds = boundsFromFeatureCollection(stateLegData);
      if (!wardsBounds.isEmpty()) wardsBoundsRef.current = wardsBounds;
      if (!commissionersBounds.isEmpty()) commissionersBoundsRef.current = commissionersBounds;
      if (!stateLegBounds.isEmpty()) stateLegBoundsRef.current = stateLegBounds;
      // Same padding zoomToDefault uses, so the very first render doesn't
      // visibly "jump" the moment any subsequent zoom-to-default fires.
      if (!wardsBounds.isEmpty()) {
        map.fitBounds(wardsBounds, {
          padding: isMobileViewport() ? { top: 110, bottom: 40, left: 16, right: 16 } : { top: 80, bottom: 40, left: 320, right: 40 },
          duration: 0,
        });
      }
    });

    const handleHoverMove = (e: maplibregl.MapLayerMouseEvent) => {
      if (!isDesktopHover) return;
      // A click-pinned modal stays put; hover shouldn't swap its content
      // out from under the user while it's pinned open.
      if (selectedRef.current?.pinned) return;
      map.getCanvas().style.cursor = "pointer";
      const feature = e.features?.[0];
      if (!feature) return;
      setSelected({ properties: normalizeRepProperties(feature.properties), pinned: false });
    };
    const handleHoverLeave = () => {
      if (!isDesktopHover) return;
      map.getCanvas().style.cursor = "";
      if (selectedRef.current?.pinned) return;
      setSelected(null);
    };
    // A single, unscoped click handler (rather than one bound to a specific
    // fill layer) so a click that misses every polygon can be told apart
    // from a click that hits one — that's what lets "tap away" zoom back
    // out instead of just doing nothing. Querying both fill layers is safe
    // even though only one is ever visible: a hidden (visibility: "none")
    // layer never appears in queryRenderedFeatures results.
    map.on("click", (e: maplibregl.MapMouseEvent) => {
      // Guard against a click landing before the async load handler has
      // finished adding both fill layers — queryRenderedFeatures throws if
      // any listed layer ID doesn't exist yet, instead of just ignoring it.
      const queryableLayers = [WARDS_FILL_LAYER_ID, COMMISSIONERS_FILL_LAYER_ID, STATE_LEG_FILL_LAYER_ID].filter(
        (id) => map.getLayer(id),
      );
      if (queryableLayers.length === 0) return;
      const features = map.queryRenderedFeatures(e.point, {
        layers: queryableLayers,
      });
      const hit = features[0];
      if (!hit) {
        if (selectedRef.current?.pinned) deselect();
        return;
      }
      const hitProps = normalizeRepProperties(hit.properties);
      setSelected({ properties: hitProps, pinned: true });

      // queryRenderedFeatures returns geometry clipped to whichever
      // internal tile the click landed in, not the feature's true full
      // shape — fitBounds on that would center on the click point rather
      // than the ward/district, especially for large areas near a tile
      // edge. Look the same feature up in the untiled source data fetched
      // at load time for its real geometry instead.
      let sourceData: FeatureCollection | null;
      let matchesHit: (f: Feature) => boolean;
      if (hit.layer.id === COMMISSIONERS_FILL_LAYER_ID) {
        sourceData = commissionersDataRef.current;
        matchesHit = (f) => f.properties?.county === hitProps.county && f.properties?.district === hitProps.district;
      } else if (hit.layer.id === STATE_LEG_FILL_LAYER_ID) {
        sourceData = stateLegDataRef.current;
        matchesHit = (f) => f.properties?.chamber === hitProps.chamber && f.properties?.stateDistrict === hitProps.stateDistrict;
      } else {
        sourceData = wardsDataRef.current;
        matchesHit = (f) => f.properties?.city === hitProps.city && f.properties?.ward === hitProps.ward;
      }
      const fullFeature = sourceData?.features.find(matchesHit);
      zoomToBounds(boundsFromFeature((fullFeature ?? hit) as Feature<Geometry>));
    });

    const handleResize = () => map.resize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (pulseAnimationFrameRef.current !== null) cancelAnimationFrame(pulseAnimationFrameRef.current);
      for (const { marker } of pinMarkersRef.current) marker.remove();
      pinMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hearings =
    selected && selected.properties.ward !== null
      ? getUpcomingHearings(selected.properties.city, selected.properties.ward)
      : [];

  return (
    <div className="relative w-full h-dvh overflow-hidden">
      <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />

      {/* Topbar — always visible regardless of the sidebar's collapsed
          state, so switching government level never requires opening the
          filter panel first. z-[60]: comfortably above every pin's own
          z-index (diameter-based, tops out at 52 for Mayor pins — see
          createRepPinElement) so nothing on the map can render over it. */}
      <div
        className="absolute inset-x-0 top-0 z-[60] h-14 flex items-center px-3 sm:px-4 shadow-sm font-sans"
        style={{ backgroundColor: MN_NAVY, borderBottom: `3px solid ${MN_GREEN}` }}
      >
        <div role="group" aria-label="Choose map layer" className="flex rounded-lg bg-white/10 p-1 text-sm">
          {(["wards", "commissioners", "state-legislature"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => switchMode(mode)}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                layerMode === mode ? "bg-white text-[#003865]" : "text-white/80 hover:bg-white/10 hover:text-white"
              }`}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>

      {/* Filter sidebar — desktop: docked to the left edge, full height,
          slides off-screen via translate-x when collapsed (content stays
          mounted, just off past the left edge, so re-expanding is instant
          rather than re-rendering). Mobile: a card below the topbar whose
          content height collapses instead, since there's no room for a
          full-height dock on a phone-width screen — same z-[60] reasoning
          as the topbar above. */}
      <div
        className={`absolute z-[60] top-14 left-0 right-3 sm:right-auto sm:w-80 md:w-72 md:right-auto md:bottom-0 bg-white/95 md:bg-white backdrop-blur-sm md:backdrop-blur-none border-b md:border-b-0 md:border-r border-neutral-200 shadow-lg md:shadow-none rounded-b-xl md:rounded-none flex flex-col font-sans transition-transform duration-300 ease-out ${
          sidebarCollapsed ? "md:-translate-x-full" : "md:translate-x-0"
        }`}
      >
        <button
          type="button"
          onClick={() => setSidebarCollapsedOverride((prev) => !(prev ?? isMobile))}
          aria-expanded={!sidebarCollapsed}
          aria-controls="sidebar-content"
          className="flex md:hidden items-center justify-between gap-2 px-3.5 py-2.5 text-sm font-semibold"
          style={{ color: MN_NAVY }}
        >
          <span>{layerMode === "state-legislature" ? "Chamber" : "Filter by area"}</span>
          <ChevronDownIcon className={`h-4 w-4 text-[#003865] transition-transform ${sidebarCollapsed ? "" : "rotate-180"}`} />
        </button>

        <div
          id="sidebar-content"
          aria-hidden={sidebarCollapsed}
          className={`overflow-y-auto transition-[max-height] duration-300 ease-out md:!max-h-none md:flex-1 ${
            sidebarCollapsed ? "max-h-0" : "max-h-[45vh]"
          }`}
        >
          {layerMode === "state-legislature" ? (
            // A district doesn't cleanly belong to one Twin City, so this
            // level filters by chamber instead of the Minneapolis/St. Paul
            // checkboxes below — same toggle pattern as the mode switcher.
            <div role="group" aria-label="Choose chamber" className="flex gap-1 px-3.5 pb-3.5 pt-1 md:pt-3.5 text-sm">
              {CHAMBERS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => switchChamber(c)}
                  className={`flex-1 px-3 py-1.5 rounded-md font-medium transition-colors ${
                    chamber === c ? "bg-[#003865] text-white" : "bg-[#EFEFEF] text-neutral-600 hover:bg-neutral-200"
                  }`}
                >
                  {CHAMBER_LABELS[c]}
                </button>
              ))}
            </div>
          ) : (
            <div role="group" aria-label="Filter by area" className="divide-y divide-neutral-100 text-sm text-neutral-700">
              {MODE_VISIBLE_CITIES[layerMode].map((city) => (
                <label
                  key={city}
                  className="flex items-center gap-2 px-3.5 py-2.5 sm:py-2 cursor-pointer select-none hover:bg-neutral-50"
                >
                  <input
                    type="checkbox"
                    checked={visibleCities[city]}
                    onChange={() => toggleCity(city)}
                    className="cursor-pointer accent-[#78BE21]"
                  />
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: CITY_ACCENT[city] }}
                  />
                  {MODE_FILTER_LABELS[layerMode][city]}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Desktop-only pull-tab — the header button above is mobile-only
            (md:hidden), so desktop needs its own always-visible trigger to
            re-expand a collapsed sidebar. */}
        <button
          type="button"
          onClick={() => setSidebarCollapsedOverride((prev) => !(prev ?? isMobile))}
          aria-expanded={!sidebarCollapsed}
          aria-controls="sidebar-content"
          aria-label="Toggle filters panel"
          className="hidden md:flex absolute z-[60] items-center justify-center bg-white border border-neutral-200 border-l-0 text-[#003865]/60 hover:text-[#003865] hover:bg-neutral-50 transition-colors top-1/2 right-0 translate-x-full -translate-y-1/2 w-7 h-12 rounded-r-lg shadow-sm"
        >
          <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform -rotate-90 ${sidebarCollapsed ? "rotate-90" : ""}`} />
        </button>
      </div>

      {selected && (
        <div className="absolute inset-x-0 bottom-0 z-[70] flex justify-center pointer-events-none pb-[env(safe-area-inset-bottom)] sm:inset-x-auto sm:justify-end sm:right-4 sm:left-auto sm:bottom-4 sm:pb-0">
          <WardModal
            ward={selected.properties}
            hearings={hearings}
            pinned={selected.pinned}
            onClose={deselect}
          />
        </div>
      )}
    </div>
  );
}
