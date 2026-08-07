"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { AddressIndex, MnPlaces, RepProperties, WardRef } from "@/lib/types";
import type { AreaOfficials, CivicGeometrySources } from "@/lib/officials";
import { officialIdentity, resolveOfficialsAtPoint } from "@/lib/officials";
import { CITIES, type City } from "@/lib/cities";
import {
  CITY_ACCENT,
  CITY_PALETTES,
  CONTESTED_COLOR,
  NEUTRAL_PARTY_COLOR,
  PARTY_COLORS,
  partyColor,
  partyColorSoft,
} from "@/lib/cityTheme";
import {
  clearStoredMapStyleId,
  getInitialMapStyleId,
  getMapStyleIdForTheme,
  getMapStyleUrlById,
  isMapStyleDark,
  storeMapStyleId,
} from "@/lib/mapStyles";
import { getActiveTheme, setTheme, type SiteTheme } from "@/lib/siteTheme";
import { readStored, writeStored } from "@/lib/storage";
import MapThemeSelector from "./MapThemeSelector";
import MobileNav, { IconSearch, IconSliders, type MobileNavTab } from "./MobileNav";
import SearchBar from "./SearchBar";
import SiteHeader from "./SiteHeader";
import WardModal, { areaLabel, roleLabel } from "./WardModal";

// The two destinations MobileNav's bottom bar offers — everything the
// desktop chrome spreads across the header's search box and the top-left
// mode/filter stack, folded into one tab bar below `sm`. The theme/basemap
// popover isn't a third destination here: MapThemeSelector renders at the
// same map corner on every breakpoint (see #map-corner-controls below)
// rather than being tucked into a mobile-only tab, so there's nothing
// mobile-specific left for this type to name for it. See MobileNav's own
// comment for why a tab's sheet and the priority ward modal never compete
// for the same slot.
type MobileSheetId = "search" | "filters";

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

const CHAMBERS = ["house", "senate"] as const;
type Chamber = (typeof CHAMBERS)[number];
const CHAMBER_LABELS: Record<Chamber, string> = { house: "MN House", senate: "MN Senate" };

// Desktop-only (sm+) — whether the left filters / right rep-detail
// sidebar is collapsed to reclaim map width, modeled on mndatacenter.org's
// own pull-tab sidebar toggle. "0"/"1" rather than JSON: a plain flag is
// the only shape either key ever holds, same convention siteTheme.ts uses
// for the chrome theme. Persisted (not just component state) so a
// resident who collapses the filters to see more map keeps that choice
// across visits, same as their basemap/theme pick.
const LEFT_FILTERS_COLLAPSED_KEY = "mapFiltersCollapsed";
const RIGHT_DETAIL_COLLAPSED_KEY = "mapDetailCollapsed";

function isCollapsedFlag(value: string): value is "0" | "1" {
  return value === "0" || value === "1";
}
function readCollapsedFlag(key: string): boolean {
  return readStored(key, isCollapsedFlag, "0") === "1";
}
function writeCollapsedFlag(key: string, collapsed: boolean): void {
  writeStored(key, collapsed ? "1" : "0");
}

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

