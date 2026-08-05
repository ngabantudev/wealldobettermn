"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { AddressIndex, MnPlaces, RepProperties, WardRef } from "@/lib/types";
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
import SearchBar from "./SearchBar";
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
  // The in-flight/settled fetchCivicData() call — a ref (not state)
  // because the map-setup effect below needs to `await` this exact
  // promise instance rather than re-fetch, and refs (unlike state) are
  // readable synchronously the moment the effect that set them has run.
  const civicDataPromiseRef = useRef<Promise<CivicData | null> | null>(null);
  const [addressIndex, setAddressIndex] = useState<AddressIndex | null>(null);
  const [mnPlaces, setMnPlaces] = useState<MnPlaces | null>(null);
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

  // Map-independent: runs regardless of whether MapLibre ever
  // successfully constructs. See fetchCivicData's comment for why this
  // is its own effect rather than living inside map.on("load").
  useEffect(() => {
    const promise = fetchCivicData();
    civicDataPromiseRef.current = promise;
    promise.then((data) => {
      if (!data) return;
      wardsDataRef.current = data.wards;
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
    // The modal sits bottom-left (a bottom sheet on mobile), so padding is
    // reserved on that side — otherwise fitBounds centers the target in
    // the *full* viewport and the modal ends up covering it.
    map.fitBounds(bounds, {
      padding: isMobileViewport() ? { top: 60, bottom: 260, left: 40, right: 40 } : { top: 80, bottom: 300, left: 420, right: 80 },
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
    setSelected({ properties: normalizeRepProperties(feature.properties), pinned: true });
    zoomToBounds(boundsFromFeature(feature as Feature<Geometry>));
  };

  const applyCityZoom = (city: City) => {
    prepareWardsView(city);
    const cityWards = wardsDataRef.current?.features.filter((f) => f.properties?.city === city);
    if (!cityWards || cityWards.length === 0) return;
    setSelected(null);
    zoomToBoundsNoModal(boundsFromFeatureCollection({ type: "FeatureCollection", features: cityWards }));
  };

  const applyCountyZoom = (cities: City[]) => {
    for (const city of cities) prepareWardsView(city);
    const citySet = new Set<City>(cities);
    const countyWards = wardsDataRef.current?.features.filter((f) => citySet.has(f.properties?.city as City));
    if (!countyWards || countyWards.length === 0) return;
    setSelected(null);
    zoomToBoundsNoModal(boundsFromFeatureCollection({ type: "FeatureCollection", features: countyWards }));
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

      // Awaits the *same* fetch the map-independent effect above kicked
      // off on mount, rather than fetching a second time — that effect
      // is also what populates wardsDataRef/commissionersDataRef/
      // stateLegDataRef, so search can use them even if this "load"
      // event never fires at all.
      const civicData = await civicDataPromiseRef.current;
      if (!civicData) return; // fetch failed — nothing to draw; already logged in fetchCivicData
      const { wards: data, mayors: mayorsData, commissioners: commissionersData, stateLeg: stateLegData } = civicData;

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
      ) => {
        const el = createRepPinElement(properties, diameter);
        const marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(coordinates).addTo(map);

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

      // Initial camera fit only — wardsBoundsRef/commissionersBoundsRef/
      // stateLegBoundsRef (used by zoomToDefault) are already populated
      // by the map-independent effect above, from the same data. Fit to
      // each layer's actual extent rather than a hardcoded bounding box,
      // so this keeps working if boundaries shift.
      const wardsBounds = boundsFromFeatureCollection(data);
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

  // Defined once, referenced from both the desktop and mobile branches
  // below — each usage still mounts its own independent SearchBar
  // instance (React treats the two JSX positions as separate component
  // instances regardless of sharing this element description), so this
  // is purely to keep the props in one place rather than duplicating
  // four lines of callbacks that need to stay in sync.
  const searchBar = (
    <SearchBar
      index={addressIndex}
      allPlaces={mnPlaces}
      onSelectWard={applySearchResult}
      onSelectCity={applyCityZoom}
      onSelectCounty={(_county, cities) => applyCountyZoom(cities)}
    />
  );

  // z-index scale for this component's stacked layers (lowest to highest
  // — each number below is the *only* place its value should be set; if a
  // new layer is ever added, give it its own rung rather than reusing one
  // of these):
  //   0  — the map: canvas + every pin marker (mayors, council members,
  //        commissioners, state legislators). `isolate` on the map
  //        container div below is load-bearing, not decorative: pin
  //        elements get an inline z-index of their own (see
  //        createRepPinElement's comment) so a Mayor pin can render over
  //        a Council Member pin it overlaps. Without `isolate`, that
  //        inline z-index (up to 52) doesn't stay contained —
  //        position:absolute with no z-index does NOT create a new
  //        stacking context, so the pins' z-index was being compared
  //        directly against the z-20/z-10 layers below at the root level
  //        and winning, painting map pins over the search bar and the
  //        ward modal. `isolate` forces the map div to own a stacking
  //        context, so "highest z-index" pins only ever mean "highest
  //        among pins."
  //   10 — the desktop-only ward modal (bottom-left). Sits above the map
  //        but below every persistent control, so a search can still be
  //        started while a modal is open.
  //   20 — every always-reachable control surface: the top-left mode/
  //        filter stack, the desktop top-center search bar, and the
  //        mobile bottom-docked search+modal stack. These three never
  //        occupy the same screen space at the same breakpoint, so
  //        sharing one z-index is fine — the mobile stack folding the
  //        modal in at z-20 (rather than 10) is intentional too, since on
  //        mobile it's stacked *with* search rather than competing with
  //        it. Per AGENTS.md §4 ("Search Is The Primary Interface, Not
  //        The Map"), this rung is reserved for controls a user always
  //        needs reachable regardless of what's selected on the map.
  return (
    <div className="relative w-full h-dvh overflow-hidden">
      <div ref={mapContainerRef} className="absolute inset-0 w-full h-full isolate z-0" />

      {/* Mode switcher + city/chamber filter — always top-left, on every
          screen size. Search moved out to its own placement below: center-
          top on desktop, bottom-docked on mobile (see AGENTS.md Part 4 —
          "Search Is The Primary Interface"). */}
      <div className="absolute left-3 top-3 z-20 flex flex-col gap-2 font-sans">
        <div
          role="group"
          aria-label="Choose map layer"
          className="flex rounded-lg bg-white/90 backdrop-blur-sm border border-neutral-200 shadow-lg p-1 text-sm"
        >
          {(["wards", "commissioners", "state-legislature"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => switchMode(mode)}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                layerMode === mode ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
        </div>

        {layerMode === "state-legislature" ? (
          // A district doesn't cleanly belong to one Twin City, so this
          // level filters by chamber instead of the Minneapolis/St. Paul
          // checkboxes below — same toggle pattern as the mode switcher.
          <div
            role="group"
            aria-label="Choose chamber"
            className="flex rounded-lg bg-white/90 backdrop-blur-sm border border-neutral-200 shadow-lg p-1 text-sm"
          >
            {CHAMBERS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => switchChamber(c)}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  chamber === c ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                {CHAMBER_LABELS[c]}
              </button>
            ))}
          </div>
        ) : (
          <div
            role="group"
            aria-label="Filter by area"
            // Capped height + internal scroll: with all 10 cities checked
            // this list runs ~400px+ tall, and on mobile — where the
            // search bar and (if open) the ward modal now dock along the
            // bottom edge instead of sharing this same top-left column —
            // nothing else pushes it out of the way anymore. Without a
            // cap, a tall modal can pull that bottom stack's top edge up
            // far enough to collide with this list. The cap is small
            // enough to matter only on short mobile viewports; it's
            // harmless — never actually engaged — on desktop.
            className="max-h-[45vh] overflow-y-auto rounded-lg bg-white/90 backdrop-blur-sm border border-neutral-200 shadow-lg divide-y divide-neutral-100 text-sm text-neutral-700"
          >
            {MODE_VISIBLE_CITIES[layerMode].map((city) => (
              <label key={city} className="flex items-center gap-2 px-3 py-2.5 sm:py-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={visibleCities[city]}
                  onChange={() => toggleCity(city)}
                  className="cursor-pointer"
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

      {/* Desktop (sm+): search bar floats centered at the top of the map,
          independent of the mode-switcher stack — the primary interface
          gets the primary position, not a corner. */}
      <div className="hidden sm:flex absolute inset-x-0 top-3 z-20 justify-center px-4 pointer-events-none">
        <div className="pointer-events-auto">{searchBar}</div>
      </div>

      {/* Mobile: search bar and (if open) the ward modal share one
          bottom-docked stack, search on top — both are bottom sheets on
          this breakpoint, and stacking them in the same flex column is
          what keeps them from literally overlapping each other, rather
          than each independently anchoring to the screen's bottom edge. */}
      <div className="sm:hidden absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 px-3 pb-[env(safe-area-inset-bottom)] pointer-events-none">
        <div className="pointer-events-auto w-full flex justify-center">{searchBar}</div>
        {selected && (
          <div className="pointer-events-auto w-full flex justify-center">
            <WardModal ward={selected.properties} pinned={selected.pinned} onClose={deselect} />
          </div>
        )}
      </div>

      {/* Desktop (sm+): modal keeps its existing bottom-left placement,
          separate from the top-center search bar above. WardModal has no
          internal state (pure function of props), so mounting it here in
          addition to the mobile branch above is safe — never a second,
          desynced copy of anything the user typed. */}
      {selected && (
        <div className="hidden sm:flex absolute z-10 left-4 bottom-4 pointer-events-none">
          <div className="pointer-events-auto">
            <WardModal ward={selected.properties} pinned={selected.pinned} onClose={deselect} />
          </div>
        </div>
      )}
    </div>
  );
}
