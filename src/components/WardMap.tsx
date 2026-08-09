"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import type { AddressGazetteerManifest, MnPlaces, RepProperties, WardRef } from "@/lib/types";
import { dataUrl } from "@/lib/dataUrl";
import type { AreaOfficials, CivicGeometrySources } from "@/lib/officials";
import { officialIdentity, resolveOfficialsAtPoint } from "@/lib/officials";
import { AT_LARGE_CITIES, CITIES, type City } from "@/lib/cities";
import {
  CITY_ACCENT,
  CITY_PALETTES,
  CONTESTED_COLOR,
  NEUTRAL_PARTY_COLOR,
  PARTY_COLORS,
  partyColor,
  partyColorSoft,
  TIER_HEADER_BG,
  TIER_HEADER_TEXT,
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
import { focusRingClass, rowHoverClass } from "@/lib/variantClasses";
import AreaFilterList from "./AreaFilterList";
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
// A separate point source for the "Ward N" text only — see
// labelPointsFromFeatureCollection's comment for why the label can't just
// stay on the polygon source alongside the fill/outline/pulse layers.
const WARDS_LABEL_SOURCE_ID = "wards-label-source";
// Dotted lines tracing the formation wardPinOffsets lays multiple pins out
// in — originally wards-only (a ward that seats more than one member off
// one shared polygon), now also covers mayors.geojson's own multi-member
// groups (an at-large city's mayor + council members, all sharing one City
// Hall coordinate — Woodbury is the first). Commissioners/state legislators
// are still always one pin per polygon, so they never need this. See
// wardPinConnectorLines.
const WARDS_PIN_LINKS_SOURCE_ID = "wards-pin-links-source";
const WARDS_PIN_LINKS_LAYER_ID = "wards-pin-links";

// A city with no ward polygon at all (elects entirely at-large — Woodbury
// is the first) gets its own outline filled instead, one feature per
// AT_LARGE_CITIES entry (src/lib/cities.ts), derived client-side by
// filtering the statewide public/city-boundaries.geojson backdrop down to
// just those cities — see deriveAtLargeBoundaries's own comment. This used
// to be its own fetch of public/at-large-boundaries.geojson (Washington
// County's own GIS portal, one URL per at-large city — see git history for
// scripts/fetch-at-large-boundaries.mjs, now removed); deriving it from
// the already-fetched statewide feed instead avoids painting two
// independently-sourced polygons for the same city that could silently
// drift apart at the edges. Solid CITY_ACCENT fill, not a ward-cycled
// shade — there's no ward number to cycle across, this polygon *is* the
// whole city. Renders alongside wards-mode (same as mayors' pins already
// do), never its own LayerMode.
const AT_LARGE_BOUNDARIES_SOURCE_ID = "at-large-boundaries-source";
const AT_LARGE_BOUNDARY_FILL_LAYER_ID = "at-large-boundary-fill";
const AT_LARGE_BOUNDARY_OUTLINE_LAYER_ID = "at-large-boundary-outline";

// Statewide "city limits" backdrop — every incorporated MN city's own
// corporate boundary (public/city-boundaries.geojson, see
// fetch-city-boundaries.mjs), not just the cities.ts cities this app has
// ward/mayor data for. Visible in "wards" and "commissioners" modes, hidden
// in "state-legislature" — see applyLayerMode's own comment on why this
// isn't just a third entry in that function's per-mode layerGroups (it
// needs to be visible under *two* modes, not exactly one) and why state
// mode is the one it's suppressed in (state-legislature.geojson is already
// statewide — full coverage regardless — so this would be pure redundant
// clutter there, unlike commissioners.geojson's 2-of-87-county coverage,
// where it's the only thing on the map for most of the state). No manual
// toggle — the two-mode/one-mode split above already puts it exactly where
// it's load-bearing and nowhere it's just noise, so a control to hide it
// further would have nothing left to usefully do.
// Added to the map FIRST, before WARDS_SOURCE_ID/every other tier, so
// z-order alone (this file never passes `beforeId` to addLayer) keeps it
// painted underneath every real data layer.
const CITY_BOUNDARIES_SOURCE_ID = "city-boundaries-source";
const CITY_BOUNDARIES_FILL_LAYER_ID = "city-boundaries-fill";
const CITY_BOUNDARIES_OUTLINE_LAYER_ID = "city-boundaries-outline";

const COMMISSIONERS_SOURCE_ID = "commissioners-source";
const COMMISSIONERS_FILL_LAYER_ID = "commissioners-fill";
const COMMISSIONERS_OUTLINE_LAYER_ID = "commissioners-outline";
const COMMISSIONERS_PULSE_LAYER_ID = "commissioners-pulse";
const COMMISSIONERS_LABEL_LAYER_ID = "commissioners-label";
const COMMISSIONERS_LABEL_SOURCE_ID = "commissioners-label-source";

const STATE_LEG_SOURCE_ID = "state-legislature-source";
const STATE_LEG_FILL_LAYER_ID = "state-legislature-fill";
const STATE_LEG_OUTLINE_LAYER_ID = "state-legislature-outline";
const STATE_LEG_PULSE_LAYER_ID = "state-legislature-pulse";
const STATE_LEG_LABEL_LAYER_ID = "state-legislature-label";
const STATE_LEG_LABEL_SOURCE_ID = "state-legislature-label-source";

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

// Which cities' wards are checked on first load, before a resident touches
// the "Areas shown" checklist — every other covered city still renders (its
// checkbox is just unchecked to start), one click away via the checklist or
// the "All" bulk toggle, not removed from the map. Minneapolis/St. Paul are
// the core metro and this app's original two cities; defaulting to just
// them keeps the first paint focused rather than opening on all 17 cities'
// wards at once. Unlike MODE_VISIBLE_CITIES above (which city checkboxes
// even *exist* per mode), this only decides which of those start checked.
const DEFAULT_VISIBLE_CITIES = new Set<City>(["Minneapolis", "St. Paul"]);

// User-facing names for the mode toggle — "which level of government."
const MODE_LABELS: Record<LayerMode, string> = {
  wards: "City",
  commissioners: "County",
  "state-legislature": "State",
};

// Plain-language copy for the "still in flight" notice (issue #71) — only
// ever shown for the two modes whose data comes from the background
// fetchSecondaryCivicData() request. "wards" has no entry on purpose:
// wards/mayors are the *primary* fetch, never gated behind this notice.
const SECONDARY_DATA_LOADING_LABEL: Partial<Record<LayerMode, string>> = {
  commissioners: "Loading county data…",
  "state-legislature": "Loading state data…",
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

// Builds a paint-property value that reads a per-feature hover/selection
// flag off MapLibre's own feature-state (set/cleared by setHighlight, see
// its own comment in the effect below) rather than a `filter` swap — a
// filter change hard-cuts which features render at all, so a *previous*
// selection can't fade out and a *new* one can't fade in, it just pops.
// feature-state changes on an already-rendered feature, by contrast, are a
// genuine paint-value transition MapLibre tweens smoothly when the
// corresponding `${property}-transition` is set alongside it — same
// mechanism a `:hover` CSS transition uses, applied to the GL layer
// instead of the DOM. Requires `generateId: true` on the source (see
// addSource calls below) so every feature has a stable numeric id to key
// feature-state off without depending on the source data carrying its own.
function hoverExpr(base: number, hovered: number): maplibregl.ExpressionSpecification {
  return ["case", ["boolean", ["feature-state", "hover"], false], hovered, base] as unknown as maplibregl.ExpressionSpecification;
}

// At-large-boundaries.geojson features carry only `{ city }` — no ward
// number to cycle a palette across (see this file's own comment), so this
// is a flat CITY_ACCENT match rather than fillColorExpression's per-ward
// cityMatchExpression. Data-driven over CITY_ACCENT for the same reason
// fillColorExpression is data-driven over CITY_PALETTES — a new at-large
// city only needs a cityTheme.ts entry, not a second edit here.
const AT_LARGE_BOUNDARY_FILL_COLOR_EXPRESSION = [
  "match",
  ["get", "city"],
  ...Object.entries(CITY_ACCENT).flatMap(([city, color]) => [city, color]),
  "#e5e7eb",
] as unknown as maplibregl.ExpressionSpecification;

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

// The view a fresh page load (or refresh) opens on: zoomed out just far
// enough that Buffalo (west), St. Croix Falls, WI (northeast), and
// Lakeville (south) are all inside the frame, so the map reads as "the
// Twin Cities metro" rather than just the Minneapolis/St. Paul core.
// Fixed town coordinates rather than a data-derived bounds (the way
// zoomToDefault's per-mode bounds are) since these three aren't
// necessarily covered by any layer this app ships — they're picked purely
// to define the initial camera framing.
const DEFAULT_VIEW_BOUNDS = new maplibregl.LngLatBounds(
  [-93.8744, 44.6497], // sw: Buffalo, MN (west) / Lakeville, MN (south)
  [-92.6404, 45.4055], // ne: St. Croix Falls, WI (east / north)
);
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
  // The name of whichever city-limit polygon the cursor/click actually sits
  // inside, independent of whether that city resolved any officials.
  // officials.city is empty for the ~most of Minnesota's cities that this
  // app has no ward/mayor data for (city-boundaries is a statewide backdrop
  // layer — see CITY_BOUNDARIES_FILL_LAYER_ID's own comment — but the
  // officials layers only cover the 17-ish cities in cities.ts), and for
  // those, panelHeading previously had nothing to name the location with at
  // all. Set from the hovered/clicked feature's own city name (ward's
  // `city` property, or city-boundaries' `name` property) wherever that's
  // known, so WardModal can always say *which* city limit is under the
  // cursor even when there's no representative data for it yet — never
  // left for officials.city to imply on its own. Undefined/null wherever no
  // single city applies (a county or state-legislature district hover,
  // which can straddle city lines or none at all).
  hoveredCityName?: string | null;
  // Which of WardModal's three stacked tier sections corresponds to
  // whatever the cursor/click is actually over right now — set alongside
  // `officials` at every hover/click/search-result site below so
  // WardModal can auto-scroll that tier's card into view rather than
  // leaving a resident's own "who represents me?" answer wherever the
  // panel happened to be scrolled to already. null only for the two
  // officeless boundary layers with no tier of their own to prefer (city-
  // boundaries/at-large resolve into `officials.city` anyway, so those
  // pass "city" explicitly instead — see their own setSelected calls).
  jumpToTier: keyof AreaOfficials | null;
  // The same identity string each call site below already computes for
  // its own reasons (an officialIdentity() result, or the
  // "at-large:<city>"/"city-boundary:<name>" shape the two officeless
  // layers use — see selectedIdentityRef's own comment) — carried here
  // too so WardModal's auto-scroll effect can tell "the cursor moved to
  // a genuinely different ward/district" apart from "the same ward's
  // officials object was rebuilt for an unrelated reason" (toggleCity's
  // filtering, for one — see its own setSelected calls, which spread the
  // existing SelectedArea and so preserve this field unchanged on
  // purpose). Two different city wards share the same jumpToTier
  // ("city"), so jumpToTier alone can't tell them apart; this can.
  selectionKey: string | null;
}

// city/county/state — same three keys AreaOfficials and WardModal's own
// TIER_SECTIONS already use, derived here from whichever RepProperties
// role actually triggered the hover/click so every call site below can
// stay a one-liner instead of re-deriving this mapping locally.
function tierForRole(role: RepProperties["role"]): keyof AreaOfficials {
  if (role === "County Commissioner") return "county";
  if (role === "State Representative" || role === "State Senator") return "state";
  return "city"; // Mayor, Council Member
}

interface PinMarker {
  marker: maplibregl.Marker;
  properties: RepProperties;
  // Which layer mode this pin belongs to — mayors ride along with wards,
  // commissioners with commissioner districts — so visibility toggling can
  // tell the two groups of pins apart without a second ref/loop per type.
  mode: LayerMode;
  // Set only for a council-member pin sharing its ward with other
  // members — its formation position (see wardPinPixelOffsets) has to be
  // recomputed on every zoom change, since it's defined in screen pixels
  // relative to `center`, not a fixed lng/lat. Every other pin (mayors,
  // commissioners, state legislators, single-member wards) is placed once
  // and never moves, so this stays unset for them.
  formation?: { center: maplibregl.LngLat; index: number; count: number };
}

// Pin diameter scales along two axes at once: how much ground the office
// actually covers (a citywide executive reads as more prominent than one
// of several countywide board seats, which in turn outranks a single
// ward — the min/max floor and ceiling below), and the current map zoom
// (see diameterForZoom) — without the second axis, zooming out to see
// the whole metro leaves every pin at its zoomed-in size, so wards close
// enough together clump into an unreadable pile of overlapping photos.
// Each role keeps a higher floor than the ones below it in the
// hierarchy, so when pins do start crowding at a low zoom, the most
// numerous/least individually consequential role (Council Member)
// recedes first while state/county pins stay legible longest.
// Non-Mayor floors/ceilings raised from their original 14–22/34–40 range —
// small enough at the old sizes (14px for Council Member, the most common
// pin on the map) that an official's photo was an unreadable smudge rather
// than a recognizable face. Still strictly below Mayor at every tier, so
// the hierarchy this file's own comment above describes is unchanged —
// just shifted up as a block for legibility.
const PIN_SIZE_RANGE_BY_ROLE: Partial<Record<RepProperties["role"], { min: number; max: number }>> = {
  Mayor: { min: 30, max: 52 },
  "County Commissioner": { min: 26, max: 46 },
  "State Senator": { min: 24, max: 44 },
  "State Representative": { min: 22, max: 42 },
  "Council Member": { min: 20, max: 40 },
};
const DEFAULT_PIN_SIZE_RANGE = { min: 18, max: 44 };

// The zoom range over which pin diameter interpolates — below MIN every
// pin holds at its role's smallest size, above MAX at its largest.
// Chosen around the whole-metro starting view DEFAULT_VIEW_BOUNDS fits to (roughly zoom 9 on a typical viewport):
// zoomed out further than that, pins are already shrinking toward
// legible-but-small; zoomed in to a single neighborhood, they're at
// full size.
const PIN_ZOOM_MIN = 8;
const PIN_ZOOM_MAX = 14;

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

// Pins are plain DOM markers, not a symbol layer (see createRepPinElement's
// comment below) — there's no style-spec `icon-size` paint property to
// hand a MapLibre `interpolate` expression to, so this is the by-hand
// equivalent, called both when a pin is first created and again from the
// "zoom" listener registered in the map-setup effect below.
function diameterForZoom(role: RepProperties["role"], zoom: number): number {
  const { min, max } = PIN_SIZE_RANGE_BY_ROLE[role] ?? DEFAULT_PIN_SIZE_RANGE;
  const t = clamp01((zoom - PIN_ZOOM_MIN) / (PIN_ZOOM_MAX - PIN_ZOOM_MIN));
  return min + t * (max - min);
}

// How far below its anchor point the ward/county/state text renders — an
// `em`-based offset (text-offset is in units of the layer's own
// text-size), paired with anchoring the matching pin "bottom" at that same
// point (see addPin below) rather than "center". Anchoring both the pin
// and its label to one shared coordinate, on opposite sides of it, is what
// makes "pin above text" hold for every rep regardless of how oddly the
// underlying ward/district polygon is shaped — before this, the pin sat at
// the polygon's bounding-box center while MapLibre placed the label
// wherever its own placement algorithm found room inside the polygon, two
// independent points that could land anywhere relative to each other.
const LABEL_TEXT_OFFSET: [number, number] = [0, 0.4];

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

// Reduces a polygon FeatureCollection (wards, commissioner districts, state
// legislative districts) to one Point per feature, at that feature's own
// bounds.getCenter() — the exact same coordinate addPins uses to place that
// feature's rep pin. The ward/county/state text label layers source from
// this instead of the original polygon collection so the label and its
// pin always share one anchor: without it, MapLibre's own polygon-label
// placement (which can land anywhere inside an irregularly-shaped ward)
// and the pin's bounds-center position were two independent points, so a
// pin could render on top of, below, or nowhere near its own label
// depending on the polygon's shape — "sometimes above, sometimes not" is
// exactly the inconsistency this PR is fixing. Properties pass through
// unchanged: every filter and text-field expression on the label layers
// (city, chamber, ward, wardName, district, stateDistrict) reads from
// feature.properties either way.
function labelPointsFromFeatureCollection(data: FeatureCollection): FeatureCollection {
  const features = data.features
    .filter((feature) => feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon")
    .map((feature) => {
      const { lng, lat } = boundsFromFeature(feature as Feature<Geometry>).getCenter();
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [lng, lat] },
        properties: feature.properties,
      };
    });
  return { type: "FeatureCollection", features };
}