// Outline/label colors are tuned against the *basemap's* own darkness
// (isMapStyleDark), not this app's light/dark chrome theme — a resident can
// pick a dark basemap (Fiord, Dark Mode) under either chrome theme, or a
// light one, independently, via MapThemeSelector. Boundaries drawn in the
// light-basemap colors below would be nearly invisible against a dark tile
// background, and vice versa.
const OUTLINE_COLOR = { light: "#44403c", dark: "#e7e5e4" };
const LABEL_PAINT = {
  light: { "text-color": "#1f2937", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
  dark: { "text-color": "#f5f5f4", "text-halo-color": "#0a0a0a", "text-halo-width": 1.4 },
} as const;

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

// Every applicable official across all three tiers for one map point,
// resolved independently of which single LayerMode is currently visible on
// the map — see src/lib/officials.ts's resolveOfficialsAtPoint. The anchor
// point itself isn't kept here: nothing currently needs to re-resolve a
// stale selection from it (toggleCity, the one place that touches an
// existing selection after the fact, filters `officials` directly instead
// — see its own comment).
interface SelectedArea {
  officials: AreaOfficials;
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

// Plain-language summary for the sr-only announcement above — see
// `announcement` state's own comment for why this only ever fires from a
// pinned selection, never a hover.
function summarizeOfficials(officials: AreaOfficials): string {
  const parts: string[] = [];
  if (officials.city.length > 0) parts.push(`${officials.city.length} city`);
  if (officials.county.length > 0) parts.push(`${officials.county.length} county`);
  if (officials.state.length > 0) parts.push(`${officials.state.length} state`);
  if (parts.length === 0) return "No representatives found for this location on any mapped layer.";
  return `Showing representatives for this location: ${parts.join(", ")}.`;
}

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

function boundsFromFeatureCollection(data: FeatureCollection): maplibregl.LngLatBounds {
  const bounds = new maplibregl.LngLatBounds();
  for (const feature of data.features) {
    if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") continue;
    bounds.extend(boundsFromFeature(feature as Feature<Geometry>));
  }
  return bounds;
}

interface CivicData {
  wards: FeatureCollection;
  mayors: FeatureCollection;
  commissioners: FeatureCollection;
  stateLeg: FeatureCollection;
}

// Fetches the four public/*.geojson layers independently of the MapLibre
// instance — previously this ran inside map.on("load"), which meant a
// resident whose map never finishes loading (WebGL unavailable, tile
// host down) could never get ward data either, silently breaking search
// along with the map itself. AGENTS.md Part 4 requires search to work
// "with the map absent, failed, or never loaded," so this now runs on
// its own, and the map-setup effect below awaits the same promise
// instead of fetching a second time. Never throws: a failed fetch
// resolves null so the caller can degrade (empty map, search that
// honestly has nothing to search) rather than crash.
async function fetchCivicData(): Promise<CivicData | null> {
  try {
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
    const [wards, mayors, commissioners, stateLeg] = await Promise.all([
      wardsRes.json(),
      mayorsRes.json(),
      commissionersRes.json(),
      stateLegRes.json(),
    ]);
    return { wards, mayors, commissioners, stateLeg };
  } catch (err) {
    console.error("[WardMap] failed to load civic data", err);
    return null;
  }
}

// MapLibre tiles GeoJSON sources internally (even client-side ones), and
// that vector-tile-style property encoding has no null type — a `null` in
// the source data comes back as `undefined` on features returned by
// queryRenderedFeatures. Every nullable RepProperties field is checked
// with strict `!== null` downstream (WardModal's role/area labels), so
// re-normalize undefined back to null here, once, right where features
// leave MapLibre's hands. Mayor markers don't need this — their
// properties come straight from the fetched JSON, never through
// MapLibre's tiling.
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

// Every resolveSelectionAtPoint call site starts from a different MapLibre
// coordinate shape — a mousemove event's `e.lngLat`, a marker's own
// `LngLatLike` (a raw `[lng, lat]` tuple in some places, a `LngLat` from
// `bounds.getCenter()` in others), a search result's bounds center — one
// place to normalize any of them into the `[lng, lat]` Position tuple
// resolveOfficialsAtPoint expects (GeoJSON's own coordinate order),
// instead of every call site repeating its own `.convert()`/destructure
// and risking a transposed lat/lng on some future edit.
function toPoint(lngLat: maplibregl.LngLatLike): [number, number] {
  const converted = maplibregl.LngLat.convert(lngLat);
  return [converted.lng, converted.lat];
}

function isMobileViewport(): boolean {
  return window.innerWidth < 768;
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
  // container, so z-index here does control their relative stacking —
  // and *only* their relative stacking: the map container renders with
  // `isolate` (see the z-index scale comment on WardMap's return) so
  // these values (up to ~52) never leak out and compete with the search
  // bar or modal's own z-index further up the tree.
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

// The two sidebar collapse toggles' chevron — one glyph, pointed left by
// default, rotated 180° by the caller when it should point right instead
// of a second mirrored SVG path. `className` carries the rotation (and
// nothing else caller-specific), so both toggle buttons below can share
// this one definition.
function IconChevron({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`h-3.5 w-3.5 shrink-0 transition-transform duration-300 ease-out ${className}`}
    >
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function WardMap() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Mount points for MapLibre's NavigationControl and AttributionControl
  // — see the map-setup effect below for why they're mounted here by
  // hand (control.onAdd(map)) instead of via map.addControl(), which
  // would hand them to MapLibre's own bottom-right corner container
  // instead of #map-corner-controls.
  const navControlMountRef = useRef<HTMLDivElement | null>(null);
  const attribControlMountRef = useRef<HTMLDivElement | null>(null);
  const wardsBoundsRef = useRef<maplibregl.LngLatBounds | null>(null);
  const commissionersBoundsRef = useRef<maplibregl.LngLatBounds | null>(null);
  const stateLegBoundsRef = useRef<maplibregl.LngLatBounds | null>(null);
  // The untouched fetch results, kept around so a click can look up a
  // ward/district's true full geometry — see the comment on the click
  // handler for why queryRenderedFeatures's own geometry isn't good
  // enough for that.
  const wardsDataRef = useRef<FeatureCollection | null>(null);
  const mayorsDataRef = useRef<FeatureCollection | null>(null);
  const commissionersDataRef = useRef<FeatureCollection | null>(null);
  const stateLegDataRef = useRef<FeatureCollection | null>(null);
  // The in-flight/settled fetchCivicData() call — a ref (not state)
  // because the map-setup effect below needs to `await` this exact
  // promise instance rather than re-fetch, and refs (unlike state) are
  // readable synchronously the moment the effect that set them has run.
  const civicDataPromiseRef = useRef<Promise<CivicData | null> | null>(null);
  const [addressIndex, setAddressIndex] = useState<AddressIndex | null>(null);
  const [mnPlaces, setMnPlaces] = useState<MnPlaces | null>(null);
  const pinMarkersRef = useRef<PinMarker[]>([]);
  const pulseAnimationFrameRef = useRef<number | null>(null);
  // The `officialIdentity` of whichever fill-layer feature the cursor was
  // last resolved against — lets handleHoverMove below skip re-running
  // resolveSelectionAtPoint (three point-in-polygon scans plus a React
  // re-render of up to six OfficialCards) on every one of the many
  // mousemove events fired while the cursor sits inside the SAME polygon,
  // only paying that cost again when the hovered feature actually changes.
  const lastHoverIdentityRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<SelectedArea | null>(null);
  const selectedRef = useRef<SelectedArea | null>(null);
  // Screen-reader announcement for the detail panel — set only from a
  // pinned (click/tap/search-result) selection, never from hover, same
  // "don't move focus, just announce" pattern as SearchBar's own
  // aria-live region. The panel now holds up to six officials across
  // three sections and repopulates on every hover; announcing that on
  // every mousemove would be disruptive noise for anyone pairing a
  // screen reader with a sighted mouse user panning the map, so hover
  // updates `selected` (for sighted users) without ever touching this.
  const [announcement, setAnnouncement] = useState("");
  // Mobile-only — which of MobileNav's three tabs (if any) currently has
  // its sheet raised. Doesn't need a ref alongside selectedRef: the map
  // effect below only ever *sets* this (clearing it back to null when a
  // pin/polygon gets tapped), never reads its current value, so a stale
  // closure over the setter is harmless — setState setters are stable
  // across renders regardless of when the closure capturing them was made.
  const [activeMobileSheet, setActiveMobileSheet] = useState<MobileSheetId | null>(null);
  const [layerMode, setLayerMode] = useState<LayerMode>("wards");
  const layerModeRef = useRef(layerMode);
  const [visibleCities, setVisibleCities] = useState<Record<City, boolean>>(
    () => Object.fromEntries(CITIES.map((city) => [city, true])) as Record<City, boolean>,
  );
  const visibleCitiesRef = useRef(visibleCities);
  const [chamber, setChamber] = useState<Chamber>("house");
  const chamberRef = useRef(chamber);
  // Sidebar collapse state — see LEFT_FILTERS_COLLAPSED_KEY's own comment.
  // Both default to false (expanded) here rather than reading storage in
  // the initializer, same SSR-safety reasoning as mapStyleId/siteTheme
  // below: corrected once, after mount, in its own effect further down.
  const [leftFiltersCollapsed, setLeftFiltersCollapsedState] = useState(false);
  const [rightDetailCollapsed, setRightDetailCollapsedState] = useState(false);
  // Read by selectPinned, which runs from click handlers registered once
  // inside the map-construction effect below — without a ref, that
  // closure would keep whatever value was current at mount forever, the
  // same staleness every other frequently-changing piece of state in this
  // component (layerMode, visibleCities, chamber) already guards against
  // the same way.
  const rightDetailCollapsedRef = useRef(rightDetailCollapsed);
  // MapThemeSelector's own display state — which basemap/chrome-theme is
  // currently active, for its checkmarks. Placeholder defaults (matching
  // DEFAULT_SITE_THEME/its paired basemap) that get corrected to the real
  // stored choice inside the map-construction effect below, once — reading
  // localStorage/`document.documentElement` during render would break SSR,
  // so this can't happen in the useState initializer itself. The popover is
  // closed by default, so there's nothing to flash before that correction
  // lands on mount.
  const [mapStyleId, setMapStyleId] = useState<string>(getMapStyleIdForTheme("light"));
  const [siteTheme, setSiteThemeState] = useState<SiteTheme>("light");
  // Bridges MapThemeSelector's click handlers (component-level, called from
  // the render below) to the actual setStyle()/re-add-layers logic, which
  // has to live inside the map-construction effect since it closes over
  // `map` and the hover handlers — same pattern as mapRef/wardsDataRef
  // already bridge that effect's internals out to the rest of the component.
  const switchBasemapRef = useRef<(styleId: string) => void>(() => {});

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

  useEffect(() => {
    rightDetailCollapsedRef.current = rightDetailCollapsed;
  }, [rightDetailCollapsed]);

  const setLeftFiltersCollapsed = (collapsed: boolean) => {
    setLeftFiltersCollapsedState(collapsed);
    writeCollapsedFlag(LEFT_FILTERS_COLLAPSED_KEY, collapsed);
  };
  const setRightDetailCollapsed = (collapsed: boolean) => {
    setRightDetailCollapsedState(collapsed);
    writeCollapsedFlag(RIGHT_DETAIL_COLLAPSED_KEY, collapsed);
  };

  // Map-independent: runs regardless of whether MapLibre ever
  // successfully constructs. See fetchCivicData's comment for why this
  // is its own effect rather than living inside map.on("load").
  useEffect(() => {
    const promise = fetchCivicData();
    civicDataPromiseRef.current = promise;
    promise.then((data) => {
      if (!data) return;
      wardsDataRef.current = data.wards;
      mayorsDataRef.current = data.mayors;
      commissionersDataRef.current = data.commissioners;
      stateLegDataRef.current = data.stateLeg;
      const wardsBounds = boundsFromFeatureCollection(data.wards);
      const commissionersBounds = boundsFromFeatureCollection(data.commissioners);
      const stateLegBounds = boundsFromFeatureCollection(data.stateLeg);
      if (!wardsBounds.isEmpty()) wardsBoundsRef.current = wardsBounds;
      if (!commissionersBounds.isEmpty()) commissionersBoundsRef.current = commissionersBounds;
      if (!stateLegBounds.isEmpty()) stateLegBoundsRef.current = stateLegBounds;
    });
  }, []);

  // The address/ZIP gazetteer (a few MB — see scripts/fetch-addresses.mjs)
  // that powers SearchBar's street-address and ZIP lookups. Fetched
  // separately from wards/mayors/etc. above since SearchBar is the only
  // consumer — city and county search work off wardsDataRef instead and
  // don't need to wait on this at all.
  useEffect(() => {
    let cancelled = false;
    fetch("/address-index.json", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: AddressIndex) => {
        if (!cancelled) setAddressIndex(data);
      })
      .catch((err) => console.error("[WardMap] failed to load address index", err));
    return () => {
      cancelled = true;
    };
  }, []);

  // The full Minnesota city/county gazetteer (public/mn-places.json, a
  // few dozen KB — see scripts/fetch-places.mjs) that lets SearchBar
  // recognize *any* MN place name, not just the ones in src/lib/cities.ts
  // this app has ward data for. Fetched separately for the same reason as
  // address-index.json above: it's its own independent, lazily-loaded
  // concern, and covered-city/-county search already works without it.
  useEffect(() => {
    let cancelled = false;
    fetch("/mn-places.json", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: MnPlaces) => {
        if (!cancelled) setMnPlaces(data);
      })
      .catch((err) => console.error("[WardMap] failed to load MN place list", err));
    return () => {
      cancelled = true;
    };
  }, []);

  const zoomToBounds = (bounds: maplibregl.LngLatBounds) => {
    const map = mapRef.current;
    if (!map) return;
    // Mobile still needs bottom padding reserved: the rep detail modal is a
    // bottom sheet there, floating over the map, and fitBounds would
    // otherwise center the target in the full viewport with the sheet
    // covering it. Desktop no longer needs the equivalent reservation — the
    // detail panel lives in its own right `<aside>` now (see the return
    // below), so the map's own box already excludes that width; there's
    // nothing left floating on top of it to pad around.
    map.fitBounds(bounds, {
      padding: isMobileViewport() ? { top: 60, bottom: 260, left: 40, right: 40 } : 60,
      duration: 600,
    });
  };

  const zoomToDefault = (mode: LayerMode = layerModeRef.current) => {
    const map = mapRef.current;
    const bounds =
      mode === "wards" ? wardsBoundsRef.current : mode === "commissioners" ? commissionersBoundsRef.current : stateLegBoundsRef.current;
    if (!map || !bounds) return;
    map.fitBounds(bounds, { padding: 40, duration: 600 });
  };

  const deselect = () => {
    setSelected(null);
    setAnnouncement("Representative panel closed.");
    zoomToDefault();
  };

  // City AND county tier officials are both grouped/keyed by rep.city — per
  // RepProperties's own comment in types.ts, a Hennepin commissioner
  // district groups with Minneapolis, Ramsey with St. Paul, even though
  // "county" is the accurate display label — and applyCityFilter already
  // hides both wards' AND commissioners' map layers/pins together for a
  // hidden city (see its own body further down). A hidden city's officials
  // are dropped from the resolved selection the same way, so
  // hovering/clicking anywhere near a hidden city's ward or commissioner
  // district never surfaces it in the panel either. State has no per-city
  // visibility toggle at all, so it's untouched. Takes `visibility`
  // explicitly (rather than reading visibleCitiesRef itself) so a caller
  // that just computed a new map (toggleCity, below) can filter against
  // that value before the ref itself catches up — see toggleCity's own
  // comment on why the ref lags by one tick.
  const filterHiddenCityOfficials = (officials: AreaOfficials, visibility: Record<City, boolean>): AreaOfficials => {
    const isVisible = (rep: RepProperties) => visibility[rep.city as City] !== false;
    const city = officials.city.filter(isVisible);
    const county = officials.county.filter(isVisible);
    if (city.length === officials.city.length && county.length === officials.county.length) return officials;
    return { ...officials, city, county };
  };

  // The single entry point every hover/click/pin-interaction now goes
  // through to populate the detail panel — resolves all three tiers
  // (city/county/state) at once for a map point, independent of which
  // single LayerMode is currently visible. See src/lib/officials.ts's
  // resolveOfficialsAtPoint for why this is a plain on-device
  // point-in-polygon lookup rather than a MapLibre queryRenderedFeatures
  // call (which can't see a hidden layer's features at all). `known`, when
  // the caller already has an exact RepProperties for one office (a
  // clicked pin, a fill-layer click's own resolved feature), is force-
  // included in its tier — see that function's own comment for why.
  const resolveSelectionAtPoint = (point: [number, number], known?: RepProperties): AreaOfficials => {
    const sources: CivicGeometrySources = {
      wards: wardsDataRef.current,
      mayors: mayorsDataRef.current,
      commissioners: commissionersDataRef.current,
      stateLeg: stateLegDataRef.current,
    };
    return filterHiddenCityOfficials(resolveOfficialsAtPoint(point, sources, known), visibleCitiesRef.current);
  };

  // The one path every click/tap/search-result selection runs through
  // (as opposed to a hover, which sets `selected` directly — see
  // handleHoverMove below). An explicit selection always means "show the
  // detail panel," so this force-expands the right sidebar if a resident
  // had collapsed it — unlike a hover, which never reopens a sidebar
  // they've deliberately hidden; see the right toggle button's own
  // comment further down for why that asymmetry is deliberate.
  const selectPinned = (officials: AreaOfficials) => {
    setSelected({ officials, pinned: true });
    setAnnouncement(summarizeOfficials(officials));
    if (rightDetailCollapsedRef.current) setRightDetailCollapsed(false);
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
      // Mirrored onto the ref synchronously (not just via the effect that
      // normally keeps it in sync, further up) — applySearchResult can call
      // prepareWardsView, which can call this same toggleCity, and then
      // immediately (same tick) call resolveSelectionAtPoint, which reads
      // visibleCitiesRef.current. Without this, that read would still see
      // the stale (hidden) value the effect hasn't caught up to yet, and a
      // search result would un-hide a city on the map while the panel it
      // opens still filters that city's own official back out.
      visibleCitiesRef.current = next;
      applyCityFilter(next);
      // If hiding this city empties the panel's City (and County, which
      // shares the same per-city visibility — see filterHiddenCityOfficials)
      // section, re-filter what's shown. If that leaves every tier empty,
      // close the panel outright rather than leaving it open, zoomed in, on
      // three "not covered here" notes for content the user just hid.
      if (!next[city] && selectedRef.current) {
        const current = selectedRef.current;
        const filtered = filterHiddenCityOfficials(current.officials, next);
        if (filtered !== current.officials) {
          const allEmpty = filtered.city.length === 0 && filtered.county.length === 0 && filtered.state.length === 0;
          if (allEmpty) {
            deselect();
          } else {
            setSelected({ ...current, officials: filtered });
            setAnnouncement(summarizeOfficials(filtered));
          }
        }
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

  // A resident picking a basemap by hand makes it sticky (storeMapStyleId) —
  // unlike selectSiteTheme below, which applies a basemap too but doesn't
  // persist it as an explicit choice. See mapStyles.ts's own comments for
  // why that distinction is what keeps the theme/basemap pairing reachable
  // for anyone who's never hand-picked a basemap.
  const selectMapStyle = (styleId: string) => {
    storeMapStyleId(styleId);
    switchBasemapRef.current(styleId);
  };

  // Chrome theme and basemap move together: picking Light also drops the
  // map to its paired basemap, and likewise for Dark — one decision in a
  // resident's head ("make this light"), not two independent ones. This
  // *clears* any hand-picked basemap rather than persisting the one it just
  // applied, so a later repointing of THEME_BASEMAP still reaches everyone
  // who's only ever used the paired default.
  const selectSiteTheme = (theme: SiteTheme) => {
    setTheme(theme);
    setSiteThemeState(theme);
    clearStoredMapStyleId();
    switchBasemapRef.current(getMapStyleIdForTheme(theme));
  };

  // Same as zoomToBounds, but without the padding it reserves for the
  // pinned modal — city/county search results never open one (there's no
  // single rep to show), so reserving that space would just leave the
  // view off-center for nothing.
  const zoomToBoundsNoModal = (bounds: maplibregl.LngLatBounds) => {
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(bounds, { padding: 40, duration: 600 });
  };

  // Ensures wards mode is showing and the target city is visible before
  // acting — a search result is meaningless in commissioners/state-
  // legislature mode (only wards carry ward numbers) or against a city
  // the user has filtered out. Mirrors switchMode's own steps but skips
  // its zoomToDefault() call, which would zoom out to the full wards
  // extent right before the search's own zoom call zoomed back in — a
  // visible double-animation for what should read as one motion.
  const prepareWardsView = (city: City) => {
    if (layerModeRef.current !== "wards") {
      setLayerMode("wards");
      applyLayerMode("wards");
    }
    if (!visibleCitiesRef.current[city]) toggleCity(city);
  };

  // The three SearchBar outcomes that resolve to a map action — see
  // SearchOutcome in src/lib/addressSearch.ts. Ward identity itself was
  // already decided on-device (by scripts/fetch-addresses.mjs at build
  // time for addresses/ZIPs, or is a direct property lookup for city/
  // county); these just replay the same select-and-zoom steps a real
  // click on the polygon would produce.
  const applySearchResult = (ref: WardRef) => {
    prepareWardsView(ref.city as City);
    const feature = wardsDataRef.current?.features.find(
      (f) => f.properties?.city === ref.city && f.properties?.ward === ref.ward,
    );
    if (!feature) return; // wardsDataRef isn't ready yet, or the ref is stale
    const bounds = boundsFromFeature(feature as Feature<Geometry>);
    // The ward itself is seeded via `known` regardless, so this anchor only
    // has to be "somewhere inside the district" for County/State — same
    // bounds-center approximation already used to place ward/commissioner/
    // state-leg pins (see addPin's own callers below), not a new risk this
    // introduces. For a concave or river-split ward the bbox center could
    // in principle fall in a different county or district than the ward
    // itself; accepted here for the same reason it's accepted for pin
    // placement — there's no ward "office address" to anchor to instead.
    const point = toPoint(bounds.getCenter());
    const known = normalizeRepProperties(feature.properties);
    selectPinned(resolveSelectionAtPoint(point, known));
    // Closes MobileNav's Search sheet on mobile so the ward modal (which
    // takes over the sheet slot the instant `selected` is non-null) isn't
    // left stacked behind it — a no-op on desktop, where nothing opened a
    // mobile sheet to begin with.
    setActiveMobileSheet(null);
    zoomToBounds(bounds);
  };

  const applyCityZoom = (city: City) => {
    prepareWardsView(city);
    const cityWards = wardsDataRef.current?.features.filter((f) => f.properties?.city === city);
    if (!cityWards || cityWards.length === 0) return;
    setSelected(null);
    setActiveMobileSheet(null); // reveal the zoomed-to result instead of leaving the Search sheet up over it
    zoomToBoundsNoModal(boundsFromFeatureCollection({ type: "FeatureCollection", features: cityWards }));
  };

  const applyCountyZoom = (cities: City[]) => {
    for (const city of cities) prepareWardsView(city);
    const citySet = new Set<City>(cities);
    const countyWards = wardsDataRef.current?.features.filter((f) => citySet.has(f.properties?.city as City));
    if (!countyWards || countyWards.length === 0) return;
    setSelected(null);
    setActiveMobileSheet(null); // same as applyCityZoom above
    zoomToBoundsNoModal(boundsFromFeatureCollection({ type: "FeatureCollection", features: countyWards }));
  };

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Which basemap is loaded right now — read once here rather than from
    // `mapStyleId` state, since this effect runs before that state's own
    // corrective render lands, and updated in step by switchBasemap below
    // (which also keeps `mapStyleId` state in sync for MapThemeSelector's
    // checkmark). A resident's saved theme (or its paired basemap, if
    // they've never hand-picked one) is what a fresh map opens on, so a
    // light-theme visitor never gets a dark basemap on first paint.
    let currentStyleId = getInitialMapStyleId();
    setMapStyleId(currentStyleId);
    setSiteThemeState(getActiveTheme());
    // Same correction-after-mount as the two calls above, same reason
    // (reading localStorage during the useState initializer would
    // mismatch server- vs. client-rendered markup) — folded into this
    // effect rather than a dedicated one of their own so the correction
    // is one render, not two: a lone effect whose only job is a setState
    // correction is the exact "don't use an effect for this" case
    // react-hooks/set-state-in-effect flags, and rightly so on its own,
    // but this effect already has to run on mount to construct the map
    // regardless, so piggybacking the correction here costs nothing extra.
    setLeftFiltersCollapsedState(readCollapsedFlag(LEFT_FILTERS_COLLAPSED_KEY));
    setRightDetailCollapsedState(readCollapsedFlag(RIGHT_DETAIL_COLLAPSED_KEY));

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: getMapStyleUrlById(currentStyleId),
      center: TWIN_CITIES_CENTER,
      zoom: DEFAULT_ZOOM,
      // Built manually below and mounted into #map-corner-controls, not
      // via this option or map.addControl() — both of those hand the
      // control to MapLibre's own bottom-right corner container, which
      // this app no longer uses (see the JSX for
      // #map-corner-controls, the single flex wrapper that now owns the
      // zoom, attribution, and theme-selector stack together).
      attributionControl: false,
      cooperativeGestures: isMobileViewport(),
    });
    mapRef.current = map;

    // Mounted by hand (control.onAdd(map) → append the returned element
    // ourselves) rather than map.addControl(), so all three of zoom,
    // attribution, and MapThemeSelector's toggle live as ordinary flex
    // children of one div this component owns (#map-corner-controls,
    // in the JSX below) instead of two of them being locked into
    // MapLibre's own separately-positioned corner container. onRemove()
    // is called explicitly in this effect's cleanup for the same
    // reason: map.remove() only tears down controls it thinks it owns
    // via its own _controls list, which these were deliberately kept
    // out of.
    const navControl = new maplibregl.NavigationControl({ showCompass: false });
    if (navControlMountRef.current) navControlMountRef.current.appendChild(navControl.onAdd(map));

    const attribControl = new maplibregl.AttributionControl({ compact: true });
    const attribEl = attribControl.onAdd(map);
    if (attribControlMountRef.current) attribControlMountRef.current.appendChild(attribEl);

    // MapLibre's AttributionControl starts *expanded* the first time
    // attributions populate, even with `compact: true` set — its own
    // _updateCompact() adds `maplibregl-compact-show` unconditionally on
    // first run and only collapses it later, in response to a `drag`
    // event. Left alone, that means the attribution badge briefly
    // renders as a full text bar rather than the small "i" badge a
    // resident expects. A MutationObserver, not a fixed timeout, catches
    // the class the instant MapLibre adds it regardless of how long the
    // style/sources take to load, and only fires once — after that, a
    // resident's own click on the attribution badge toggles it normally.
    const collapseAttribOnce = () => {
      if (!attribEl.classList.contains("maplibregl-compact-show")) return;
      attribEl.classList.remove("maplibregl-compact-show");
      attribEl.removeAttribute("open");
      attribObserver.disconnect();
    };
    const attribObserver = new MutationObserver(collapseAttribOnce);
    attribObserver.observe(attribEl, { attributes: true, attributeFilter: ["class"] });
    collapseAttribOnce();

    const isDesktopHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    map.on("error", (e) => {
      console.error("[MapLibre ERROR]", e.error?.message ?? e);
    });

    // Pins are plain DOM markers (maplibregl.Marker), not part of the
    // MapLibre style — they survive a setStyle() basemap swap on their own,
    // so this only ever runs once, guarded by pinMarkersRef itself rather
    // than being re-invoked from switchBasemap below the way
    // addSourcesAndLayers is.
    const addPins = (civicData: CivicData) => {
      if (pinMarkersRef.current.length > 0) return;
      const { wards: data, mayors: mayorsData, commissioners: commissionersData, stateLeg: stateLegData } = civicData;

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
      ) => {
        const el = createRepPinElement(properties, diameter);
        const marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(coordinates).addTo(map);
        // A pin's own coordinate always seeds `properties` into its own
        // tier (via resolveSelectionAtPoint's `known` param) — the other
        // two tiers still resolve by point-in-polygon at that same spot.
        const point = toPoint(coordinates);

        el.addEventListener("mouseenter", () => {
          if (!isDesktopHover || selectedRef.current?.pinned) return;
          setSelected({ officials: resolveSelectionAtPoint(point, properties), pinned: false });
        });
        el.addEventListener("mouseleave", () => {
          if (!isDesktopHover || selectedRef.current?.pinned) return;
          setSelected(null);
        });
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          selectPinned(resolveSelectionAtPoint(point, properties));
          setActiveMobileSheet(null); // see applySearchResult's comment on this same call
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

      // One pin per council member, centered on their ward — same
      // bounds-center-as-marker-position approach as commissioners below,
      // since (unlike mayors) there's no single office address to anchor to.
      // A handful of wards (Blaine's, currently) seat two members off one
      // shared polygon — bounds-center would place both pins on the exact
      // same coordinate, so the second (and any further) occurrence of a
      // given city+ward is nudged sideways to stay independently clickable.
      // The polygon itself (fill/outline/zoom target) is untouched — only
      // the pin marker's coordinate shifts.
      const wardPinOccurrences = new Map<string, number>();
      for (const feature of data.features) {
        if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") continue;
        const properties = feature.properties as RepProperties;
        const bounds = boundsFromFeature(feature as Feature<Geometry>);
        const wardKey = `${properties.city}-${properties.ward}`;
        const occurrence = wardPinOccurrences.get(wardKey) ?? 0;
        wardPinOccurrences.set(wardKey, occurrence + 1);
        const center = bounds.getCenter();
        const coordinates: maplibregl.LngLatLike =
          occurrence === 0 ? center : [center.lng + occurrence * 0.0015, center.lat];
        addPin(properties, coordinates, PIN_DIAMETER_BY_ROLE["Council Member"], "wards", bounds);
      }

      // One pin per commissioner, same interaction pattern as mayors, but
      // there's no office address to anchor to — a district's bounds
      // center stands in for "somewhere inside the district" well enough
      // for a marker (as opposed to fitBounds, which needs the real shape).
      for (const feature of commissionersData.features) {
        if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") continue;
        const properties = feature.properties as RepProperties;
        const bounds = boundsFromFeature(feature as Feature<Geometry>);
        addPin(properties, bounds.getCenter(), PIN_DIAMETER_BY_ROLE["County Commissioner"], "commissioners", bounds);
      }

      // One pin per state legislator — role (and so pin size) varies
      // feature-to-feature here, unlike the loops above, since a single
      // source covers both House and Senate districts.
      for (const feature of stateLegData.features) {
        if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") continue;
        const properties = feature.properties as RepProperties;
        const bounds = boundsFromFeature(feature as Feature<Geometry>);
        addPin(properties, bounds.getCenter(), PIN_DIAMETER_BY_ROLE[properties.role], "state-legislature", bounds);
      }
    };

    // Sources and every fill/outline/pulse/label layer built off them —
    // unlike pins, these ARE part of the MapLibre style, so setStyle()
    // throws all of it away on a basemap swap. Guarded (not by a ref, but
    // by map.getSource itself) so it's safe to call both from the initial
    // "load" below and from switchBasemap's "style.load" after every
    // subsequent swap — the guard passes either way, since a fresh style
    // genuinely has none of these sources yet.
    const addSourcesAndLayers = (civicData: CivicData) => {
      if (map.getSource(WARDS_SOURCE_ID)) return;
      const { wards: data, commissioners: commissionersData, stateLeg: stateLegData } = civicData;

      // Tuned against the *current basemap's* own darkness — see
      // OUTLINE_COLOR/LABEL_PAINT's own comment — recomputed on every call
      // so a swap to/from a dark basemap re-colors boundaries and labels
      // along with it, not just the tiles underneath them.
      const dark = isMapStyleDark(currentStyleId);
      const outlineColor = dark ? OUTLINE_COLOR.dark : OUTLINE_COLOR.light;
      const labelPaint = dark ? LABEL_PAINT.dark : LABEL_PAINT.light;

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
        paint: { "line-color": outlineColor, "line-width": 1.5 },
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
        paint: labelPaint,
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
        paint: { "line-color": outlineColor, "line-width": 1.5 },
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
        paint: labelPaint,
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
        paint: { "line-color": outlineColor, "line-width": 1.5 },
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
        paint: labelPaint,
      });

      // Registered here, after both fill layers exist, rather than
      // synchronously at effect setup — map.on(event, layerId, handler) is
      // itself a layer-scoped query, and MapLibre throws the same "layer
      // does not exist" error queryRenderedFeatures does if the mouse moves
      // over the canvas before the target layer has been added. Re-bound on
      // every call (including after a basemap swap) since setStyle() drops
      // these layer-scoped listeners along with the layers themselves.
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
      // do, rather than trusting each layer's just-added default state —
      // also what keeps the current mode/city/chamber selection intact
      // across a basemap swap, since switchBasemap calls this too.
      applyLayerMode(layerModeRef.current);
      applyChamberFilter(chamberRef.current);
    };

    // Swaps the basemap: persists nothing itself (see selectMapStyle vs.
    // selectSiteTheme above for who does), just applies `styleId` visually
    // and re-adds the layers setStyle() is about to throw away. Assigned to
    // switchBasemapRef so the component-level selectMapStyle/selectSiteTheme
    // functions (called from MapThemeSelector's onClick handlers, outside
    // this effect) can reach it.
    const switchBasemap = (styleId: string) => {
      currentStyleId = styleId;
      setMapStyleId(styleId);
      map.setStyle(getMapStyleUrlById(styleId));
      // Nothing may touch wards/commissioners/state-legislature layers
      // between here and "style.load" — they belong to the style being
      // replaced. Pins are untouched: they're not part of the style.
      map.once("style.load", async () => {
        const civicData = await civicDataPromiseRef.current;
        if (!civicData) return;
        addSourcesAndLayers(civicData);
      });
    };
    switchBasemapRef.current = switchBasemap;

    map.on("load", async () => {
      // The canvas's WebGL drawing buffer is sized from the container at
      // construction time; if layout settles a beat after that (webfonts,
      // flex sizing), the buffer is left smaller than the CSS box and only
      // that top-left region ever gets painted. Forcing a resize once the
      // container has its final size fixes that.
      setTimeout(() => map.resize(), 100);

      // Awaits the *same* fetch the map-independent effect above kicked
      // off on mount, rather than fetching a second time — that effect
      // is also what populates wardsDataRef/commissionersDataRef/
      // stateLegDataRef, so search can use them even if this "load"
      // event never fires at all.
      const civicData = await civicDataPromiseRef.current;
      if (!civicData) return; // fetch failed — nothing to draw; already logged in fetchCivicData

      addPins(civicData);
      addSourcesAndLayers(civicData);

      // Only animate if something's actually contested — with today's data
      // that's never true (see the isContested comment in types.ts), so
      // this costs nothing until real candidate-filing data changes that.
      // Started once, here, never from switchBasemap: the animation loop's
      // own `if (map.getLayer(layerId))` guards make it self-healing across
      // a basemap swap (it just skips paint-property writes for the few
      // frames the pulse layers don't exist yet, between setStyle() and
      // addSourcesAndLayers re-adding them) — no second loop needed.
      const anyContested =
        civicData.wards.features.some((f) => f.properties?.isContested) ||
        civicData.commissioners.features.some((f) => f.properties?.isContested) ||
        civicData.stateLeg.features.some((f) => f.properties?.isContested);
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

      // Initial camera fit only — wardsBoundsRef/commissionersBoundsRef/
      // stateLegBoundsRef (used by zoomToDefault) are already populated
      // by the map-independent effect above, from the same data. Fit to
      // each layer's actual extent rather than a hardcoded bounding box,
      // so this keeps working if boundaries shift. Deliberately not
      // repeated on a basemap swap — switchBasemap has no call to this,
      // so picking a new basemap never snaps the camera back to this
      // default extent out from under whatever the resident was looking at.
      const wardsBounds = boundsFromFeatureCollection(civicData.wards);
      if (!wardsBounds.isEmpty()) map.fitBounds(wardsBounds, { padding: 40, duration: 0 });
    });

    const handleHoverMove = (e: maplibregl.MapLayerMouseEvent) => {
      if (!isDesktopHover) return;
      // A click-pinned modal stays put; hover shouldn't swap its content
      // out from under the user while it's pinned open.
      if (selectedRef.current?.pinned) return;
      map.getCanvas().style.cursor = "pointer";
      const feature = e.features?.[0];
      if (!feature) return;
      // The hovered layer's own hit seeds its tier exactly (see
      // resolveSelectionAtPoint's comment); the other two tiers — always
      // hidden right now, since only one LayerMode is ever visible — still
      // resolve via point-in-polygon at the same cursor position.
      const known = normalizeRepProperties(feature.properties);
      // mousemove fires continuously while the cursor sits inside one
      // polygon, not just once on entry — skip the (real) cost of
      // re-resolving all three tiers and re-rendering the panel unless the
      // hovered feature has actually changed since the last event.
      const hoverIdentity = officialIdentity(known);
      if (hoverIdentity === lastHoverIdentityRef.current) return;
      lastHoverIdentityRef.current = hoverIdentity;
      const point = toPoint(e.lngLat);
      setSelected({ officials: resolveSelectionAtPoint(point, known), pinned: false });
    };
    const handleHoverLeave = () => {
      if (!isDesktopHover) return;
      lastHoverIdentityRef.current = null;
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

      // queryRenderedFeatures returns geometry clipped to whichever
      // internal tile the click landed in, not the feature's true full
      // shape — fitBounds on that would center on the click point rather
      // than the ward/district, especially for large areas near a tile
      // edge. Look the same feature up in the untiled source data fetched
      // at load time for its real geometry instead. Its (untiled, exact)
      // properties are also what seeds resolveSelectionAtPoint's `known`
      // below, one step more accurate than hitProps for that purpose.
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
      // normalizeRepProperties again here, even though fullFeature's
      // properties never went through MapLibre's tiling (hitProps already
      // did): fullFeature comes from a fetch()'d wards.geojson/etc.
      // response that could, in principle, predate a field this component
      // now expects (see normalizeRepProperties's own comment on the
      // browser-cache scenario it guards against) — skipping it here would
      // silently let an `undefined` field through as `known` instead of
      // the `null` every other path guarantees.
      const known = normalizeRepProperties(
        (fullFeature?.properties as Record<string, unknown> | undefined) ?? (hitProps as unknown as Record<string, unknown>),
      );
      const point = toPoint(e.lngLat);
      selectPinned(resolveSelectionAtPoint(point, known));
      setActiveMobileSheet(null); // see applySearchResult's comment on this same call
      zoomToBounds(boundsFromFeature((fullFeature ?? hit) as Feature<Geometry>));
    });

    const handleResize = () => map.resize();
    window.addEventListener("resize", handleResize);

    // window's own "resize" only fires on a *viewport* size change — it
    // never fires when the map's own box changes shape for some other
    // reason, which the sidebar collapse toggles now do (their width
    // transition genuinely reflows the map's flex sibling, unlike a hover
    // preview swapping a sidebar's content — see selectPinned's comment
    // on that distinction). A ResizeObserver on the map's own container
    // catches that case too, and is a strict superset of the window
    // listener above — but that listener stays, both because a plain
    // browser resize is the common case, and because ResizeObserver was
    // late enough to Safari that a visitor on an old-but-supported
    // browser deserves the fallback rather than a map that's stuck at its
    // initial size forever.
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.resize()) : null;
    if (resizeObserver && mapContainerRef.current) resizeObserver.observe(mapContainerRef.current);

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
      attribObserver.disconnect();
      // Explicit onRemove() for both — map.remove() only tears down
      // controls added via map.addControl(), and these were
      // deliberately kept out of that list (see above).
      navControl.onRemove();
      attribControl.onRemove();
      if (pulseAnimationFrameRef.current !== null) cancelAnimationFrame(pulseAnimationFrameRef.current);
      for (const { marker } of pinMarkersRef.current) marker.remove();
      pinMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Defined once, referenced from both the desktop (SiteHeader) and mobile
  // (MobileNav's Search tab) branches below — each usage still mounts its
  // own independent SearchBar instance (React treats the two JSX
  // positions as separate component instances regardless of sharing this
  // element description), so this is purely to keep the props in one
  // place rather than duplicating four lines of callbacks that need to
  // stay in sync.
  const searchBar = (
    <SearchBar
      index={addressIndex}
      allPlaces={mnPlaces}
      onSelectWard={applySearchResult}
      onSelectCity={applyCityZoom}
      onSelectCounty={(_county, cities) => applyCountyZoom(cities)}
    />
  );

  // Chrome for the mode switcher + city/chamber filter, in two flavors:
  //   "floating" — each group is its own translucent, blurred, shadowed
  //   card, because this is what MobileNav's Filters tab drops straight
  //   into its sheet slot, which sits directly over the dimmed map/scrim.
  //   "sidebar" — the desktop left `<aside>` below already supplies a
  //   solid panel background and its own border; a second card nested
  //   inside that column would just be chrome inside chrome, so groups
  //   render as plain bordered rows instead, each under a visible section
  //   label (the aside has room a floating card over the map never did,
  //   and a persistent column benefits from real headings rather than
  //   relying on `aria-label` alone — AGENTS.md §4's "structure is
  //   information," not just screen-reader plumbing).
  // Desktop used to mount the "floating" flavor top-left, absolutely
  // positioned over the map, the same way MobileNav's sheet still does —
  // see the left `<aside>` in the return below for where "sidebar" mounts
  // now instead.
  const filterGroupClass = (variant: "floating" | "sidebar") =>
    variant === "floating"
      ? "flex rounded-lg bg-panel-2/90 backdrop-blur-sm border border-hair shadow-lg shadow-(color:--shadow-panel) p-1 text-sm"
      : // border-hair-strong, not the usual --hair: this row sits directly
        // on the sidebar's own bg-panel-2, one step brighter than the
        // floating card's semi-transparent version above, so the faint
        // default hairline all but disappears against it. A little more
        // contrast is the whole point of this pass.
        "flex rounded-lg border border-hair-strong bg-panel-2 p-1 text-sm";
  const filterListClass = (variant: "floating" | "sidebar") =>
    variant === "floating"
      ? // Capped height + internal scroll: with all 10 cities checked this
        // list runs ~400px+ tall, and nothing on the floating desktop
        // overlay (or MobileNav's own capped sheet slot) would otherwise
        // stop it from running off-screen.
        "max-h-[45vh] overflow-y-auto rounded-lg bg-panel-2/90 backdrop-blur-sm border border-hair shadow-lg shadow-(color:--shadow-panel) divide-y divide-hair text-sm text-ink-2"
      : // No height cap here — the sidebar `<aside>` itself scrolls (see
        // its own overflow-y-auto), so a second, nested scroll region
        // would just be confusing about which element actually moves.
        "rounded-lg border border-hair-strong bg-panel-2 divide-y divide-hair-strong text-sm text-ink-2";
  // Sidebar-only: a short Water Blue tick ahead of the label — the flag's
  // own accent (see globals.css's --sidebar-accent) used as a structural
  // marker, not just a color swap. AGENTS.md §4 "structure is
  // information": this is what tells a resident's eye "here's a new
  // group of controls" before they've read the words.
  const filterSectionLabel = (variant: "floating" | "sidebar", text: string) =>
    variant === "sidebar" ? (
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
        <span aria-hidden="true" className="h-2.5 w-1 shrink-0 rounded-full bg-sidebar-accent" />
        {text}
      </h3>
    ) : null;

  // filterControls (floating, for MobileNav's Filters tab) and
  // sidebarFilterControls (for the desktop left `<aside>` below) render
  // the same two groups but are written out separately rather than
  // shared through one JSX-returning helper: a helper closing over
  // switchMode/switchChamber (both of which read a ref) and called twice
  // during this component's own render reads, to the react-hooks/refs
  // lint rule, as those refs being touched somewhere other than an event
  // handler — even though the buttons below only ever call them from
  // onClick, same as this file did before either flavor existed. Two
  // direct blocks side-step the false positive.
  const filterControls = (
    <>
      <div>
        {filterSectionLabel("floating", "Level")}
        <div role="group" aria-label="Choose map layer" className={filterGroupClass("floating")}>
          {(["wards", "commissioners", "state-legislature"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => switchMode(mode)}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                layerMode === mode ? "bg-accent text-on-accent" : "text-ink-3 hover:bg-hover hover:text-ink"
              }`}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>

      <div>
        {filterSectionLabel("floating", layerMode === "state-legislature" ? "Chamber" : "Areas shown")}
        {layerMode === "state-legislature" ? (
          // A district doesn't cleanly belong to one Twin City, so this
          // level filters by chamber instead of the Minneapolis/St. Paul
          // checkboxes below — same toggle pattern as the mode switcher.
          <div role="group" aria-label="Choose chamber" className={filterGroupClass("floating")}>
            {CHAMBERS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => switchChamber(c)}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  chamber === c ? "bg-accent text-on-accent" : "text-ink-3 hover:bg-hover hover:text-ink"
                }`}
              >
                {CHAMBER_LABELS[c]}
              </button>
            ))}
          </div>
        ) : (
          <div role="group" aria-label="Filter by area" className={filterListClass("floating")}>
            {MODE_VISIBLE_CITIES[layerMode].map((city) => (
              <label key={city} className="flex items-center gap-2 px-3 py-2.5 sm:py-2 cursor-pointer select-none hover:bg-hover">
                <input
                  type="checkbox"
                  checked={visibleCities[city]}
                  onChange={() => toggleCity(city)}
                  className="cursor-pointer accent-accent"
                />
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: CITY_ACCENT[city] }} />
                {MODE_FILTER_LABELS[layerMode][city]}
              </label>
            ))}
          </div>
        )}
      </div>
    </>
  );

  const sidebarFilterControls = (
    <>
      <div>
        {filterSectionLabel("sidebar", "Level")}
        <div role="group" aria-label="Choose map layer" className={filterGroupClass("sidebar")}>
          {(["wards", "commissioners", "state-legislature"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => switchMode(mode)}
              // bg-sidebar-accent, not the app's usual bg-accent: the
              // sidebars' own flag accent (globals.css) — Water Blue
              // paired with Night Sky Blue text, falling back to this
              // theme's regular --accent in dark mode. The floating/
              // mobile copy above keeps the ordinary accent on purpose;
              // see filterGroupClass's own comment on why sidebar rows
              // get the extra contrast the floating card didn't need.
              className={`px-3 py-1.5 rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent ${
                layerMode === mode
                  ? "bg-sidebar-accent text-on-sidebar-accent"
                  : "text-ink-3 hover:bg-hover hover:text-ink"
              }`}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>

      <div>
        {filterSectionLabel("sidebar", layerMode === "state-legislature" ? "Chamber" : "Areas shown")}
        {layerMode === "state-legislature" ? (
          <div role="group" aria-label="Choose chamber" className={filterGroupClass("sidebar")}>
            {CHAMBERS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => switchChamber(c)}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent ${
                  chamber === c
                    ? "bg-sidebar-accent text-on-sidebar-accent"
                    : "text-ink-3 hover:bg-hover hover:text-ink"
                }`}
              >
                {CHAMBER_LABELS[c]}
              </button>
            ))}
          </div>
        ) : (
          <div role="group" aria-label="Filter by area" className={filterListClass("sidebar")}>
            {MODE_VISIBLE_CITIES[layerMode].map((city) => (
              <label key={city} className="flex items-center gap-2 px-3 py-2.5 sm:py-2 cursor-pointer select-none hover:bg-hover">
                <input
                  type="checkbox"
                  checked={visibleCities[city]}
                  onChange={() => toggleCity(city)}
                  className="cursor-pointer accent-accent"
                />
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: CITY_ACCENT[city] }} />
                {MODE_FILTER_LABELS[layerMode][city]}
              </label>
            ))}
          </div>
        )}
      </div>
    </>
  );

  const mobileTabs: MobileNavTab[] = [
    { id: "search", label: "Search", icon: <IconSearch /> },
    { id: "filters", label: "Filters", icon: <IconSliders /> },
  ];

  // The pinned ward/rep modal outranks any open tab — same priority
  // mndatacenter's own facility sheet holds over its tab sheets (see
  // MobileNav's file comment). Tapping a tab while the modal is up closes
  // the modal *and* opens that tab in the same gesture (handleMobileTabSelect
  // below), rather than leaving the first tap stranded doing nothing.
  const mobileSheetContent = selected ? (
    <WardModal officials={selected.officials} onClose={deselect} variant="sheet" />
  ) : activeMobileSheet === "search" ? (
    searchBar
  ) : activeMobileSheet === "filters" ? (
    filterControls
  ) : null;

  const closeMobileSheet = () => {
    if (selected) deselect();
    else setActiveMobileSheet(null);
  };

  const handleMobileTabSelect = (id: string) => {
    if (selected) deselect(); // the priority modal wins a tap; dismiss it before opening a tab
    setActiveMobileSheet((current) => (current === id ? null : (id as MobileSheetId)));
  };

  // z-index scale for whatever actually floats *over* the map (lowest to
  // highest — each number below is the *only* place its value should be
  // set; if a new layer is ever added, give it its own rung rather than
  // reusing one of these). This used to also cover the mode/filter stack
  // and the rep detail modal, both absolutely positioned over the map;
  // they're real sidebar `<aside>` columns now (see the return below), so
  // neither one takes a rung here anymore — ordinary in-flow flex
  // siblings don't compete for stacking order with anything.
  //   0  — the map: canvas + every pin marker (mayors, council members,
  //        commissioners, state legislators). `isolate` on the map
  //        container div below is load-bearing, not decorative: pin
  //        elements get an inline z-index of their own (see
  //        createRepPinElement's comment) so a Mayor pin can render over
  //        a Council Member pin it overlaps. Without `isolate`, that
  //        inline z-index (up to 52) doesn't stay contained —
  //        position:absolute with no z-index does NOT create a new
  //        stacking context, so the pins' z-index was being compared
  //        directly against the z-20 layer below at the root level and
  //        winning, painting map pins over controls floating above the
  //        map. `isolate` forces the map div to own a stacking context,
  //        so "highest z-index" pins only ever mean "highest among pins."
  //   20 — desktop-only (sm+) persistent controls floating over the map
  //        itself: the bottom-right theme popover, and the two sidebar
  //        collapse toggles (one pinned to each edge of the map's own
  //        box — see the return below). Search doesn't need a rung here —
  //        it lives in SiteHeader, outside this scale (see below) — and
  //        neither do the sidebars themselves, for the same reason.
  //   30 — mobile-only (below sm) scrim: a dimmed overlay behind whatever
  //        MobileNav has open (a tab's sheet, or the priority ward modal),
  //        blocking map interaction underneath it. See MobileNav's own
  //        comment for why that's deliberate.
  //   40 — mobile-only nav bar + its raised sheet (MobileNav). Above the
  //        scrim at 30, and — since nothing above z-20 exists on desktop
  //        and z-20 itself never renders on mobile — never actually
  //        contends with the desktop rung it numerically outranks.
  //
  // SiteHeader and both sidebar `<aside>`s sit outside this scale
  // entirely — they're normal static-flow flex siblings around the
  // relative map wrapper that 0/20/30/40 live inside, not absolutely-
  // positioned layers competing for a z-index rung. Every "absolute
  // inset-0 / right-3 bottom-24" below is scoped to that inner wrapper's
  // own box — the map's own box, narrower now than the full row since the
  // sidebars are real flex siblings beside it, not overlays on top of it —
  // so there's no overlap to resolve for anything outside it.
  //
  // One exception: MastheadSaying's explanation popover (the third line
  // under the wordmark, inside SiteHeader) opens *downward*, past the
  // header's own bottom edge, into this row's z-stacked territory — and
  // neither it nor the row itself establishes an intervening stacking
  // context, so a same-value z-index there would tie directly against
  // 20/30/40 below with DOM order as the tiebreaker, and the row (later
  // in the tree) would win, clipping it. That popover uses z-50, above
  // every rung here on purpose — see its own comment.
  return (
    <div className="flex w-full h-dvh flex-col overflow-hidden bg-canvas">
      <SiteHeader search={searchBar} />
      {/* Announces the detail panel's content only on an explicit
          click/tap/search-result selection — see `announcement` state's
          own comment for why hover (which repopulates the same panel on
          every mousemove) never touches this. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="flex min-h-0 flex-1">
        {/* Left sidebar: mode switcher + city/chamber filter — desktop/
            laptop only (sm+), modeled on mndatacenter.org's own left
            filter sidebar, collapse toggle included (see AGENTS.md "Role
            in the wider project" for why this app's chrome already
            tracks that sister site). Below sm, the same controls
            (filterControls, defined above) live in MobileNav's Filters
            tab instead — a fixed sidebar column doesn't fit a phone-width
            screen, so mobile keeps its own bottom-sheet pattern rather
            than squeezing this in too.

            Stays mounted (and its width transitions, rather than the
            element unmounting/remounting) whether collapsed or not, so
            the transition has something to animate and the filter state
            underneath survives a collapse — width alone can't reach 0
            with a border still attached, so the border classes drop out
            entirely in the collapsed branch below (see the comment on
            the expanded branch for what they'd otherwise draw). The
            inner div's fixed width keeps the filter groups from
            reflowing/wrapping mid-transition — it just gets
            progressively clipped by the shrinking overflow-x-hidden
            outer box, reading as a slide rather than a squish. */}
        <aside
          id="map-filters-sidebar"
          aria-label="Map filters"
          aria-hidden={leftFiltersCollapsed}
          className={`hidden sm:flex shrink-0 flex-col overflow-x-hidden overflow-y-auto bg-panel-2 font-sans transition-[width] duration-300 ease-out ${
            leftFiltersCollapsed
              ? "sm:w-0"
              : // bg-panel-2 (not the workspace's usual --panel): a full
                // step whiter than --canvas/--panel, so the sidebar reads
                // as its own surface against the map rather than nearly
                // the same gray. border-r-hair-strong does the same job
                // on the inner edge (the seam against the map);
                // border-l-sidebar-edge-accent puts a thin Night Sky Blue
                // frame on the *outer* edge instead — the viewport's own
                // left edge, where nothing else was competing for
                // attention. See globals.css's --sidebar-edge-accent
                // comment for why that's light-mode only (falls back to
                // a plain --hair-strong sliver in dark mode).
                "sm:w-64 lg:w-72 border-r border-r-hair-strong border-l-[3px] border-l-sidebar-edge-accent"
          }`}
        >
          <div className="flex h-full w-64 shrink-0 flex-col gap-5 px-4 py-5 lg:w-72">{sidebarFilterControls}</div>
        </aside>

        {/* Center: the map itself, plus whatever actually needs to float
            *over* it — see the z-index scale above for what's left there
            now that the filter and detail panels are sidebar columns
            instead of overlays. */}
        <div className="relative min-h-0 flex-1">
          <div ref={mapContainerRef} className="absolute inset-0 w-full h-full isolate z-0" />

          {/* Left sidebar's pull-tab — mndatacenter.org's own mechanism
              (a small tab stuck to the panel's edge, chevron flips
              direction on toggle), adapted for a real flex sidebar rather
              than their absolutely-positioned one: this button lives in
              the map's own wrapper, not the sidebar, positioned flush
              against *this box's* left edge — which is exactly the seam
              against the sidebar when it's expanded, and the viewport's
              own left edge once the sidebar has collapsed out from under
              it. No transform math needed to keep it there; it's just
              always drawn at whatever this box's current left edge is.
              No shadow: border-l-0 already drops the border on that seam
              so the button reads as sprouting from the sidebar rather
              than sitting apart from it, but a plain shadow-md casts on
              all four sides regardless of which borders are present —
              left it in and the shadow's own blur painted a soft vertical
              line right across that seam anyway, undoing the point of
              dropping the border there. The border on the other three
              sides is enough definition against the live map. */}
          <button
            type="button"
            onClick={() => setLeftFiltersCollapsed(!leftFiltersCollapsed)}
            aria-expanded={!leftFiltersCollapsed}
            aria-controls="map-filters-sidebar"
            aria-label={leftFiltersCollapsed ? "Show map filters" : "Hide map filters"}
            className="hidden sm:flex absolute left-0 top-1/2 z-20 h-12 w-6 -translate-y-1/2 items-center justify-center rounded-r-lg border border-l-0 border-hair-strong bg-panel-2 text-ink-3 transition-colors hover:bg-hover hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent"
          >
            <IconChevron className={leftFiltersCollapsed ? "rotate-180" : ""} />
          </button>

          {/* One wrapper for everything that lives in the map's
              bottom-right corner — MapThemeSelector's toggle, MapLibre's
              zoom buttons, and MapLibre's attribution badge — stacked as
              plain flex children instead of three independently
              positioned elements. `items-center` centers each on the
              shared vertical axis regardless of how wide any one of
              them actually is (the attribution badge is wider than the
              29px zoom/theme buttons); `gap` gives every consecutive
              pair the same spacing, so "equally spaced" is structural,
              not three separately-tuned offsets that happen to agree.
              `bottom` clears MobileNav's bar height on a phone
              (--mobile-nav-height, published by that component's own
              ResizeObserver) and falls back to just the edge margin
              above `sm`, where that bar doesn't render. The zoom and
              attribution controls themselves are mounted into the two
              empty divs below by the map-setup effect (onAdd(map) →
              appendChild), not rendered as JSX — MapLibre owns their
              actual DOM/behavior, this wrapper only owns where they
              sit. */}
          <div
            id="map-corner-controls"
            className="absolute z-20 flex flex-col items-center"
            style={{
              right: "var(--map-ctrl-edge)",
              bottom: "calc(var(--map-ctrl-edge) + var(--mobile-nav-height))",
              gap: "var(--map-ctrl-gap)",
            }}
          >
            <MapThemeSelector
              siteTheme={siteTheme}
              mapStyleId={mapStyleId}
              onSelectSiteTheme={selectSiteTheme}
              onSelectMapStyle={selectMapStyle}
            />
            <div ref={navControlMountRef} />
            <div ref={attribControlMountRef} />
          </div>

          {/* Right sidebar's pull-tab — mirrors the left one above, flush
              against this box's right edge instead, including dropping
              the shadow for the same reason (see that comment). */}
          <button
            type="button"
            onClick={() => setRightDetailCollapsed(!rightDetailCollapsed)}
            aria-expanded={!rightDetailCollapsed}
            aria-controls="map-detail-sidebar"
            aria-label={rightDetailCollapsed ? "Show representative details" : "Hide representative details"}
            className="hidden sm:flex absolute right-0 top-1/2 z-20 h-12 w-6 -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 border-hair-strong bg-panel-2 text-ink-3 transition-colors hover:bg-hover hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent"
          >
            <IconChevron className={rightDetailCollapsed ? "" : "rotate-180"} />
          </button>

          {/* Mobile (below sm): one bottom tab bar for Search/Filters,
              plus whatever sheet is currently raised — a tab's own
              content, or (taking priority) the pinned ward modal. Theme
              isn't a tab here — MapThemeSelector above renders at the
              same map corner on every breakpoint instead. See
              MobileNav's own comment for the full reasoning; WardMap only
              decides *what* goes in the sheet slot (mobileSheetContent
              above), not how it's shown. */}
          <MobileNav
            tabs={mobileTabs}
            activeTab={selected ? null : activeMobileSheet}
            onSelectTab={handleMobileTabSelect}
            onDismiss={closeMobileSheet}
            sheetContent={mobileSheetContent}
          />
        </div>

        {/* Right sidebar: the hovered/selected rep's detail panel —
            desktop/laptop only, modeled on mndatacenter.org's own right
            detail panel. Persistent when not manually collapsed —
            mounted (and reserving its width) whether or not anything's
            currently selected, rather than only appearing on selection:
            a hover preview swapping this column's *content* never
            reflows the map next to it, where a conditionally-mounted
            column would resize the map underneath the cursor on every
            hover. Collapsing it is a deliberate click on the toggle
            above, not a passive hover, so that reflow is expected there
            — see selectPinned's comment on why an explicit selection
            (unlike a hover) force-expands it back out. Below sm, the
            same content (WardModal) lives in MobileNav's sheet slot
            instead — see mobileSheetContent above. */}
        <aside
          id="map-detail-sidebar"
          aria-label="Representatives for this location"
          aria-hidden={rightDetailCollapsed}
          // Mirrors the left sidebar's contrast/edge/collapse treatment —
          // see its own comment above — with the flag-blue accent moved
          // to *this* sidebar's outer edge (the viewport's right edge)
          // instead.
          className={`hidden sm:flex shrink-0 flex-col overflow-x-hidden overflow-y-auto bg-panel-2 font-sans transition-[width] duration-300 ease-out ${
            rightDetailCollapsed ? "sm:w-0" : "sm:w-80 lg:w-96 border-l border-l-hair-strong border-r-[3px] border-r-sidebar-edge-accent"
          }`}
        >
          <div className="flex h-full w-80 shrink-0 flex-col lg:w-96">
            {selected ? (
              <WardModal officials={selected.officials} onClose={deselect} variant="sidebar" />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center text-sm text-ink-3">
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-8 w-8 shrink-0 text-sidebar-accent">
                  <path
                    d="M10 18s6-5.2 6-9.6A6 6 0 0 0 4 8.4C4 12.8 10 18 10 18Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <circle cx="10" cy="8.2" r="2" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                <p>
                  Hover or select a ward, mayor, or district on the map to see who represents it, how they&rsquo;ve
                  voted, and how to reach them.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