// How far each pin in a multi-member formation sits from the ward's
// shared bounds-center, as a multiple of that pin's own current diameter
// — screen pixels, not degrees. Degrees would shrink to fewer and fewer
// on-screen pixels as the map zooms out (eventually merging the group
// back into one indistinguishable pile — the exact bug pin-diameter
// zoom-scaling was added to fix in the first place) and balloon to
// disproportionately many zoomed in. Tying spacing to diameter, which
// already scales with zoom (see diameterForZoom), keeps the formation
// reading as the same shape, at a size proportional to the pins
// themselves, at every zoom level — recomputed live by the "zoom"
// listener in the map-setup effect below, the same way pin size is.
const WARD_PIN_CLUSTER_SPACING_FACTOR = 0.8;

// Offsets (screen pixels, added to a ward's shared bounds-center's
// projected position) for each pin in a group of `count` council members
// seated off one shared polygon — a handful of wards today (Blaine's and
// Brooklyn Park's among them), more likely after future redistricting.
// Ordered so that connecting consecutive entries, wrapping the last back
// to the first, traces the formation's outline; wardPinConnectorPoints
// below relies on that ordering directly to draw a matching dotted line.
// Two pins form a horizontal line, three a triangle, four a square —
// beyond that (not seen in the data yet) falls back to an evenly spaced
// ring rather than inventing a named shape for a case with no real
// example to design against. Screen-pixel Y grows downward, so a
// negative dy is "up" on screen regardless of the map's current bearing
// — deliberate: this is a formation the *viewer* sees as a triangle or
// square, not one fixed to compass north.
function wardPinPixelOffsets(count: number, spacingPx: number): [number, number][] {
  const d = spacingPx;
  switch (count) {
    case 0:
    case 1:
      return [[0, 0]];
    case 2:
      return [
        [-d, 0],
        [d, 0],
      ];
    case 3:
      return [
        [0, -d], // apex, screen-up
        [d, d * 0.6], // bottom-right
        [-d, d * 0.6], // bottom-left
      ];
    case 4:
      return [
        [-d, -d], // top-left
        [d, -d], // top-right
        [d, d], // bottom-right
        [-d, d], // bottom-left
      ]; // traced clockwise
    default:
      return Array.from({ length: count }, (_, i) => {
        const angle = (2 * Math.PI * i) / count;
        return [d * Math.cos(angle), d * Math.sin(angle)];
      });
  }
}

// Groups ward/council-member polygon features that share one ward key
// (city+ward) in the same order addPins below iterates them, so a
// group's Nth feature always lands at wardPinPixelOffsets(group.length)[N].
// The one place this grouping happens, shared by pin placement and the
// connector-line layer below, so the two can never drift out of sync
// with each other.
function groupWardFeaturesByWard(data: FeatureCollection): Map<string, Feature<Geometry>[]> {
  const groups = new Map<string, Feature<Geometry>[]>();
  for (const feature of data.features) {
    if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") continue;
    const properties = feature.properties as RepProperties;
    const wardKey = `${properties.city}-${properties.ward}`;
    const group = groups.get(wardKey);
    if (group) group.push(feature as Feature<Geometry>);
    else groups.set(wardKey, [feature as Feature<Geometry>]);
  }
  return groups;
}

// mayors.geojson's equivalent of groupWardFeaturesByWard above — every
// entry there sits at its city's City Hall coordinate, one feature per
// office (Mayor, plus Council Member for an at-large city like Woodbury),
// so "share a coordinate" reduces to "share a city" rather than needing
// wardKey's city+ward compound key. Grouped even for the ordinary one-
// feature-per-city case (every city except Woodbury today) so the same
// formation math handles both — wardPinPixelOffsets(1, ...) is already
// the identity [[0, 0]], so a lone mayor's pin position is unchanged.
function groupFeaturesByCity(data: FeatureCollection): Map<string, Feature<Geometry>[]> {
  const groups = new Map<string, Feature<Geometry>[]>();
  for (const feature of data.features) {
    if (feature.geometry.type !== "Point") continue;
    const properties = feature.properties as RepProperties;
    const group = groups.get(properties.city);
    if (group) group.push(feature as Feature<Geometry>);
    else groups.set(properties.city, [feature as Feature<Geometry>]);
  }
  return groups;
}

// Reprojects a ward's shared bounds-center plus one pixel-space formation
// offset back to a real map coordinate — the one piece of math both a
// formation pin's own placement (addPin) and its dotted connector-line
// endpoint (wardPinConnectorPoints) build on, so the two can never
// compute a different answer for "where does pin N of this group sit."
function formationLngLat(map: maplibregl.Map, center: maplibregl.LngLat, dx: number, dy: number): maplibregl.LngLat {
  const centerPx = map.project(center);
  return map.unproject([centerPx.x + dx, centerPx.y + dy]);
}

// One pin's share of the "zoom" listener's per-frame work (see
// resizePinsForZoom in the map-setup effect below): resize it for the
// given zoom level and, if it's part of a multi-member formation,
// reproject its position. Pulled out on its own so it can be applied to
// exactly one pin outside the animation-frame loop — see issue #69:
// resizePinsForZoom skips pins hidden by the current LayerMode/city/
// chamber filter to avoid doing this work for the ~215 commissioner/
// state-legislature pins nobody can see in the default "City" view, and
// each of applyCityFilter/applyChamberFilter/applyLayerMode calls this
// directly, once, at the moment it flips a pin's display back on — so a
// pin revealed by a mode switch is never left at a stale size or
// formation position from whatever zoom level it was last visible at.
function syncPinGeometryForZoom(map: maplibregl.Map, entry: PinMarker, zoom: number): void {
  const { marker, properties, formation } = entry;
  const diameter = diameterForZoom(properties.role, zoom);
  const el = marker.getElement();
  const inner = el.querySelector<HTMLElement>(".rep-pin-inner");
  if (inner) {
    inner.style.width = `${diameter}px`;
    inner.style.height = `${diameter}px`;
  }
  // Keeps the bigger-role-renders-on-top rule (see createRepPinElement's
  // z-index comment) correct at every zoom level, not just the one each
  // pin happened to be created or last resynced at.
  el.style.zIndex = String(Math.round(diameter));
  if (formation) {
    const spacing = diameter * WARD_PIN_CLUSTER_SPACING_FACTOR;
    const [dx, dy] = wardPinPixelOffsets(formation.count, spacing)[formation.index];
    marker.setLngLat(formationLngLat(map, formation.center, dx, dy));
  }
}

// The dotted connector line's endpoints for one multi-member ward —
// same formation math as the pins themselves (formationLngLat +
// wardPinPixelOffsets), but shifted up by half the current pin diameter
// so the line passes through each pin's visual center rather than its
// "bottom"-anchored coordinate (see addPin's anchor comment: growing a
// bottom-anchored pin never moves its anchor point, only its top edge,
// so the line needs its own correction here rather than one applied to
// the pins). Triangle/square formations close the loop back to their
// first point so the line traces a full outline; a 2-point "line" is
// already a single segment.
function wardPinConnectorPoints(
  map: maplibregl.Map,
  center: maplibregl.LngLat,
  count: number,
  diameter: number,
): [number, number][] {
  const spacing = diameter * WARD_PIN_CLUSTER_SPACING_FACTOR;
  const offsets = wardPinPixelOffsets(count, spacing);
  const points = offsets.map(([dx, dy]) => {
    const ll = formationLngLat(map, center, dx, dy - diameter / 2);
    return [ll.lng, ll.lat] as [number, number];
  });
  if (points.length > 2) points.push(points[0]);
  return points;
}

// One dotted LineString per multi-member ward, tracing the same
// formation each pin in the group is laid out in — visually ties the
// group together as "these people share one ward" the moment two or
// more pins land close enough to read as related rather than
// coincidental. Wards with exactly one member produce no line (nothing
// to connect); a real style-layer source (unlike pins, which are DOM
// markers — see createRepPinElement's comment), so this gets (re-)added
// alongside the other wards-* layers in addSourcesAndLayers, and its
// data refreshed on every zoom change by the listener in the map-setup
// effect below, the same way pin positions are.
// wardsData covers wards that seat 2+ members off one shared polygon
// (Blaine, Brooklyn Park); mayorsData covers a city whose officials all
// share one City Hall coordinate instead — an ordinary city (one mayor)
// never produces a line here (group.length < 2), only an at-large one
// (Woodbury: mayor + 4 council members) does. Both grouping strategies
// feed the same output FeatureCollection/layer, since both use identical
// formation math (wardPinConnectorPoints) and both need the exact same
// `city`-keyed filtering applyCityFilter already applies.
function wardPinConnectorLines(map: maplibregl.Map, wardsData: FeatureCollection, mayorsData: FeatureCollection): FeatureCollection {
  const zoom = map.getZoom();
  const features: Feature<Geometry>[] = [];
  const pushLinesForGroups = (groups: Map<string, Feature<Geometry>[]>, centerOf: (f: Feature<Geometry>) => maplibregl.LngLat) => {
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const center = centerOf(group[0]);
      const diameter = diameterForZoom("Council Member", zoom);
      const points = wardPinConnectorPoints(map, center, group.length, diameter);
      // Carries `city` through (every member of a group shares one, by
      // construction of both grouping functions) so applyCityFilter can
      // hide this line along with the rest of a deselected city's wards
      // instead of it lingering onscreen with no visible pins attached.
      const { city } = group[0].properties as RepProperties;
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: points },
        properties: { city },
      });
    }
  };
  pushLinesForGroups(groupWardFeaturesByWard(wardsData), (f) => boundsFromFeature(f).getCenter());
  pushLinesForGroups(groupFeaturesByCity(mayorsData), (f) =>
    maplibregl.LngLat.convert((f.geometry as Point).coordinates as [number, number]),
  );
  return { type: "FeatureCollection", features };
}

// Stands in for commissioners/stateLeg's real data everywhere a MapLibre
// source or label-point computation needs a real (non-null)
// FeatureCollection but SecondaryCivicData hasn't resolved yet — see
// addSourcesAndLayers below. Never mutated; every consumer either reads
// it directly or spreads it into a new object.
const EMPTY_FEATURE_COLLECTION: FeatureCollection = { type: "FeatureCollection", features: [] };

// The two layers every resident needs regardless of which LayerMode
// they're in: wards/mayors are the default "wards" mode itself.
// at-large-boundaries used to ride along with them as its own fetch; it's
// now *derived* client-side from SecondaryCivicData's cityBoundaries once
// that arrives — see AT_LARGE_BOUNDARIES_SOURCE_ID's own comment and
// applySecondaryCivicData below for the tradeoff that follows from that.
interface PrimaryCivicData {
  wards: FeatureCollection;
  mayors: FeatureCollection;
}

// Commissioner districts and state legislative districts — by far the
// larger two of the five layers (state-legislature.geojson especially,
// even after ingest-time simplification — see scripts/lib/geoSimplify.mjs)
// and the only two most residents never explicitly ask for, since they
// default into "wards" mode and often never switch. See
// fetchSecondaryCivicData's own comment for why these are fetched
// separately, and afterward, rather than in the same Promise.all as
// PrimaryCivicData above.
// cityBoundaries rides along with commissioners/stateLeg here rather than
// with PrimaryCivicData above: it's a backdrop, not something the default
// "wards" view's search/pin flow depends on, so it's fine to arrive a
// moment later — same reasoning that already applies to commissioners and
// stateLeg (see this interface's own comment above). The at-large-boundary
// layer is derived from this field too — see AT_LARGE_BOUNDARIES_SOURCE_ID's
// own comment.
interface SecondaryCivicData {
  commissioners: FeatureCollection;
  stateLeg: FeatureCollection;
  cityBoundaries: FeatureCollection;
}

// Fetches wards/mayors independently of the MapLibre instance —
// previously this ran inside map.on("load"), which meant a resident
// whose map never finishes loading (WebGL unavailable, tile host down)
// could never get ward data either, silently breaking search along with
// the map itself. AGENTS.md Part 4 requires search to work "with the map
// absent, failed, or never loaded," so this now runs on its own, and the
// map-setup effect below awaits the same promise instead of fetching a
// second time. Never throws: a failed fetch resolves null so the caller
// can degrade (empty map, search that honestly has nothing to search)
// rather than crash.
//
// See dataUrl()'s own comment for the cache-busted-URL/real-HTTP-caching
// swap that replaced this file's old `{ cache: "no-store" }` on every
// one of these fetches (issue #67 Finding 3).
async function fetchPrimaryCivicData(): Promise<PrimaryCivicData | null> {
  try {
    const [wardsRes, mayorsRes] = await Promise.all([fetch(dataUrl("wards.geojson")), fetch(dataUrl("mayors.geojson"))]);
    const [wards, mayors] = await Promise.all([wardsRes.json(), mayorsRes.json()]);
    return { wards, mayors };
  } catch (err) {
    console.error("[WardMap] failed to load primary civic data (wards/mayors)", err);
    return null;
  }
}

// Fetched only once fetchPrimaryCivicData above has resolved — see the
// mount effect further down, which is what actually sequences the two
// rather than this function being called late on its own. Not just a
// JS-level nicety: on AGENTS.md §4's throttled-3G budget, requesting
// state-legislature.geojson (still the largest of the five layers even
// after ingest-time simplification) at the same time as wards.geojson
// would have the two compete for the same limited pipe, delaying the
// file the default view actually needs. Waiting until wards/mayors are
// already in hand — search and the map's default view usable — before
// even asking for these two means a resident never waits on them for
// anything except the multi-tier hover panel's county/state rows (and
// now the at-large-boundary layer — see this file's own comment on that
// tradeoff), which fill in a moment later once this resolves (see
// resolveOfficialsAtPoint's own comment on why all three tiers are kept
// independent of which LayerMode is visible). See issue #67 Finding 2.
async function fetchSecondaryCivicData(): Promise<SecondaryCivicData | null> {
  try {
    const [commissionersRes, stateLegRes, cityBoundariesRes] = await Promise.all([
      fetch(dataUrl("commissioners.geojson")),
      fetch(dataUrl("state-legislature.geojson")),
      fetch(dataUrl("city-boundaries.geojson")),
    ]);
    const [commissioners, stateLeg, cityBoundaries] = await Promise.all([
      commissionersRes.json(),
      stateLegRes.json(),
      cityBoundariesRes.json(),
    ]);
    return { commissioners, stateLeg, cityBoundaries };
  } catch (err) {
    console.error("[WardMap] failed to load secondary civic data (commissioners/state legislature)", err);
    return null;
  }
}

// Filters the statewide city-boundaries feed down to the handful of
// wardless (at-large-elected) cities this app covers, re-shaping each
// hit into the `{ city }`-only properties shape every existing
// at-large-boundary consumer already expects (fill color expression,
// click/hover identity, applyCityZoom/applyCountyZoom's `.city` filter,
// officials.ts's join — see AT_LARGE_BOUNDARIES_SOURCE_ID's own comment).
//
// The join is a plain string match on `properties.name` (MnDOT/MnGeo's
// spelling) against AT_LARGE_CITIES (this app's abbreviated spelling) —
// it will silently drop a future at-large city whose full name differs
// from its abbreviated form here (e.g. "Saint " vs "St. "), the same
// caveat already documented on CITY_BOUNDARIES_LAYER's knownGaps in
// src/lib/layers.ts.
function deriveAtLargeBoundaries(cityBoundaries: FeatureCollection): FeatureCollection {
  const atLargeCitySet = new Set<string>(AT_LARGE_CITIES);
  return {
    type: "FeatureCollection",
    features: cityBoundaries.features
      .filter((f) => typeof f.properties?.name === "string" && atLargeCitySet.has(f.properties.name))
      .map((f) => ({
        type: "Feature",
        geometry: f.geometry,
        properties: { city: f.properties?.name as string },
      })),
  };
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
// Mayors are the only office with citywide (rather than ward/district)
// authority, so their pin gets a distinct treatment instead of just the
// largest size in PIN_SIZE_RANGE_BY_ROLE — a golden ring with a soft glow,
// standing in for the "chief executive" emblem without literally drawing
// one. Kept as a single constant rather than folding into partyColor since
// mayors are nonpartisan-styled on this map regardless of party (see
// createRepPinElement's own comment on PARTY_COLORS) and this is a
// role-level override, not a party color.
const MAYOR_RING_COLOR = "#ffd700";

function createRepPinElement(rep: RepProperties, diameter: number): HTMLDivElement {
  const isMayor = rep.role === "Mayor";
  const accent = isMayor ? MAYOR_RING_COLOR : partyColor(rep.repParty);
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
  // Classed (not just positioned by this element's own cssText) so the
  // zoom-resize listener in the map-setup effect can find it without
  // relying on DOM structure (outer.firstElementChild) staying stable.
  inner.className = "rep-pin-inner";
  // Mayor glow is layered onto the same box-shadow property as the normal
  // drop shadow (comma-separated), not a separate filter/outline — extra
  // shadow rings keep the glow soft and centered on the circle without
  // expanding the element's own layout box. Two glow layers (tight + wide)
  // read as a brighter halo than one alone at the same total opacity.
  const boxShadow = isMayor
    ? "0 2px 8px rgba(0,0,0,0.35), 0 0 8px 3px rgba(255,215,0,0.85), 0 0 18px 6px rgba(255,215,0,0.5)"
    : "0 2px 8px rgba(0,0,0,0.35)";
  inner.style.cssText = `
    width: ${diameter}px; height: ${diameter}px; border-radius: 9999px;
    border: 3px solid ${accent}; box-shadow: ${boxShadow};
    background: ${isMayor ? "rgba(255,215,0,0.22)" : partyColorSoft(rep.repParty)}; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    transition: transform 0.15s ease, box-shadow 0.15s ease; background-size: cover; background-position: center;
  `;
  outer.appendChild(inner);

  if (rep.repPhotoUrl) {
    const img = document.createElement("img");
    // `loading="lazy"` matters far more here than on a typical below-the-
    // fold image: every pin across every LayerMode is created up front
    // (see addPrimaryPins/addSecondaryPins), including the ~200
    // commissioner/state-legislature pins hidden (display: none) behind
    // whichever mode isn't currently selected. Without this, assigning
    // `src` still fires an immediate network fetch regardless of that
    // display:none — a resident who never leaves the default "City" mode
    // would otherwise pay for ~200 photo requests, to dozens of different
    // city/county/state-hosted origins, that nothing on screen ever
    // shows. A hidden `<img loading="lazy">` defers its fetch until the
    // element actually becomes visible (mode switched to County/State),
    // at which point the browser fetches it same as any other lazy
    // image entering view. `decoding="async"` keeps decoding whichever
    // photos DO load off the main thread, same reasoning at smaller scale.
    img.loading = "lazy";
    img.decoding = "async";
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

// The search-result pin's own diameter and color — deliberately not one of
// createRepPinElement's party/role colors (those identify an officeholder;
// this identifies "where you searched"), and deliberately not a photo, so
// the two kinds of pin are never confusable at a glance. `--accent` is the
// same themed blue/green the search bar's own focus ring and active states
// already use, so this reads as "the search bar, but on the map" rather
// than a new color vocabulary.
const SEARCH_PIN_DIAMETER = 22;

// A plain dot-in-ring marker for the current search result — see
// applySearchResult/applyCityZoom/applyCountyZoom's shared setSearchPin
// below for the "exactly one at a time" invariant this exists to render.
// Same outer/inner two-div split as createRepPinElement, and the same
// reasoning: MapLibre's Marker writes its own `transform: translate(...)`
// onto the outer element, so any additional transform (here, none — no
// hover state on this one) has to live on the inner element instead to
// avoid fighting it.
function createSearchPinElement(): HTMLDivElement {
  const outer = document.createElement("div");
  outer.setAttribute("role", "img");
  outer.setAttribute("aria-label", "Searched address");
  // Above every rep pin's own z-index (see createRepPinElement's comment —
  // those top out around 52) so the pin the user just searched for is
  // never buried under an officeholder pin it happens to land near.
  outer.style.cssText = "z-index: 1000;";

  const inner = document.createElement("div");
  inner.style.cssText = `
    width: ${SEARCH_PIN_DIAMETER}px; height: ${SEARCH_PIN_DIAMETER}px; border-radius: 9999px;
    border: 3px solid var(--accent); box-shadow: 0 2px 8px rgba(0,0,0,0.35), 0 0 0 4px var(--accent-soft);
    background: var(--on-accent);
    display: flex; align-items: center; justify-content: center;
  `;
  const dot = document.createElement("div");
  dot.style.cssText = "width: 8px; height: 8px; border-radius: 9999px; background: var(--accent);";
  inner.appendChild(dot);
  outer.appendChild(inner);
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
  const atLargeBoundariesDataRef = useRef<FeatureCollection | null>(null);
  const cityBoundariesDataRef = useRef<FeatureCollection | null>(null);
  // The in-flight/settled fetchPrimaryCivicData() call — a ref (not
  // state) because the map-setup effect below needs to `await` this
  // exact promise instance rather than re-fetch, and refs (unlike state)
  // are readable synchronously the moment the effect that set them has
  // run. There's no equivalent ref for fetchSecondaryCivicData: nothing
  // needs to await that promise specifically — its own .then() (in the
  // mount effect below) is what updates commissionersDataRef/
  // stateLegDataRef and calls applySecondaryCivicDataRef directly, and
  // every other reader of those two refs already tolerates them being
  // temporarily null (see addSourcesAndLayers/maybeStartPulseAnimation).
  const primaryCivicDataPromiseRef = useRef<Promise<PrimaryCivicData | null> | null>(null);
  const [addressManifest, setAddressManifest] = useState<AddressGazetteerManifest | null>(null);
  const [mnPlaces, setMnPlaces] = useState<MnPlaces | null>(null);
  const pinMarkersRef = useRef<PinMarker[]>([]);
  // The single "you searched here" pin — a plain ref rather than a slot in
  // pinMarkersRef, since it isn't a LayerMode-scoped officeholder pin and
  // doesn't participate in that array's visibility-toggling loops. Exactly
  // one Marker instance ever lives here at a time: setSearchPin (below)
  // always reuses/relocates it instead of creating a second one, which is
  // what actually guarantees "at most one pin" rather than a convention
  // callers have to remember to uphold.
  const searchPinMarkerRef = useRef<maplibregl.Marker | null>(null);
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
  // Identity of whichever ward/at-large/commissioner/state-leg area (or
  // pin) is currently *pinned* — as opposed to `selected` itself, which
  // also holds transient hover state and can't be compared directly
  // (hover overwrites it constantly, with no identity of its own). Lets
  // the click handlers below tell "clicking the thing that's already
  // selected" apart from "clicking something new": same identity twice in
  // a row means toggle it off (deselect, camera back to the mode's
  // default extent) rather than re-selecting and re-zooming to the exact
  // same target. Cleared by deselect(), set by selectPinned() — see both.
  const selectedIdentityRef = useRef<string | null>(null);
  // Which single GL feature (source + MapLibre-assigned numeric id, from
  // that source's own generateId: true) currently carries the hover/
  // selection paint highlight (hoverExpr's ["feature-state","hover"] case
  // in addSourcesAndLayers) — tracked so setHighlight can clear the
  // *previous* feature's state before setting the new one, since
  // feature-state is additive (it doesn't clear itself when a different
  // feature becomes "the" selection the way a `filter` swap would).
  // Null when nothing is highlighted. Read/written only inside the effect
  // that owns `map` (setHighlight is defined there); kept at component
  // scope alongside selectedIdentityRef since both describe the same
  // "what's currently selected" concept and both survive across re-renders
  // for the same reason.
  const highlightedFeatureRef = useRef<{ source: string; id: string | number } | null>(null);

  // Clears whatever feature currently carries the hover/selection paint
  // highlight (see highlightedFeatureRef's own comment) — the one piece of
  // that bookkeeping deselect() below needs, kept as its own top-level
  // function (reading mapRef.current directly, like deselect's own
  // zoomToDefault call does) so deselect doesn't need a reference into the
  // main effect's setHighlight, which closes over that effect's own local
  // `map` instead. The main effect's setHighlight (defined there, for
  // setting a *new* highlight, which does need that closure) calls this
  // for the "clear the previous one" half of its own job rather than
  // duplicating this logic.
  const clearHighlight = () => {
    const map = mapRef.current;
    const current = highlightedFeatureRef.current;
    if (map && current && map.getSource(current.source)) {
      map.removeFeatureState({ source: current.source, id: current.id }, "hover");
    }
    highlightedFeatureRef.current = null;
  };
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
    () => Object.fromEntries(CITIES.map((city) => [city, DEFAULT_VISIBLE_CITIES.has(city)])) as Record<City, boolean>,
  );
  const visibleCitiesRef = useRef(visibleCities);
  // Area-filter sidebar's own free-text query (AreaFilterList's search
  // input, rendered once the city list is long enough — see that
  // component's FILTER_INPUT_THRESHOLD) — a plain useState, never a ref,
  // never persisted to localStorage/URL (no visibility/expansion state
  // was persisted before this feature and none is added now). Shared by
  // both the floating (mobile sheet) and sidebar (desktop) AreaFilterList
  // instances, same as visibleCities above already is — both are mounted
  // in the DOM at once, one hidden via CSS per breakpoint, not
  // conditionally rendered.
  const [areaFilterQuery, setAreaFilterQuery] = useState("");
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
  // Same bridging pattern as switchBasemapRef above — patches the
  // just-resolved SecondaryCivicData into the live map (setData on the
  // commissioners/state-legislature sources, adds their pins), from the
  // mount effect below, once fetchSecondaryCivicData resolves. Has to
  // live inside the map-construction effect (reaches `map` and the
  // addPin helper's closures); stays a no-op if the map never
  // constructed (WebGL unavailable) or hasn't reached "load" yet, in
  // which case addSourcesAndLayers picks up the same data on its own —
  // see that function's own comment.
  const applySecondaryCivicDataRef = useRef<(data: SecondaryCivicData) => void>(() => {});
  // Whether fetchSecondaryCivicData (commissioners/state-legislature/city-
  // boundaries — see that function's own comment) has settled yet, success
  // or failure. Starts true (nothing has resolved at mount) and flips to
  // false the moment the mount effect's fetchSecondaryCivicData().then()
  // callback runs below, regardless of whether it got real data back or
  // `null` — see issue #71. Read by the "Loading county/state data…"
  // notice further down in the render (filterControls/sidebarLevelTabs):
  // shown only while this is true *and* the resident is looking at County
  // or State mode, so it never appears for the default Wards view (which
  // never depended on this fetch) and disappears the instant this flips —
  // whether that's because real data arrived or because the fetch failed
  // outright. A failed fetch degrades to the same honest-empty-state
  // silence every other missing feed gets (AGENTS.md §3.1), not a spinner
  // stuck forever.
  const [secondaryDataPending, setSecondaryDataPending] = useState(true);

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
  // successfully constructs. See fetchPrimaryCivicData's comment for why
  // this is its own effect rather than living inside map.on("load").
  useEffect(() => {
    const primaryPromise = fetchPrimaryCivicData();
    primaryCivicDataPromiseRef.current = primaryPromise;
    primaryPromise.then((primary) => {
      if (!primary) return;
      wardsDataRef.current = primary.wards;
      mayorsDataRef.current = primary.mayors;
      const wardsBounds = boundsFromFeatureCollection(primary.wards);
      if (!wardsBounds.isEmpty()) wardsBoundsRef.current = wardsBounds;

      // Only requested now that wards/mayors are already in hand — see
      // fetchSecondaryCivicData's own comment.
      fetchSecondaryCivicData().then((secondary) => {
        // Flips the County/State "loading" notice off unconditionally —
        // see secondaryDataPending's own comment for why success and
        // failure(null) both count as "settled."
        setSecondaryDataPending(false);
        if (!secondary) return;
        commissionersDataRef.current = secondary.commissioners;
        stateLegDataRef.current = secondary.stateLeg;
        cityBoundariesDataRef.current = secondary.cityBoundaries;
        // Deliberate, accepted regression: Woodbury's at-large boundary
        // (and everything gated on atLargeBoundariesDataRef — the fill
        // layer, applyCityZoom/applyCountyZoom's fallback, search) is now
        // only available once this *secondary* fetch resolves, instead of
        // immediately with primary wards/mayors data — a moment later on
        // a slow connection, not on initial paint. Traded for removing
        // the duplicate-geometry problem (two independently-sourced
        // polygons for the same city drifting apart at the edges) — see
        // deriveAtLargeBoundaries's own comment.
        atLargeBoundariesDataRef.current = deriveAtLargeBoundaries(secondary.cityBoundaries);
        const commissionersBounds = boundsFromFeatureCollection(secondary.commissioners);
        const stateLegBounds = boundsFromFeatureCollection(secondary.stateLeg);
        if (!commissionersBounds.isEmpty()) commissionersBoundsRef.current = commissionersBounds;
        if (!stateLegBounds.isEmpty()) stateLegBoundsRef.current = stateLegBounds;
        // No-ops if the map hasn't reached "load" yet — see
        // applySecondaryCivicDataRef's own comment for why that's fine.
        applySecondaryCivicDataRef.current(secondary);
      });
    });
  }, []);

  // The address/ZIP gazetteer *manifest* (tens of KB — see
  // scripts/fetch-addresses.mjs) that powers SearchBar's street-address
  // and ZIP lookups. Fetched separately from wards/mayors/etc. above
  // since SearchBar is the only consumer — city and county search work
  // off wardsDataRef instead and don't need to wait on this at all.
  //
  // This used to fetch the whole gazetteer (a few MB, one flat file) up
  // front. Per issue #70 / AGENTS.md §4's "chunked and lazily loaded so
  // nobody downloads the whole state to find one ward," only the small
  // manifest (every ZIP's ward list, plus the street->chunk routing
  // table) loads here now — the actual per-county street/geometry
  // payload is fetched lazily by SearchBar itself, only for the chunk(s)
  // a *committed* query actually needs. See src/lib/addressChunks.ts.
  useEffect(() => {
    let cancelled = false;
    fetch(dataUrl("address-index/manifest.json"))
      .then((res) => res.json())
      .then((data: AddressGazetteerManifest) => {
        if (!cancelled) setAddressManifest(data);
      })
      .catch((err) => console.error("[WardMap] failed to load address gazetteer manifest", err));
    return () => {
      cancelled = true;
    };
  }, []);

  // The full Minnesota city/county gazetteer (public/mn-places.json, a
  // few dozen KB — see scripts/fetch-places.mjs) that lets SearchBar
  // recognize *any* MN place name, not just the ones in src/lib/cities.ts
  // this app has ward data for. Fetched separately for the same reason as
  // address-index/manifest.json above: it's its own independent,
  // lazily-loaded concern, and covered-city/-county search already works
  // without it.
  useEffect(() => {
    let cancelled = false;
    fetch(dataUrl("mn-places.json"))
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
    selectedIdentityRef.current = null;
    clearHighlight();
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
      atLargeBoundaries: atLargeBoundariesDataRef.current,
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
  // `identity` is whatever the caller used to decide this was worth
  // selecting in the first place (an officialIdentity() string for a real
  // office, or the same "at-large:<city>"/"city-boundary:<name>" shape
  // handleHoverMove already uses for the two officeless layers) — stashed
  // so a second click on the same area can be told apart from a click on
  // something new. Optional only for call sites with no natural identity
  // of their own to offer; those simply can't ever toggle off by re-
  // selection (existing "tap away"/re-click-the-panel-close-button paths
  // still work regardless).
  const selectPinned = (
    officials: AreaOfficials,
    identity: string | null = null,
    hoveredCityName: string | null = null,
    jumpToTier: keyof AreaOfficials | null = null,
  ) => {
    setSelected({ officials, pinned: true, hoveredCityName, jumpToTier, selectionKey: identity });
    selectedIdentityRef.current = identity;
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
        WARDS_PIN_LINKS_LAYER_ID,
        AT_LARGE_BOUNDARY_FILL_LAYER_ID,
        AT_LARGE_BOUNDARY_OUTLINE_LAYER_ID,
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
    for (const entry of pinMarkersRef.current) {
      const { marker, properties, mode } = entry;
      if (mode === "state-legislature") continue; // governed by applyChamberFilter instead
      const visible = mode === layerModeRef.current && cities[properties.city as City];
      marker.getElement().style.display = visible ? "" : "none";
      // Resync size/formation position the moment this pin is revealed —
      // resizePinsForZoom (the "zoom" listener) skips hidden pins per
      // issue #69, so a pin that just went visible could otherwise sit
      // at whatever zoom level it was last resized at, not the current
      // one, until the next zoom event happens to fire.
      if (visible && map) syncPinGeometryForZoom(map, entry, map.getZoom());
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
    for (const entry of pinMarkersRef.current) {
      const { marker, properties, mode } = entry;
      if (mode !== "state-legislature") continue;
      const visible = showStateLegPins && properties.chamber === nextChamber;
      marker.getElement().style.display = visible ? "" : "none";
      // See applyCityFilter's identical comment — resizePinsForZoom skips
      // hidden pins (issue #69), so a revealed pin needs an explicit
      // resync here or it stays stale until the next zoom event.
      if (visible && map) syncPinGeometryForZoom(map, entry, map.getZoom());
    }
  };

  const applyLayerMode = (mode: LayerMode) => {
    const map = mapRef.current;
    if (!map) return;
    const layerGroups: [LayerMode, string[]][] = [
      [
        "wards",
        [
          WARDS_FILL_LAYER_ID,
          WARDS_OUTLINE_LAYER_ID,
          WARDS_PULSE_LAYER_ID,
          WARDS_LABEL_LAYER_ID,
          WARDS_PIN_LINKS_LAYER_ID,
          AT_LARGE_BOUNDARY_FILL_LAYER_ID,
          AT_LARGE_BOUNDARY_OUTLINE_LAYER_ID,
        ],
      ],
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
    // City-limits backdrop doesn't fit layerGroups above — that array is a
    // strict one-mode-owns-this-layer mapping, but this layer needs to be
    // visible under *two* of the three modes (wards and commissioners),
    // hidden only in the third (state-legislature, where
    // state-legislature.geojson's own statewide coverage already makes it
    // redundant — see CITY_BOUNDARIES_SOURCE_ID's own comment for the full
    // reasoning). Handled as its own rule rather than a second layerGroups
    // entry, which could only ever express "owned by exactly one mode."
    for (const layerId of [CITY_BOUNDARIES_FILL_LAYER_ID, CITY_BOUNDARIES_OUTLINE_LAYER_ID]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", mode === "state-legislature" ? "none" : "visible");
    }
    for (const entry of pinMarkersRef.current) {
      const { marker, properties, mode: pinMode } = entry;
      const visible =
        pinMode === mode &&
        (mode === "state-legislature"
          ? properties.chamber === chamberRef.current
          : visibleCitiesRef.current[properties.city as City]);
      marker.getElement().style.display = visible ? "" : "none";
      // See applyCityFilter's identical comment — resizePinsForZoom skips
      // hidden pins (issue #69), so a pin this mode switch just revealed
      // needs an explicit resync here or it stays stale until the next
      // zoom event happens to fire.
      if (visible) syncPinGeometryForZoom(map, entry, map.getZoom());
    }
  };

  // flyTo defaults on for the legend checkbox's own onChange (the actual
  // "enabling a city" gesture this is for) but is turned off by
  // prepareWardsView below — that call exists only to make sure a search
  // target's city isn't hidden, and it's immediately followed, same tick,
  // by that search's own more specific fitBounds (a single ward, or a
  // multi-city county extent). Flying here too would just be a redundant
  // fitBounds superseded a moment later by the real target — the exact
  // "visible double-animation for what should read as one motion" this
  // file's other zoom helpers already go out of their way to avoid (see
  // prepareWardsView's own comment on skipping zoomToDefault for the same
  // reason).
  const toggleCity = (city: City, { flyTo = true }: { flyTo?: boolean } = {}) => {
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
      // Enabling a city via the legend checkbox (not hiding one — next[city]
      // false means the branch below runs instead) flies the camera to that
      // city's own extent, same as picking it from city search does
      // (applyCityZoom above) — a resident ticking a box wants to see the
      // place they just asked for, not trust it's somewhere in the current
      // view. Bounds come from whatever geometry is loaded so far; if wards/
      // at-large data hasn't arrived yet, boundsForCity returns null and this
      // just no-ops rather than zooming nowhere.
      if (next[city] && flyTo) {
        const bounds = boundsForCity(city);
        if (bounds) zoomToBoundsNoModal(bounds);
      }
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

  // Bulk sibling to toggleCity above, backing the "All"/"None" quick
  // toggle next to the Areas shown checklist — sets every city currently
  // offered by this mode (MODE_VISIBLE_CITIES[layerMode], not the full
  // CITIES list) to the same visibility in one state update rather than
  // firing toggleCity in a loop, which would otherwise re-run
  // applyCityFilter and the selected-panel re-filter once per city.
  // Mirrors toggleCity's own ref-sync and selected-panel re-filter/close
  // logic for the same reason documented there.
  const setCitiesVisible = (cities: readonly City[], visible: boolean) => {
    setVisibleCities((prev) => {
      const next = { ...prev };
      for (const city of cities) next[city] = visible;
      visibleCitiesRef.current = next;
      applyCityFilter(next);
      // Both "All" and "None" fly to the same place: the current mode's
      // default extent — the exact same zoomToDefault() the "tap away"/
      // panel-close deselect gesture already flies to (see deselect's own
      // comment). Deliberately not a per-city-set union computed from just
      // `cities` — that would put "All" and "None" at two different
      // targets (the whole set's bounds vs. some other extent), and would
      // disagree with what deselecting already shows for "nothing/
      // everything selected." One shared "resting position" for every
      // gesture that means "show me the default view" is the point.
      zoomToDefault();
      if (selectedRef.current) {
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
    // flyTo: false — same reasoning as skipping zoomToDefault above, just
    // for toggleCity's own fly-to-city-on-enable instead: the caller
    // (applySearchResult/applyCityZoom/applyCountyZoom) fires its own,
    // more specific fitBounds right after this returns, same tick.
    if (!visibleCitiesRef.current[city]) toggleCity(city, { flyTo: false });
  };

  // Drops (or relocates) the one search-result pin. Reusing the existing
  // Marker instance via setLngLat — rather than remove()-then-recreate on
  // every search — is what makes "one pin, max" true by construction: there
  // is never a moment with two Markers alive, and repeat searches for the
  // same or a different address both just move the same DOM element. `null`
  // clears it (city/county zooms, which have no single point to anchor to).
  const setSearchPin = (lngLat: [number, number] | null) => {
    const map = mapRef.current;
    if (!map) return;
    if (!lngLat) {
      searchPinMarkerRef.current?.remove();
      searchPinMarkerRef.current = null;
      return;
    }
    if (searchPinMarkerRef.current) {
      searchPinMarkerRef.current.setLngLat(lngLat);
      return;
    }
    searchPinMarkerRef.current = new maplibregl.Marker({ element: createSearchPinElement(), anchor: "center" })
      .setLngLat(lngLat)
      .addTo(map);
  };

  // The three SearchBar outcomes that resolve to a map action — see
  // SearchOutcome in src/lib/addressSearch.ts. Ward identity itself was
  // already decided on-device (by scripts/fetch-addresses.mjs at build
  // time for addresses/ZIPs, or is a direct property lookup for city/
  // county); these just replay the same select-and-zoom steps a real
  // click on the polygon would produce.
  const applySearchResult = (ref: WardRef, point: [number, number] | null) => {
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
    // Kept separate from the `point` param (the actual interpolated address,
    // when SearchBar had one) since resolving officials against a point
    // right on a ward boundary is a bigger downside than the visual pin
    // landing a few hundred feet from the literal address — the officials
    // panel keeps using this proven anchor regardless of what the visual
    // pin below does.
    const wardCenterPoint = toPoint(bounds.getCenter());
    const known = normalizeRepProperties(feature.properties);
    // Always selects (never toggles off) — a search result is a fresh,
    // deliberate "go here" action every time, including when it happens to
    // repeat the last one, so it must never read as a second click on an
    // already-selected area and close the panel instead of showing it.
    selectPinned(resolveSelectionAtPoint(wardCenterPoint, known), officialIdentity(known), null, tierForRole(known.role));
    // The visual "you searched here" pin prefers the actual interpolated
    // address point when SearchBar resolved one (a house-number match);
    // falls back to the same ward-center anchor used for official
    // resolution above for city/ZIP-level or ambiguous-free ward picks that
    // never had a precise point to begin with.
    setSearchPin(point ?? wardCenterPoint);
    // Closes MobileNav's Search sheet on mobile so the ward modal (which
    // takes over the sheet slot the instant `selected` is non-null) isn't
    // left stacked behind it — a no-op on desktop, where nothing opened a
    // mobile sheet to begin with.
    setActiveMobileSheet(null);
    zoomToBounds(bounds);
  };

  // Shared by applyCityZoom (search/select) and toggleCity (legend
  // checkbox) — derives a city's extent straight from whichever loaded
  // geometry actually has it, rather than a stored bbox (there isn't one;
  // see the layer registry's own comment for why bounds are always
  // computed live from GeoJSON in this codebase). Wards first: that's
  // every covered city except the wardless (at-large) ones — Woodbury
  // today — which fall through to the derived at-large boundary instead.
  // That derivation only exists once SecondaryCivicData has resolved, so
  // atLargeBoundariesDataRef can briefly be null/empty right after mount —
  // the `?.` below already no-ops harmlessly in that window, same as it
  // always has.
  const boundsForCity = (city: City): maplibregl.LngLatBounds | null => {
    const cityWards = wardsDataRef.current?.features.filter((f) => f.properties?.city === city);
    if (cityWards && cityWards.length > 0) {
      return boundsFromFeatureCollection({ type: "FeatureCollection", features: cityWards });
    }
    const boundary = atLargeBoundariesDataRef.current?.features.filter((f) => f.properties?.city === city);
    if (!boundary || boundary.length === 0) return null;
    return boundsFromFeatureCollection({ type: "FeatureCollection", features: boundary });
  };

  const applyCityZoom = (city: City) => {
    prepareWardsView(city);
    const bounds = boundsForCity(city);
    if (!bounds) return;
    setSelected(null);
    // A city search zooms to an area, not a point — no single address to
    // anchor a pin to, so any pin left over from a previous address search
    // is cleared rather than shown floating somewhere inside the new view.
    setSearchPin(null);
    setActiveMobileSheet(null); // reveal the zoomed-to result instead of leaving the Search sheet up over it
    zoomToBoundsNoModal(bounds);
  };

  const applyCountyZoom = (cities: City[]) => {
    for (const city of cities) prepareWardsView(city);
    const citySet = new Set<City>(cities);
    const countyWards = wardsDataRef.current?.features.filter((f) => citySet.has(f.properties?.city as City));
    // Same fallback as applyCityZoom, extended across every city in the
    // county — a county whose cities are entirely (or partly) at-large
    // (e.g. Washington, today just Woodbury) must not silently drop those
    // cities' extent from the zoom just because they have no ward polygon.
    const countyBoundaries = atLargeBoundariesDataRef.current?.features.filter((f) => citySet.has(f.properties?.city as City));
    const combined = [...(countyWards ?? []), ...(countyBoundaries ?? [])];
    if (combined.length === 0) return;
    setSelected(null);
    setSearchPin(null); // same as applyCityZoom above — a county search has no single point to anchor to
    setActiveMobileSheet(null); // same as applyCityZoom above
    zoomToBoundsNoModal(boundsFromFeatureCollection({ type: "FeatureCollection", features: combined }));
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
      // `bounds` fits the initial camera on first paint (re-fit again once
      // "load" fires below, once the container's size has settled) — see
      // DEFAULT_VIEW_BOUNDS's own comment for why this frame and not a
      // plain center/zoom.
      bounds: DEFAULT_VIEW_BOUNDS,
      fitBoundsOptions: { padding: 40 },
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
    // AGENTS.md §4 ("Respect prefers-reduced-motion") — gates the hover/
    // selection highlight's paint-property transitions below (HOVER_
    // TRANSITION), same media query already used for isDesktopHover. A
    // zero-duration transition still applies the new paint value
    // immediately, it just skips the tween — the highlight itself (which
    // *tier* is emphasized) is real information, not decoration, so it
    // still needs to appear; only the animated fade is what this switches
    // off.
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const HOVER_TRANSITION = { duration: prefersReducedMotion ? 0 : 150 };

    map.on("error", (e) => {
      console.error("[MapLibre ERROR]", e.error?.message ?? e);
    });

    // Keeps every pin's on-screen size (and, for multi-member wards, its
    // formation position) matching the current zoom as the resident
    // zooms — pins are DOM markers (see createRepPinElement's comment),
    // so nothing in MapLibre's own style pipeline resizes or repositions
    // them the way an `interpolate` expression would for a symbol
    // layer's icon-size; this is that behavior, applied by hand. "zoom"
    // fires on every frame of a pinch/scroll/fitBounds animation, faster
    // than layout needs to keep up with, so updates are coalesced to at
    // most one per animation frame rather than applied on every event.
    let pinResizeFrame: number | null = null;
    const resizePinsForZoom = () => {
      pinResizeFrame = null;
      const zoom = map.getZoom();
      for (const entry of pinMarkersRef.current) {
        // Pins hidden by the current LayerMode/city/chamber filter
        // (display:none) are skipped — nothing on screen depends on a
        // hidden pin's size or formation position, and in the default
        // "City" mode that's ~215 of the ~305 total pins (commissioners
        // + state legislators) doing real DOM work every animation
        // frame for nothing. See issue #69. This is safe only because
        // applyCityFilter/applyChamberFilter/applyLayerMode each call
        // syncPinGeometryForZoom themselves at the moment they flip a
        // pin's display back on, so a revealed pin is never stale —
        // skipping it here just means it stops updating while nobody
        // can see it, not that it goes uncorrected once visible again.
        if (entry.marker.getElement().style.display === "none") continue;
        syncPinGeometryForZoom(map, entry, zoom);
      }
      // The dashed connector lines are a real style layer (not a DOM
      // marker), sourced from a plain GeoJSON snapshot — refreshing it
      // here keeps the lines tracking the same pins they're connecting
      // instead of drifting out of sync with them as zoom changes.
      const wardsSource = map.getSource(WARDS_PIN_LINKS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (wardsSource && wardsDataRef.current && mayorsDataRef.current) {
        wardsSource.setData(wardPinConnectorLines(map, wardsDataRef.current, mayorsDataRef.current));
      }
    };
    map.on("zoom", () => {
      if (pinResizeFrame !== null) return;
      pinResizeFrame = requestAnimationFrame(resizePinsForZoom);
    });

    // Pins are plain DOM markers (maplibregl.Marker), not part of the
    // MapLibre style — they survive a setStyle() basemap swap on their own,
    // so each of addPrimaryPins/addSecondaryPins below only ever runs
    // once, guarded by its own flag rather than being re-invoked from
    // switchBasemap the way addSourcesAndLayers is. Split into two
    // (rather than one addPins, like before #67's background-fetch
    // split) so commissioner/state-legislature pins can be added later,
    // whenever SecondaryCivicData actually resolves, without waiting on
    // — or re-adding — the wards/mayors pins primary already placed. See
    // fetchSecondaryCivicData's own comment.
    //
    // Shared by every pin type (mayors, council members, commissioners,
    // state legislators): creates the marker, wires up the same
    // hover/click behavior, and registers it for the mode/city
    // visibility toggles. One place to get this right instead of a
    // near-identical loop body per role — hoisted above both
    // addPrimaryPins/addSecondaryPins so they can share it.
    const addPin = (
      properties: RepProperties,
      coordinates: maplibregl.LngLatLike,
      mode: LayerMode,
      zoomBounds: maplibregl.LngLatBounds,
      // "center" (the default) is right for mayors — a point with no
      // ward/county/state label competing for the same spot, so the pin
      // should sit exactly on its own coordinate. The three roles below
      // that DO share a coordinate with a text label pass "bottom"
      // instead, so the pin's own bottom edge (not its middle) sits at
      // that point — see LABEL_TEXT_OFFSET's comment for the other half
      // of this. That bottom edge is also why zoom-driven resizing (see
      // the "zoom" listener below) never has to touch this offset: a
      // "bottom"-anchored pin grows and shrinks upward, away from its
      // label, so the anchor coordinate — and the gap below it — never
      // moves regardless of diameter.
      anchor: maplibregl.PositionAnchor = "center",
      // Set only for a council-member pin sharing its ward with other
      // members — overrides `coordinates` with a live pixel-projected
      // formation position (see wardPinPixelOffsets) instead of the
      // raw ward bounds-center every member of the group would
      // otherwise collide on. Stored on the PinMarker so the "zoom"
      // listener below can keep recomputing it as the map moves.
      formation?: { center: maplibregl.LngLat; index: number; count: number },
    ) => {
      // Sized for the zoom the map is at right now; kept in sync as that
      // changes by the "zoom" listener below, which walks pinMarkersRef
      // the same way this function populates it.
      const diameter = diameterForZoom(properties.role, map.getZoom());
      const initialLngLat = formation
        ? formationLngLat(
            map,
            formation.center,
            ...wardPinPixelOffsets(formation.count, diameter * WARD_PIN_CLUSTER_SPACING_FACTOR)[formation.index],
          )
        : maplibregl.LngLat.convert(coordinates);
      const el = createRepPinElement(properties, diameter);
      const marker = new maplibregl.Marker({ element: el, anchor }).setLngLat(initialLngLat).addTo(map);
      // A pin's own coordinate always seeds `properties` into its own
      // tier (via resolveSelectionAtPoint's `known` param) — the other
      // two tiers still resolve by point-in-polygon at that same spot.
      // Deliberately the *un-nudged* coordinate for a formation pin
      // (formation.center, not initialLngLat) — the point-in-polygon
      // test needs to land inside the actual ward polygon, and a
      // formation offset large enough to ever risk stepping outside
      // that polygon would already be too large to look like a tight
      // group of pins.
      const point = toPoint(formation ? formation.center : coordinates);

      el.addEventListener("mouseenter", () => {
        if (!isDesktopHover || selectedRef.current?.pinned) return;
        // A pin has no MapLibre feature/id of its own (it's a DOM marker,
        // not a GL layer feature) to key the paint highlight off directly
        // — highlightTargetForRep looks its underlying polygon feature up
        // in the map's own source instead. See that function's own
        // comment for why this is safe to call on every hover despite the
        // extra query.
        setHighlight(highlightTargetForRep(properties));
        setSelected({
          officials: resolveSelectionAtPoint(point, properties),
          pinned: false,
          hoveredCityName: properties.city,
          jumpToTier: tierForRole(properties.role),
          selectionKey: officialIdentity(properties),
        });
      });
      el.addEventListener("mouseleave", () => {
        if (!isDesktopHover || selectedRef.current?.pinned) return;
        setHighlight(null);
        setSelected(null);
      });
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        // Clicking the same pin that's already pinned toggles it back off
        // — same "re-selecting the current area closes it and returns the
        // camera to where it was before" behavior the fill-layer click
        // handler gives wards/counties/state districts, see its own
        // comment. identity here is the pin's own office, so this also
        // catches clicking a ward's polygon and then that same ward's pin
        // (or vice versa) as "the same selection," not two different ones.
        const identity = officialIdentity(properties);
        if (selectedRef.current?.pinned && selectedIdentityRef.current === identity) {
          deselect();
          return;
        }
        selectPinned(resolveSelectionAtPoint(point, properties), identity, properties.city, tierForRole(properties.role));
        setHighlight(highlightTargetForRep(properties));
        setActiveMobileSheet(null); // see applySearchResult's comment on this same call
        zoomToBounds(zoomBounds);
      });

      pinMarkersRef.current.push({ marker, properties, mode, formation });
    };

    let primaryPinsAdded = false;
    const addPrimaryPins = (primary: PrimaryCivicData) => {
      if (primaryPinsAdded) return;
      primaryPinsAdded = true;
      const { wards: data, mayors: mayorsData } = primary;

      // Grouped by city (see groupFeaturesByCity) rather than iterated
      // directly, so Woodbury's mayor + 4 at-large council members —
      // sharing one City Hall coordinate, unlike every other city's single
      // mayor — fan out into a formation instead of stacking on one pixel,
      // same mechanism the multi-member-ward loop below already uses.
      for (const group of groupFeaturesByCity(mayorsData).values()) {
        const [lng, lat] = (group[0].geometry as Point).coordinates as [number, number];
        const center = maplibregl.LngLat.convert([lng, lat]);
        group.forEach((feature, i) => {
          const properties = feature.properties as RepProperties;
          addPin(properties, [lng, lat], "wards", boundsAroundPoint(lng, lat), "bottom", {
            center,
            index: i,
            count: group.length,
          });
        });
      }

      // One pin per council member, centered on their ward — same
      // bounds-center-as-marker-position approach as commissioners below,
      // since (unlike mayors) there's no single office address to anchor to.
      // A handful of wards (Blaine's and Brooklyn Park's, currently) seat
      // two or more members off one shared polygon — bounds-center would
      // place all of them on the exact same coordinate, so each group is
      // laid out in the fixed formation wardPinPixelOffsets returns for
      // its size (a line, a triangle, a square, ...) instead, via the
      // `formation` passed to addPin. The polygon itself (fill/outline/
      // zoom target) is untouched — only the pin marker's coordinate
      // shifts. wardPinConnectorLines (added as its own layer in
      // addSourcesAndLayers) draws a dotted outline of the same
      // formation, so the grouping stays visually a group of pins.
      for (const group of groupWardFeaturesByWard(data).values()) {
        const center = boundsFromFeature(group[0]).getCenter();
        group.forEach((feature, i) => {
          const properties = feature.properties as RepProperties;
          const bounds = boundsFromFeature(feature);
          addPin(properties, center, "wards", bounds, "bottom", { center, index: i, count: group.length });
        });
      }
    };

    let secondaryPinsAdded = false;
    const addSecondaryPins = (secondary: Pick<SecondaryCivicData, "commissioners" | "stateLeg">) => {
      if (secondaryPinsAdded) return;
      secondaryPinsAdded = true;
      const { commissioners: commissionersData, stateLeg: stateLegData } = secondary;

      // One pin per commissioner, same interaction pattern as mayors, but
      // there's no office address to anchor to — a district's bounds
      // center stands in for "somewhere inside the district" well enough
      // for a marker (as opposed to fitBounds, which needs the real shape).
      for (const feature of commissionersData.features) {
        if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") continue;
        const properties = feature.properties as RepProperties;
        const bounds = boundsFromFeature(feature as Feature<Geometry>);
        addPin(properties, bounds.getCenter(), "commissioners", bounds, "bottom");
      }

      // One pin per state legislator — role (and so pin size) varies
      // feature-to-feature here, unlike the loop above, since a single
      // source covers both House and Senate districts.
      for (const feature of stateLegData.features) {
        if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") continue;
        const properties = feature.properties as RepProperties;
        const bounds = boundsFromFeature(feature as Feature<Geometry>);
        addPin(properties, bounds.getCenter(), "state-legislature", bounds, "bottom");
      }
    };

    // Sources and every fill/outline/pulse/label layer built off them —
    // unlike pins, these ARE part of the MapLibre style, so setStyle()
    // throws all of it away on a basemap swap. Guarded (not by a ref, but
    // by map.getSource itself) so it's safe to call both from the initial
    // "load" below and from switchBasemap's "style.load" after every
    // subsequent swap — the guard passes either way, since a fresh style
    // genuinely has none of these sources yet.
    //
    // Reads straight from the *Ref.current values rather than taking a
    // parameter, so it always picks up whatever's actually available the
    // moment it runs — including commissioners/stateLeg/cityBoundaries/
    // atLargeBoundaries, which may or may not have arrived yet
    // (SecondaryCivicData loads in the background, after wards/mayors —
    // see fetchSecondaryCivicData's own comment). Only ever called once
    // wardsDataRef/mayorsDataRef are populated (both call sites below
    // await primaryCivicDataPromiseRef first), so those two are asserted
    // non-null; commissioners/stateLeg/cityBoundaries/atLargeBoundaries
    // fall back to EMPTY_FEATURE_COLLECTION when not loaded/derived yet —
    // every layer built off them starts hidden or empty by default anyway
    // (layerMode defaults to "wards", and an empty at-large source just
    // means Woodbury's accent fill hasn't appeared yet — see
    // deriveAtLargeBoundaries's own comment on that tradeoff), and
    // applySecondaryCivicDataRef patches in the real data with setData()
    // the moment it resolves.
    const addSourcesAndLayers = () => {
      if (map.getSource(WARDS_SOURCE_ID)) return;
      const data = wardsDataRef.current!;
      const mayorsData = mayorsDataRef.current!;
      const atLargeBoundariesData = atLargeBoundariesDataRef.current ?? EMPTY_FEATURE_COLLECTION;
      const commissionersData = commissionersDataRef.current ?? EMPTY_FEATURE_COLLECTION;
      const stateLegData = stateLegDataRef.current ?? EMPTY_FEATURE_COLLECTION;
      const cityBoundariesData = cityBoundariesDataRef.current ?? EMPTY_FEATURE_COLLECTION;

      // Tuned against the *current basemap's* own darkness — see
      // OUTLINE_COLOR/LABEL_PAINT's own comment — recomputed on every call
      // so a swap to/from a dark basemap re-colors boundaries and labels
      // along with it, not just the tiles underneath them.
      const dark = isMapStyleDark(currentStyleId);
      const outlineColor = dark ? OUTLINE_COLOR.dark : OUTLINE_COLOR.light;
      const labelPaint = dark ? LABEL_PAINT.dark : LABEL_PAINT.light;

      // Statewide city-limits backdrop — added first, before every other
      // source/layer below, so z-order alone (no `beforeId` is ever passed
      // to addLayer in this file) keeps it painted underneath every real
      // data tier. See CITY_BOUNDARIES_SOURCE_ID's own comment. Low flat
      // opacity, one neutral color (not the per-city palette wards use —
      // this is backdrop, not a data-carrying fill), reusing OUTLINE_COLOR
      // for basemap-dark/light contrast the same way every outline here
      // already does. Initial visibility keys off layerModeRef.current
      // (hidden only in state-legislature mode), matching commissioners/
      // state-legislature's own already-established pattern of setting the
      // correct starting visibility here rather than leaving a flash of
      // the wrong state before applyLayerMode's own call — further down
      // this same "load"/basemap-swap path — corrects it a moment later.
      // generateId: true on every polygon source below (not the label/pin-
      // link sources — nothing highlights those) assigns each feature a
      // stable numeric id MapLibre tracks internally, which is what makes
      // setFeatureState/hoverExpr's ["feature-state","hover"] read below
      // possible without the source data carrying its own id field.
      map.addSource(CITY_BOUNDARIES_SOURCE_ID, { type: "geojson", data: cityBoundariesData, generateId: true });
      map.addLayer({
        id: CITY_BOUNDARIES_FILL_LAYER_ID,
        type: "fill",
        source: CITY_BOUNDARIES_SOURCE_ID,
        layout: { visibility: layerModeRef.current === "state-legislature" ? "none" : "visible" },
        paint: {
          "fill-color": outlineColor,
          "fill-opacity": hoverExpr(0.08, 0.2),
          "fill-opacity-transition": HOVER_TRANSITION,
        },
      });
      map.addLayer({
        id: CITY_BOUNDARIES_OUTLINE_LAYER_ID,
        type: "line",
        source: CITY_BOUNDARIES_SOURCE_ID,
        layout: { visibility: layerModeRef.current === "state-legislature" ? "none" : "visible" },
        paint: {
          "line-color": outlineColor,
          "line-width": hoverExpr(0.5, 2),
          "line-opacity": hoverExpr(0.5, 0.9),
          "line-width-transition": HOVER_TRANSITION,
          "line-opacity-transition": HOVER_TRANSITION,
        },
      });

      map.addSource(WARDS_SOURCE_ID, { type: "geojson", data, generateId: true });
      map.addSource(COMMISSIONERS_SOURCE_ID, { type: "geojson", data: commissionersData, generateId: true });
      map.addSource(STATE_LEG_SOURCE_ID, { type: "geojson", data: stateLegData, generateId: true });
      map.addSource(AT_LARGE_BOUNDARIES_SOURCE_ID, { type: "geojson", data: atLargeBoundariesData, generateId: true });
      // One point per polygon, at that polygon's own bounds-center — see
      // labelPointsFromFeatureCollection's comment. The three label layers
      // below source from these instead of the polygon sources themselves.
      map.addSource(WARDS_LABEL_SOURCE_ID, { type: "geojson", data: labelPointsFromFeatureCollection(data) });
      map.addSource(COMMISSIONERS_LABEL_SOURCE_ID, {
        type: "geojson",
        data: labelPointsFromFeatureCollection(commissionersData),
      });
      map.addSource(STATE_LEG_LABEL_SOURCE_ID, { type: "geojson", data: labelPointsFromFeatureCollection(stateLegData) });
      // See wardPinConnectorLines's comment — one dashed LineString per
      // ward that seats more than one council member, tracing the same
      // formation their pins are laid out in.
      map.addSource(WARDS_PIN_LINKS_SOURCE_ID, { type: "geojson", data: wardPinConnectorLines(map, data, mayorsData) });

      map.addLayer({
        id: WARDS_FILL_LAYER_ID,
        type: "fill",
        source: WARDS_SOURCE_ID,
        paint: {
          "fill-color": WARD_FILL_COLOR_EXPRESSION,
          "fill-opacity": hoverExpr(0.6, 0.85),
          "fill-opacity-transition": HOVER_TRANSITION,
        },
      });
      map.addLayer({
        id: WARDS_OUTLINE_LAYER_ID,
        type: "line",
        source: WARDS_SOURCE_ID,
        paint: {
          "line-color": outlineColor,
          "line-width": hoverExpr(1.5, 3),
          "line-width-transition": HOVER_TRANSITION,
        },
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
        // Sources from the bounds-center point collection, not WARDS_SOURCE_ID
        // itself — see LABEL_TEXT_OFFSET's comment. "text-anchor: top" +
        // the downward text-offset render this text below that shared
        // point, opposite the council-member pin's "bottom" anchor above it.
        source: WARDS_LABEL_SOURCE_ID,
        layout: {
          // Falls back to "Ward N" only when there's no city-given name for
          // the area (Brooklyn Park's Central/East/West districts carry a
          // wardName instead — see the field's comment in types.ts).
          "text-field": ["coalesce", ["get", "wardName"], ["concat", "Ward ", ["to-string", ["get", "ward"]]]],
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
          "text-anchor": "top",
          "text-offset": LABEL_TEXT_OFFSET,
        },
        paint: labelPaint,
      });
      // Dashed rather than solid — a visual "these belong together" hint
      // subordinate to the pins themselves (DOM markers, always rendered
      // above this GL layer regardless of paint order), not a boundary or
      // route implying anything about the underlying geography.
      map.addLayer({
        id: WARDS_PIN_LINKS_LAYER_ID,
        type: "line",
        source: WARDS_PIN_LINKS_SOURCE_ID,
        paint: { "line-color": outlineColor, "line-width": 1.5, "line-dasharray": [2, 2], "line-opacity": 0.8 },
      });

      // At-large city boundary fill — see AT_LARGE_BOUNDARIES_SOURCE_ID's
      // own comment. Added after the ward layers above, so MapLibre paints
      // it on top of them if the two ever geographically overlapped — they
      // don't today (every at-large city is wardless by definition, so
      // there's no ward polygon to sit under), but painting the boundary
      // last means a future edge case fails safe (the boundary stays
      // visible) rather than silently hidden under a ward fill.
      map.addLayer({
        id: AT_LARGE_BOUNDARY_FILL_LAYER_ID,
        type: "fill",
        source: AT_LARGE_BOUNDARIES_SOURCE_ID,
        paint: {
          "fill-color": AT_LARGE_BOUNDARY_FILL_COLOR_EXPRESSION,
          "fill-opacity": hoverExpr(0.5, 0.75),
          "fill-opacity-transition": HOVER_TRANSITION,
        },
      });
      map.addLayer({
        id: AT_LARGE_BOUNDARY_OUTLINE_LAYER_ID,
        type: "line",
        source: AT_LARGE_BOUNDARIES_SOURCE_ID,
        paint: {
          "line-color": outlineColor,
          "line-width": hoverExpr(1.5, 3),
          "line-width-transition": HOVER_TRANSITION,
        },
      });

      map.addLayer({
        id: COMMISSIONERS_FILL_LAYER_ID,
        type: "fill",
        source: COMMISSIONERS_SOURCE_ID,
        layout: { visibility: "none" },
        paint: {
          "fill-color": COMMISSIONER_FILL_COLOR_EXPRESSION,
          "fill-opacity": hoverExpr(0.6, 0.85),
          "fill-opacity-transition": HOVER_TRANSITION,
        },
      });
      map.addLayer({
        id: COMMISSIONERS_OUTLINE_LAYER_ID,
        type: "line",
        source: COMMISSIONERS_SOURCE_ID,
        layout: { visibility: "none" },
        paint: {
          "line-color": outlineColor,
          "line-width": hoverExpr(1.5, 3),
          "line-width-transition": HOVER_TRANSITION,
        },
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
        source: COMMISSIONERS_LABEL_SOURCE_ID,
        layout: {
          "text-field": ["concat", "District ", ["to-string", ["get", "district"]]],
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
          "text-anchor": "top",
          "text-offset": LABEL_TEXT_OFFSET,
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
        paint: {
          "fill-color": STATE_LEG_FILL_COLOR_EXPRESSION,
          "fill-opacity": hoverExpr(0.6, 0.85),
          "fill-opacity-transition": HOVER_TRANSITION,
        },
      });
      map.addLayer({
        id: STATE_LEG_OUTLINE_LAYER_ID,
        type: "line",
        source: STATE_LEG_SOURCE_ID,
        layout: { visibility: "none" },
        filter: defaultChamberFilter,
        paint: {
          "line-color": outlineColor,
          "line-width": hoverExpr(1.5, 3),
          "line-width-transition": HOVER_TRANSITION,
        },
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
        source: STATE_LEG_LABEL_SOURCE_ID,
        layout: {
          "text-field": ["concat", "District ", ["get", "stateDistrict"]],
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
          "text-anchor": "top",
          "text-offset": LABEL_TEXT_OFFSET,
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
      // Registered before every other tier's own listeners below — order
      // doesn't matter for correctness (handleHoverMove's own
      // CITY_BOUNDARIES branch explicitly defers to a real tier via its
      // own queryRenderedFeatures check, rather than relying on which
      // delegate happens to fire first/last on a shared event), but this
      // still reads naturally as "the backdrop, then each real tier" —
      // see that branch's own comment for why MapLibre firing every
      // matching layer-scoped delegate independently, not just the
      // topmost, made a same-point-two-listeners guard necessary at all.
      map.on("mousemove", CITY_BOUNDARIES_FILL_LAYER_ID, handleHoverMove);
      map.on("mouseleave", CITY_BOUNDARIES_FILL_LAYER_ID, handleHoverLeave);
      map.on("mousemove", WARDS_FILL_LAYER_ID, handleHoverMove);
      map.on("mouseleave", WARDS_FILL_LAYER_ID, handleHoverLeave);
      map.on("mousemove", AT_LARGE_BOUNDARY_FILL_LAYER_ID, handleHoverMove);
      map.on("mouseleave", AT_LARGE_BOUNDARY_FILL_LAYER_ID, handleHoverLeave);
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

    // Only animate if something's actually contested — with today's data
    // that's never true (see the isContested comment in types.ts), so
    // this costs nothing until real candidate-filing data changes that.
    // Guarded by its own flag so it's safe to call from both "load" and
    // applySecondaryCivicData below (commissioners/stateLeg's contested
    // status isn't knowable until whichever of them resolves) without
    // starting a second overlapping animation loop. Never re-checked
    // after that first true reading — a contested race that later
    // resolves during the same page view is not a case this needs to
    // handle live. Never restarted from switchBasemap either: the
    // animation loop's own `if (map.getLayer(layerId))` guards make it
    // self-healing across a basemap swap (it just skips paint-property
    // writes for the few frames the pulse layers don't exist yet,
    // between setStyle() and addSourcesAndLayers re-adding them).
    let pulseAnimationStarted = false;
    const maybeStartPulseAnimation = () => {
      if (pulseAnimationStarted) return;
      const anyContested =
        (wardsDataRef.current?.features ?? []).some((f) => f.properties?.isContested) ||
        (commissionersDataRef.current?.features ?? []).some((f) => f.properties?.isContested) ||
        (stateLegDataRef.current?.features ?? []).some((f) => f.properties?.isContested);
      if (!anyContested) return;
      pulseAnimationStarted = true;
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
    };

    // Patches a just-resolved SecondaryCivicData into the live map —
    // called from the mount effect above once fetchSecondaryCivicData
    // resolves. If the map hasn't reached "load" yet (sources don't
    // exist), this is a no-op: addSourcesAndLayers reads straight from
    // commissionersDataRef/stateLegDataRef (already updated by the
    // caller before this runs) rather than a stale snapshot, so it picks
    // up the real data on its own the moment it does run — nothing here
    // needs to force that. Assigned to applySecondaryCivicDataRef so the
    // mount effect (outside this one) can reach it, same bridging
    // pattern as switchBasemapRef below.
    const applySecondaryCivicData = (secondary: SecondaryCivicData) => {
      const commissionersSource = map.getSource(COMMISSIONERS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      const stateLegSource = map.getSource(STATE_LEG_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!commissionersSource || !stateLegSource) return;
      commissionersSource.setData(secondary.commissioners);
      stateLegSource.setData(secondary.stateLeg);
      (map.getSource(CITY_BOUNDARIES_SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(secondary.cityBoundaries);
      // atLargeBoundariesDataRef.current was already derived and set by
      // the mount effect's caller above, before this function ran — just
      // push it onto the live source here. See deriveAtLargeBoundaries's
      // own comment for the derivation and the tradeoff it accepts.
      (map.getSource(AT_LARGE_BOUNDARIES_SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(
        atLargeBoundariesDataRef.current ?? EMPTY_FEATURE_COLLECTION,
      );
      (map.getSource(COMMISSIONERS_LABEL_SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(
        labelPointsFromFeatureCollection(secondary.commissioners),
      );
      (map.getSource(STATE_LEG_LABEL_SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(
        labelPointsFromFeatureCollection(secondary.stateLeg),
      );
      addSecondaryPins(secondary);
      // addSourcesAndLayers' own applyLayerMode() call (in the "load"
      // handler, before this ever runs) already set every *existing*
      // pin's display to match the current mode — but addSecondaryPins
      // just pushed 200+ new commissioner/state-legislature markers into
      // pinMarkersRef.current *after* that pass ran, and a freshly
      // `.addTo(map)`-ed maplibregl.Marker defaults to visible. Without
      // this, every county/state pin statewide renders on top of the
      // default "wards" view the moment this background fetch resolves
      // — the exact bug this line fixes (all reps across the state
      // appearing and tanking render performance, regardless of which
      // mode is actually selected). Re-running the same visibility pass
      // now, after the new pins exist, is what actually hides them.
      applyLayerMode(layerModeRef.current);
      maybeStartPulseAnimation();
    };
    applySecondaryCivicDataRef.current = applySecondaryCivicData;

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
        const primary = await primaryCivicDataPromiseRef.current;
        if (!primary) return;
        addSourcesAndLayers();
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
      // is also what populates wardsDataRef/mayorsDataRef (and, once
      // SecondaryCivicData resolves, atLargeBoundariesDataRef — see
      // deriveAtLargeBoundaries's own comment), so search can use them
      // even if this "load" event never fires at all. Deliberately does
      // NOT also wait on fetchSecondaryCivicData's promise — that would
      // put commissioners/state-legislature.geojson back in the
      // initial-paint critical path, exactly what #67 Finding 2 moved
      // them out of. See that function's own comment.
      const primary = await primaryCivicDataPromiseRef.current;
      if (!primary) return; // fetch failed — nothing to draw; already logged in fetchPrimaryCivicData

      addPrimaryPins(primary);
      addSourcesAndLayers();
      // Secondary data may already have arrived by now — fetched right
      // after primary resolved, which could easily be before this "load"
      // event fires on a slow WebGL/style init. addSourcesAndLayers()
      // above already seeded the commissioners/state-legislature sources
      // with real data in that case (it reads straight from the refs);
      // pins are the one thing it doesn't cover, so add them now if so.
      // The far more common case — secondary still in flight — is
      // handled by applySecondaryCivicData above instead, once it
      // resolves; addSecondaryPins' own guard makes calling it from both
      // places safe either way.
      if (commissionersDataRef.current && stateLegDataRef.current) {
        addSecondaryPins({ commissioners: commissionersDataRef.current, stateLeg: stateLegDataRef.current });
        // addSourcesAndLayers() above already ran its own applyLayerMode()
        // pass, but that was before the pins added just now existed —
        // same reason applySecondaryCivicData re-runs it, see that
        // function's own comment. Without this, this (rare — secondary
        // data winning the race against "load") path ships the same
        // all-pins-visible bug the far more common path fixes.
        applyLayerMode(layerModeRef.current);
      }
      maybeStartPulseAnimation();

      // Initial camera fit only — re-fits to the same DEFAULT_VIEW_BOUNDS
      // the constructor's `bounds` option already fit to (see that
      // constant's comment), since the container's size can settle after
      // construction but before this "load" event fires, leaving the
      // constructor's own fit slightly off. wardsBoundsRef (used by
      // zoomToDefault, e.g. on deselect or mode switch) covers every
      // covered city's actual ward data instead of this fixed three-town
      // frame — deliberately not used here. Also deliberately not repeated
      // on a basemap swap — switchBasemap has no call to this, so picking
      // a new basemap never snaps the camera back to this default extent
      // out from under whatever the resident was looking at.
      map.fitBounds(DEFAULT_VIEW_BOUNDS, { padding: 40, duration: 0 });
    });

    // Moves the hover/selection paint highlight (hoverExpr's feature-state
    // case, set up per-layer in addSourcesAndLayers) from whichever
    // feature carried it last to `next` — or clears it entirely when
    // `next` is null (hover leaving the map, or deselect()). Feature-state
    // is additive per id, not a single "the current one" pointer the way a
    // `filter` swap would be, so the previous feature's flag has to be
    // explicitly removed or it would stay highlighted forever once
    // touched. Safe to call with a source that no longer exists (a
    // basemap swap tears down and rebuilds every source — see
    // addSourcesAndLayers' own comment) since map.getSource guards both
    // the clear and the set.
    const setHighlight = (next: { source: string; id: string | number } | null) => {
      const current = highlightedFeatureRef.current;
      if (current && (!next || current.source !== next.source || current.id !== next.id)) {
        clearHighlight();
      }
      if (next && map.getSource(next.source)) {
        map.setFeatureState({ source: next.source, id: next.id }, { hover: true });
        highlightedFeatureRef.current = next;
      }
    };

    // The pin-driven hover/click handlers below (mayor/council/
    // commissioner/state-leg markers) have no MapLibre feature object of
    // their own to read a feature-state id off — unlike a fill-layer
    // hover/click, which gets one for free on `e.features[0]`/the
    // queryRenderedFeatures hit. This looks the matching feature up in the
    // map's own copy of the source (not wardsDataRef/etc.'s raw fetched
    // FeatureCollection, which never passed through generateId) using the
    // same locator fields officialIdentity/the click handlers' own
    // `matchesHit` functions already key off, so the returned id is one
    // setHighlight can act on. querySourceFeatures reads from already-
    // loaded tiles; for a GeoJSON source's single implicit tile that's the
    // whole dataset, so this is safe to call as soon as the source exists.
    const highlightTargetForRep = (rep: RepProperties): { source: string; id: string | number } | null => {
      let source: string;
      let filter: maplibregl.FilterSpecification;
      if (rep.role === "Mayor" || rep.role === "Council Member") {
        if (rep.ward !== null) {
          source = WARDS_SOURCE_ID;
          filter = ["all", ["==", ["get", "city"], rep.city], ["==", ["get", "ward"], rep.ward]] as unknown as maplibregl.FilterSpecification;
        } else {
          source = AT_LARGE_BOUNDARIES_SOURCE_ID;
          filter = ["==", ["get", "city"], rep.city] as unknown as maplibregl.FilterSpecification;
        }
      } else if (rep.role === "County Commissioner") {
        source = COMMISSIONERS_SOURCE_ID;
        filter = ["all", ["==", ["get", "county"], rep.county], ["==", ["get", "district"], rep.district]] as unknown as maplibregl.FilterSpecification;
      } else {
        source = STATE_LEG_SOURCE_ID;
        filter = ["all", ["==", ["get", "chamber"], rep.chamber], ["==", ["get", "stateDistrict"], rep.stateDistrict]] as unknown as maplibregl.FilterSpecification;
      }
      if (!map.getSource(source)) return null;
      const match = map.querySourceFeatures(source, { filter })[0];
      return match?.id != null ? { source, id: match.id } : null;
    };

    const handleHoverMove = (e: maplibregl.MapLayerMouseEvent) => {
      if (!isDesktopHover) return;
      // A click-pinned modal stays put; hover shouldn't swap its content
      // out from under the user while it's pinned open.
      if (selectedRef.current?.pinned) return;
      map.getCanvas().style.cursor = "pointer";
      const feature = e.features?.[0];
      if (!feature) return;
      const point = toPoint(e.lngLat);
      // The at-large boundary layer's features carry only `{ city }` — not
      // a real official, so there's no RepProperties to seed `known` with
      // (normalizeRepProperties would happily fabricate one anyway, since
      // it only fills in null defaults rather than validating required
      // fields — that half-formed record would then get inserted directly
      // into a tier by resolveOfficialsAtPoint's own `known` handling,
      // which is exactly the bug this branch avoids). officials.ts's own
      // atLargeBoundaries point-in-polygon check already finds every real
      // official for this city with no `known` needed at all.
      if (feature.layer.id === AT_LARGE_BOUNDARY_FILL_LAYER_ID) {
        const hoverIdentity = `at-large:${feature.properties?.city}`;
        if (hoverIdentity === lastHoverIdentityRef.current) return;
        lastHoverIdentityRef.current = hoverIdentity;
        setHighlight(feature.id != null ? { source: feature.source, id: feature.id } : null);
        setSelected({
          officials: resolveSelectionAtPoint(point),
          pinned: false,
          hoveredCityName: feature.properties?.city ?? null,
          jumpToTier: "city",
          selectionKey: hoverIdentity,
        });
        return;
      }
      // city-boundaries features carry only `{ name, county, population,
      // gnisId }`, no office — same "no known to seed with" shape as the
      // at-large branch above. Unlike every other layer here, this one is
      // *always* visible statewide, so its polygon sits underneath every
      // real tier's own polygon everywhere that tier exists — MapLibre
      // fires each layer-scoped mousemove delegate independently (not
      // just the topmost), so without this guard, hovering anywhere
      // inside a covered city fired THIS branch and the real tier's own
      // branch on every single mousemove tick, each doing a full
      // resolveSelectionAtPoint scan + setSelected/re-render, and (since
      // both write the same lastHoverIdentityRef) permanently defeating
      // the "skip unless the hovered feature changed" check below —
      // twice the resolution cost and twice the re-renders on every
      // event, for as long as the cursor sat over any of the 17 covered
      // cities. Bailing out here whenever a real tier also has a feature
      // at this exact point — letting that tier's own delegated listener
      // own the hover state entirely, untouched — fixes both the
      // performance regression and restores the single-resolution-per-
      // identity-change behavior every other branch already has.
      if (feature.layer.id === CITY_BOUNDARIES_FILL_LAYER_ID) {
        const realTierLayers = [
          WARDS_FILL_LAYER_ID,
          AT_LARGE_BOUNDARY_FILL_LAYER_ID,
          COMMISSIONERS_FILL_LAYER_ID,
          STATE_LEG_FILL_LAYER_ID,
        ].filter((id) => map.getLayer(id));
        if (realTierLayers.length > 0 && map.queryRenderedFeatures(e.point, { layers: realTierLayers }).length > 0) {
          return;
        }
        const hoverIdentity = `city-boundary:${feature.properties?.name}`;
        if (hoverIdentity === lastHoverIdentityRef.current) return;
        lastHoverIdentityRef.current = hoverIdentity;
        setHighlight(feature.id != null ? { source: feature.source, id: feature.id } : null);
        setSelected({
          officials: resolveSelectionAtPoint(point),
          pinned: false,
          hoveredCityName: feature.properties?.name ?? null,
          jumpToTier: "city",
          selectionKey: hoverIdentity,
        });
        return;
      }
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
      setHighlight(feature.id != null ? { source: feature.source, id: feature.id } : null);
      setSelected({
        officials: resolveSelectionAtPoint(point, known),
        pinned: false,
        hoveredCityName: known.city,
        jumpToTier: tierForRole(known.role),
        selectionKey: hoverIdentity,
      });
    };
    const handleHoverLeave = () => {
      if (!isDesktopHover) return;
      lastHoverIdentityRef.current = null;
      map.getCanvas().style.cursor = "";
      if (selectedRef.current?.pinned) return;
      setHighlight(null);
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
      // City-boundaries listed last — it's painted underneath every other
      // tier (added first, see CITY_BOUNDARIES_SOURCE_ID's own comment), so
      // queryRenderedFeatures's topmost-first ordering already makes wards/
      // at-large/commissioners/state-legislature win a click inside a
      // covered city regardless of this array's own order; listed last
      // purely to read consistently with that z-order.
      const queryableLayers = [
        WARDS_FILL_LAYER_ID,
        AT_LARGE_BOUNDARY_FILL_LAYER_ID,
        COMMISSIONERS_FILL_LAYER_ID,
        STATE_LEG_FILL_LAYER_ID,
        CITY_BOUNDARIES_FILL_LAYER_ID,
      ].filter((id) => map.getLayer(id));
      if (queryableLayers.length === 0) return;
      const features = map.queryRenderedFeatures(e.point, {
        layers: queryableLayers,
      });
      const hit = features[0];
      if (!hit) {
        if (selectedRef.current?.pinned) deselect();
        return;
      }
      // Same "no real RepProperties to seed `known` with" case as
      // handleHoverMove above — resolved entirely through
      // officials.ts's atLargeBoundaries point-in-polygon check instead.
      // Bounds come from the untiled source feature (same reason every
      // other branch below re-looks-up its hit — see the comment past
      // this early return), not the tile-clipped `hit` geometry directly.
      if (hit.layer.id === AT_LARGE_BOUNDARY_FILL_LAYER_ID) {
        // Same shape handleHoverMove already uses for this layer's hover
        // identity — reused here so a second click toggles the area off.
        const identity = `at-large:${hit.properties?.city}`;
        if (selectedRef.current?.pinned && selectedIdentityRef.current === identity) {
          deselect();
          return;
        }
        const point = toPoint(e.lngLat);
        selectPinned(resolveSelectionAtPoint(point), identity, (hit.properties?.city as string | undefined) ?? null, "city");
        setHighlight(hit.id != null ? { source: hit.source, id: hit.id } : null);
        setActiveMobileSheet(null);
        const boundaryFeature = atLargeBoundariesDataRef.current?.features.find(
          (f) => f.properties?.city === hit.properties?.city,
        );
        zoomToBounds(boundsFromFeature((boundaryFeature ?? hit) as Feature<Geometry>));
        return;
      }
      // Same "no real RepProperties to seed `known` with" case as the
      // at-large branch above. Only ever reached for a city with no ward,
      // at-large, commissioner, or state-legislature polygon under the
      // click (those all paint on top of this backdrop and win the
      // queryRenderedFeatures tie first) — resolveSelectionAtPoint(point)
      // with no `known` then resolves to every tier empty, surfacing
      // WardModal's existing "outside every city this map has ward data
      // for" empty state (coverage.ts's CITY_TIER_EMPTY_NOTE).
      if (hit.layer.id === CITY_BOUNDARIES_FILL_LAYER_ID) {
        // Same shape handleHoverMove already uses for this layer's hover
        // identity — reused here so a second click toggles the area off.
        const identity = `city-boundary:${hit.properties?.name}`;
        if (selectedRef.current?.pinned && selectedIdentityRef.current === identity) {
          deselect();
          return;
        }
        const point = toPoint(e.lngLat);
        selectPinned(resolveSelectionAtPoint(point), identity, (hit.properties?.name as string | undefined) ?? null, "city");
        setHighlight(hit.id != null ? { source: hit.source, id: hit.id } : null);
        setActiveMobileSheet(null);
        const boundaryFeature = cityBoundariesDataRef.current?.features.find(
          (f) => f.properties?.name === hit.properties?.name,
        );
        zoomToBounds(boundsFromFeature((boundaryFeature ?? hit) as Feature<Geometry>));
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
      // Clicking the same ward/county/state district that's already
      // pinned toggles it back off instead of re-selecting (and
      // re-zooming to the exact same bounds) — same identity comparison
      // addPin's own click listener uses, see its comment. identity here
      // is the tier's own office at this point, so clicking a ward's
      // polygon and then that same ward's council-member pin (or vice
      // versa) both read as "the same selection."
      const identity = officialIdentity(known);
      if (selectedRef.current?.pinned && selectedIdentityRef.current === identity) {
        deselect();
        return;
      }
      const point = toPoint(e.lngLat);
      selectPinned(resolveSelectionAtPoint(point, known), identity, known.city, tierForRole(known.role));
      setHighlight(hit.id != null ? { source: hit.source, id: hit.id } : null);
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
      if (pinResizeFrame !== null) cancelAnimationFrame(pinResizeFrame);
      for (const { marker } of pinMarkersRef.current) marker.remove();
      pinMarkersRef.current = [];
      searchPinMarkerRef.current?.remove();
      searchPinMarkerRef.current = null;
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
      manifest={addressManifest}
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
  //   "sidebar" — the desktop left `<aside>` below now mimics the right
  //   detail sidebar's own panel chrome (title bar, navy-fill segmented
  //   control — see sidebarTabRowClass/sidebarTabButtonClass below)
  //   instead of a bordered-row variant of the floating card, so this
  //   helper only still has a "floating" shape to produce.
  // Desktop used to mount the "floating" flavor top-left, absolutely
  // positioned over the map, the same way MobileNav's sheet still does —
  // see the left `<aside>` in the return below for where the sidebar
  // flavor mounts now instead.
  const filterGroupClass = () =>
    "flex rounded-lg bg-panel-2/90 backdrop-blur-sm border border-hair shadow-lg shadow-(color:--shadow-panel) p-1 text-sm";
  // Sidebar-only: a short Water Blue tick ahead of the label — the flag's
  // own accent (see globals.css's --sidebar-accent) used as a structural
  // marker, not just a color swap. AGENTS.md §4 "structure is
  // information": this is what tells a resident's eye "here's a new
  // group of controls" before they've read the words.
  // No mb-* of its own — callers wrap this in their own margin-bottom
  // container so a label sitting beside AreaFilterList's own bulk-toggle
  // row doesn't pick up a second, misaligning gap from a margin baked
  // into the label itself.
  const filterSectionLabel = (variant: "floating" | "sidebar", text: string) =>
    variant === "sidebar" ? (
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
        <span aria-hidden="true" className="h-2.5 w-1 shrink-0 rounded-full bg-sidebar-accent" />
        {text}
      </h3>
    ) : null;

  // Sidebar-only tab look for the Level (City/County/State) and Chamber
  // groups — a flat segmented control (rounded-lg track, rounded-md
  // active cell), matching mndatacenter.org's own "moderate border-radius
  // on interactive elements." No border on the track itself: bg-panel-3
  // (the same recessed token AreaFilterList's sidebar variant uses for its
  // own list) supplies the grouping, and the active cell's own
  // TIER_HEADER_BG fill supplies the selection state — between the two, a
  // border line drew no information a resident couldn't already read from
  // the fill contrast. Rounded corners also stop the focus ring from
  // being clipped flush against a hard edge. Still role="group", not ARIA
  // tabs: picking a mode swaps map layers, zoom, and the checkbox/chamber
  // list below, not a same-panel tabpanel's content — this switcher isn't
  // "which tier of my representation to view" (that question lives
  // entirely in WardModal now, unconditionally, all three tiers at once —
  // see that file), it's "which layer is drawn on the map." Labeled with
  // its own "Map layer" heading below for exactly that reason: it used to
  // go unlabeled on the theory that it visually matched WardModal's own
  // unlabeled tablist, but that tablist is gone, and sharing the bare
  // words "City/County/State" with no heading read as the same question
  // asked twice in two panels — it's not.
  const sidebarTabRowClass = "flex gap-1 rounded-lg bg-panel-3 p-1";
  // hover:bg-sidebar-hover, not hover:bg-hover: this track's own bg-panel-3
  // fill is only 3 shades off --hover, so the generic token was nearly
  // invisible here — see --sidebar-hover's own comment in globals.css.
  const sidebarTabButtonClass = (active: boolean) =>
    `flex-1 min-h-11 rounded-md px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent ${
      active ? "" : "text-ink-3 hover:bg-sidebar-hover hover:text-ink"
    }`;

  // "Still loading" notice for County/State mode while the background
  // fetchSecondaryCivicData() request (commissioners/state-legislature —
  // see that function's own comment) is still in flight (issue #71).
  // `secondaryDataLoadingLabel` is `undefined` for "wards" (never gated on
  // this fetch) and for the two secondary modes once that fetch has
  // settled either way — see secondaryDataPending's own comment on why
  // success and failure both count as "settled" — so this collapses to
  // `null` well before any spinner could get stuck showing "loading"
  // forever, matching the honest-empty-state posture the rest of the app
  // uses for a missing feed (AGENTS.md §3.1) rather than inventing a new
  // stuck-loading failure mode. role="status" + aria-live="polite" (not a
  // stronger "alert" role) mirrors SearchBar's own transient-status
  // pattern — nothing has gone wrong, so nothing here should read as an
  // error. motion-safe:animate-spin keeps the actual spin off under
  // prefers-reduced-motion (AGENTS.md §4) while leaving the ring itself
  // visible, so the notice stays legible either way. Called with no
  // variant param, unlike filterSectionLabel above: the
  // copy and layout are identical in both the floating and sidebar flavor,
  // there's no branch to make.
  const secondaryDataLoadingLabel = SECONDARY_DATA_LOADING_LABEL[layerMode];
  const secondaryDataNotice =
    secondaryDataPending && secondaryDataLoadingLabel ? (
      <p role="status" aria-live="polite" className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-3">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3 shrink-0 motion-safe:animate-spin">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
          <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        {secondaryDataLoadingLabel}
      </p>
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
        {filterSectionLabel("floating", "Map layer")}
        <div role="group" aria-label="Choose map layer" className={filterGroupClass()}>
          {(["wards", "commissioners", "state-legislature"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => switchMode(mode)}
              // rowHoverClass/focusRingClass("floating") — shared with
              // AreaFilterList.tsx's own row/summary chrome (src/lib/
              // variantClasses.ts) rather than this file re-deriving the
              // same "floating uses --hover/--accent, sidebar uses
              // --sidebar-hover/--sidebar-accent" choice inline a second
              // time (this button and the Chamber one just below it used
              // to each hardcode the identical literal).
              className={`px-3 py-1.5 rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 ${focusRingClass("floating")} ${
                layerMode === mode ? "bg-accent text-on-accent" : `text-ink-3 hover:text-ink ${rowHoverClass("floating")}`
              }`}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
        </div>
        {secondaryDataNotice}
      </div>

      <div>
        {layerMode === "state-legislature" && filterSectionLabel("floating", "Chamber")}
        {layerMode === "state-legislature" ? (
          // A district doesn't cleanly belong to one Twin City, so this
          // level filters by chamber instead of the Minneapolis/St. Paul
          // checkboxes below — same toggle pattern as the mode switcher.
          <div role="group" aria-label="Choose chamber" className={filterGroupClass()}>
            {CHAMBERS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => switchChamber(c)}
                // See the Map layer buttons' own comment just above — same
                // shared rowHoverClass/focusRingClass("floating") pair.
                className={`px-3 py-1.5 rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 ${focusRingClass("floating")} ${
                  chamber === c ? "bg-accent text-on-accent" : `text-ink-3 hover:text-ink ${rowHoverClass("floating")}`
                }`}
              >
                {CHAMBER_LABELS[c]}
              </button>
            ))}
          </div>
        ) : (
          <AreaFilterList
            cities={MODE_VISIBLE_CITIES[layerMode]}
            visibleCities={visibleCities}
            labels={MODE_FILTER_LABELS[layerMode]}
            accents={CITY_ACCENT}
            variant="floating"
            grouped={layerMode === "wards"}
            query={areaFilterQuery}
            onQueryChange={setAreaFilterQuery}
            onToggleCity={toggleCity}
            onSetCitiesVisible={setCitiesVisible}
          />
        )}
      </div>
    </>
  );

  // Rendered as the first item inside the padded content column below
  // (see the left `<aside>`'s own comment) — inset with room for the
  // segmented control's own rounded corners, rather than the old
  // full-bleed placement flush against the header. Now carries its own
  // "Map layer" heading (see filterSectionLabel above and this block's
  // own comment on sidebarTabRowClass) — City/County/State by itself,
  // sitting directly above WardModal's own City/County/State section
  // headings on the other side of the screen, read as the same control
  // duplicated; "Map layer" makes it legible at a glance as "what's drawn"
  // rather than "which tier of my rep to show."
  const sidebarLevelTabs = (
    <div>
      <div className="mb-1.5">{filterSectionLabel("sidebar", "Map layer")}</div>
      <div role="group" aria-label="Choose map layer" className={sidebarTabRowClass}>
        {(["wards", "commissioners", "state-legislature"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => switchMode(mode)}
            className={sidebarTabButtonClass(layerMode === mode)}
            style={layerMode === mode ? { backgroundColor: TIER_HEADER_BG, color: TIER_HEADER_TEXT } : undefined}
          >
            {MODE_LABELS[mode]}
          </button>
        ))}
      </div>
      {secondaryDataNotice}
    </div>
  );

  // No card border around this group (a prior pass tried boxing it in
  // border-hair-strong; see git history) — mndatacenter.org's own filter
  // groups read as "contained" from generous vertical spacing and the
  // section label's accent tick (filterSectionLabel above) plus the
  // recessed fill under the tab row/checkbox list, not from a drawn
  // rectangle around the whole thing. The gap-5 on the padded content
  // column below does that spacing job between sections.
  const sidebarFilterControls = (
    <>
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          {filterSectionLabel("sidebar", layerMode === "state-legislature" ? "Chamber" : "Areas shown")}
        </div>
        {layerMode === "state-legislature" ? (
          <div role="group" aria-label="Choose chamber" className={sidebarTabRowClass}>
            {CHAMBERS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => switchChamber(c)}
                className={sidebarTabButtonClass(chamber === c)}
                style={chamber === c ? { backgroundColor: TIER_HEADER_BG, color: TIER_HEADER_TEXT } : undefined}
              >
                {CHAMBER_LABELS[c]}
              </button>
            ))}
          </div>
        ) : (
          <AreaFilterList
            cities={MODE_VISIBLE_CITIES[layerMode]}
            visibleCities={visibleCities}
            labels={MODE_FILTER_LABELS[layerMode]}
            accents={CITY_ACCENT}
            variant="sidebar"
            grouped={layerMode === "wards"}
            query={areaFilterQuery}
            onQueryChange={setAreaFilterQuery}
            onToggleCity={toggleCity}
            onSetCitiesVisible={setCitiesVisible}
          />
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
    <WardModal officials={selected.officials} onClose={deselect} hoveredCityName={selected.hoveredCityName} jumpToTier={selected.jumpToTier} selectionKey={selected.selectionKey} variant="sheet" />
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
          className={`hidden sm:flex shrink-0 flex-col overflow-x-hidden overflow-y-auto no-scrollbar bg-panel-2 font-sans transition-[width] duration-300 ease-out ${
            leftFiltersCollapsed
              ? "sm:w-0"
              : // bg-panel-2 (not the workspace's usual --panel): a full
                // step whiter than --canvas/--panel, so the sidebar reads
                // as its own surface against the map rather than nearly
                // the same gray. border-r-hair-strong does the same job
                // on the inner edge (the seam against the map). This used
                // to also carry a border-l-sidebar-edge-accent — a thin
                // Night Sky Blue frame on the outer (viewport) edge —
                // removed as part of the mndatacenter-style flattening
                // pass: a colored edge accent is exactly the kind of
                // decorative chrome that pass was stripping elsewhere
                // (the green Filters banner, the boxed county cards), so
                // leaving this one in place would have been inconsistent
                // with its own direction. globals.css's --sidebar-edge-
                // accent token was removed entirely in a later cleanup
                // pass once it had zero remaining usages.
                "sm:w-64 lg:w-72 border-r border-r-hair-strong"
          }`}
        >
          <div className="flex h-full w-64 shrink-0 flex-col lg:w-72">
            {/* Used to mirror WardModal's own title bar exactly —
                PANEL_HEADER_BG's brand-green fill, a 2xl/extrabold heading —
                so the two sidebars would read as one consistent panel
                chrome. That green is documented in globals.css as
                --positive, this codebase's "affirmative signal" color (used
                for things like a successful vote outcome); spending it on a
                full-bleed loud banner behind the word "Filters" made a
                plain section label read as a call-to-action instead. A
                second pass then de-loudened it to a flat neutral gray
                (bg-panel-3) instead. A third pass moved this onto `.band` —
                the same navy-field flag treatment SiteHeader.tsx's masthead
                uses.
                This is a fourth pass: "band-sub" — a dark neutral charcoal
                (globals.css's `.band-sub` token overrides), not the navy
                flag field. This header is subordinate to the one real
                masthead, not a second identity bar of its own, and giving
                it the same navy read as competing mastheads rather than one
                panel inside the app `.band-sub` mirrors the reference
                implementation's own split between `.band` (its masthead)
                and a separate `.band-sub` (its footer strip) rather than
                inventing a new gray. Water Blue stays as the icon accent —
                see `.band-sub`'s own comment in globals.css for the
                contrast math. Light-mode only by design (falls back to the
                workspace's own near-black in dark mode, same as `.band`).
                Still functionally the same "Filters" label, still not
                dismissible (no close button — only collapsible via the
                pull-tab outside it), still no border under the bar — the
                fill-to-bg-panel-2 color change below is already the
                seam. */}
            <div className="band-sub flex items-center gap-2 px-4 pt-2 pb-2 sm:pt-4 shrink-0 bg-panel text-ink">
              {/* bg-accent-soft, not an ad-hoc opacity modifier — this
                  codebase's own existing "accent at low opacity, for
                  badges/fills" token (globals.css), reused here instead of
                  inventing a one-off bg-accent/20. */}
              <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                <IconSliders />
              </span>
              <h2 className="text-sm font-semibold uppercase tracking-wide">Filters</h2>
            </div>
            {/* Level (City/County/State) now sits inside the padded
                content column as its own first item, rounded like the
                segmented control it is, instead of the old full-bleed
                square strip flush under the header (see
                sidebarTabRowClass's own comment for why). */}
            <div className="flex flex-1 flex-col gap-5 overflow-y-auto no-scrollbar px-4 py-5">
              {sidebarLevelTabs}
              {sidebarFilterControls}
            </div>
          </div>
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
            // hover:bg-sidebar-hover: this pull-tab sprouts visually from
            // the left sidebar (see the comment above), so it gets the
            // same stronger hover the sidebar's own rows/tabs use rather
            // than the generic --hover, which barely shows against its
            // bg-panel-2 fill.
            className="hidden sm:flex absolute left-0 top-1/2 z-20 h-12 w-6 -translate-y-1/2 items-center justify-center rounded-r-lg border border-l-0 border-hair-strong bg-panel-2 text-ink-3 transition-colors hover:bg-sidebar-hover hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent"
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
            // hover:bg-sidebar-hover — same reasoning as the left pull-tab
            // above.
            className="hidden sm:flex absolute right-0 top-1/2 z-20 h-12 w-6 -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 border-hair-strong bg-panel-2 text-ink-3 transition-colors hover:bg-sidebar-hover hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent"
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
          // see its own comment above. Used to also carry a flag-blue
          // accent on this sidebar's own outer (viewport-right) edge,
          // removed for the same reason the left one was.
          className={`hidden sm:flex shrink-0 flex-col overflow-x-hidden overflow-y-auto no-scrollbar bg-panel-2 font-sans transition-[width] duration-300 ease-out ${
            rightDetailCollapsed ? "sm:w-0" : "sm:w-80 lg:w-96 border-l border-l-hair-strong"
          }`}
        >
          <div className="flex h-full w-80 shrink-0 flex-col lg:w-96">
            {selected ? (
              <WardModal officials={selected.officials} onClose={deselect} hoveredCityName={selected.hoveredCityName} jumpToTier={selected.jumpToTier} selectionKey={selected.selectionKey} variant="sidebar" />
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
