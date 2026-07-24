"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { RepProperties } from "@/lib/types";
import { getUpcomingHearings } from "@/lib/hearings";
import { CITY_ACCENT, accentFor, accentSoftFor } from "@/lib/cityTheme";
import WardModal from "./WardModal";

// Matches the OpenFreeMap "Liberty" style used by the get-flocked project,
// for visual consistency across these MN civic-data map tools.
const LIBERTY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const WARDS_SOURCE_ID = "wards-source";
const WARDS_FILL_LAYER_ID = "wards-fill";
const WARDS_OUTLINE_LAYER_ID = "wards-outline";
const WARDS_LABEL_LAYER_ID = "wards-label";

const COMMISSIONERS_SOURCE_ID = "commissioners-source";
const COMMISSIONERS_FILL_LAYER_ID = "commissioners-fill";
const COMMISSIONERS_OUTLINE_LAYER_ID = "commissioners-outline";
const COMMISSIONERS_LABEL_LAYER_ID = "commissioners-label";

const CITIES = ["Minneapolis", "St. Paul"] as const;
type City = (typeof CITIES)[number];

// Wards and commissioner districts are two different government layers
// covering different areas (a county is a lot bigger than the city inside
// it) — showing both as overlapping fills at once would just be visual
// noise, so only one is ever on screen. Mayors are city-level, so they
// only make sense alongside wards.
type LayerMode = "wards" | "commissioners";

// Same city grouping/coloring either way, but a Hennepin County district
// covers plenty of suburbs "Minneapolis" doesn't literally describe — the
// checkbox label should say so.
const MODE_FILTER_LABELS: Record<LayerMode, Record<City, string>> = {
  wards: { Minneapolis: "Minneapolis", "St. Paul": "St. Paul" },
  commissioners: { Minneapolis: "Hennepin County", "St. Paul": "Ramsey County" },
};

// Two distinct hue families (cool for Minneapolis/Hennepin, warm for
// St. Paul/Ramsey) so the two sides read apart at a glance, cycled by
// ward/district number so adjoining areas land on visibly different shades.
const CITY_PALETTES: Record<City, string[]> = {
  Minneapolis: ["#93C5FD", "#67E8F9", "#7DD3FC", "#A5B4FC", "#5EEAD4", "#7DD3C0", "#38BDF8", "#A78BFA", "#38DED0", "#60A5FA", "#2DD4BF", "#818CF8", "#22D3EE"],
  "St. Paul": ["#FDBA74", "#FCA5A5", "#FDE68A", "#FB923C", "#F87171", "#FACC15", "#FB7185"],
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

function fillColorExpression(numberField: string): maplibregl.ExpressionSpecification {
  return [
    "case",
    ["==", ["get", "city"], "Minneapolis"],
    cityMatchExpression("Minneapolis", numberField),
    ["==", ["get", "city"], "St. Paul"],
    cityMatchExpression("St. Paul", numberField),
    "#e5e7eb",
  ] as unknown as maplibregl.ExpressionSpecification;
}

const WARD_FILL_COLOR_EXPRESSION = fillColorExpression("ward");
const COMMISSIONER_FILL_COLOR_EXPRESSION = fillColorExpression("district");

const TWIN_CITIES_CENTER: [number, number] = [-93.185, 44.955];
const DEFAULT_ZOOM = 10.4;
// How far around a point marker (mayor pin) to pad when "zooming to" it —
// there's no polygon to fitBounds to, so this fakes one.
const POINT_ZOOM_PADDING_DEGREES = 0.01;

interface SelectedRep {
  properties: RepProperties;
  pinned: boolean;
}

interface MayorMarker {
  marker: maplibregl.Marker;
  properties: RepProperties;
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
    district: p.district ?? null,
    repName: p.repName ?? null,
    repPhotoUrl: p.repPhotoUrl ?? null,
    repEmail: p.repEmail ?? null,
    repPhone: p.repPhone ?? null,
    officeRoom: p.officeRoom ?? null,
    profileUrl: p.profileUrl ?? null,
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

// A circular headshot "pin" for a mayor at City Hall — plain DOM rather
// than a symbol-layer icon, since clipping a photo to a circle with a
// colored ring is trivial in CSS and painful to pre-bake into a sprite.
//
// Two nested elements, not one: maplibregl.Marker positions its element by
// writing `transform: translate(...)` directly onto it on every render. The
// hover "pop" effect also wants to set `transform: scale(...)` — on the
// same element, that overwrites Marker's translate and the pin jumps to
// the map's untransformed top-left corner. Scaling the inner element
// instead leaves Marker's own transform on the outer one alone.
function createMayorMarkerElement(rep: RepProperties): HTMLDivElement {
  const accent = accentFor(rep.city);
  const outer = document.createElement("div");
  outer.setAttribute("role", "button");
  outer.setAttribute("aria-label", `${rep.city} Mayor ${rep.repName ?? ""}`);
  outer.style.cssText = "cursor: pointer;";

  const inner = document.createElement("div");
  inner.style.cssText = `
    width: 44px; height: 44px; border-radius: 9999px;
    border: 3px solid ${accent}; box-shadow: 0 2px 8px rgba(0,0,0,0.35);
    background: ${accentSoftFor(rep.city)}; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    transition: transform 0.15s ease; background-size: cover; background-position: center;
  `;
  outer.appendChild(inner);

  if (rep.repPhotoUrl) {
    const img = document.createElement("img");
    img.src = rep.repPhotoUrl;
    img.alt = rep.repName ?? "Mayor photo";
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
  // The untouched fetch results, kept around so a click can look up a
  // ward/district's true full geometry — see the comment on the click
  // handler for why queryRenderedFeatures's own geometry isn't good
  // enough for that.
  const wardsDataRef = useRef<FeatureCollection | null>(null);
  const commissionersDataRef = useRef<FeatureCollection | null>(null);
  const mayorMarkersRef = useRef<MayorMarker[]>([]);
  const [selected, setSelected] = useState<SelectedRep | null>(null);
  const selectedRef = useRef<SelectedRep | null>(null);
  const [layerMode, setLayerMode] = useState<LayerMode>("wards");
  const layerModeRef = useRef(layerMode);
  const [visibleCities, setVisibleCities] = useState<Record<City, boolean>>({
    Minneapolis: true,
    "St. Paul": true,
  });
  const visibleCitiesRef = useRef(visibleCities);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    visibleCitiesRef.current = visibleCities;
  }, [visibleCities]);

  useEffect(() => {
    layerModeRef.current = layerMode;
  }, [layerMode]);

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
    const bounds = mode === "wards" ? wardsBoundsRef.current : commissionersBoundsRef.current;
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
    }
    for (const { marker, properties } of mayorMarkersRef.current) {
      const visible = layerModeRef.current === "wards" && cities[properties.city as City];
      marker.getElement().style.display = visible ? "" : "none";
    }
  };

  const applyLayerMode = (mode: LayerMode) => {
    const map = mapRef.current;
    if (!map) return;
    const showWards = mode === "wards";
    for (const layerId of [WARDS_FILL_LAYER_ID, WARDS_OUTLINE_LAYER_ID, WARDS_LABEL_LAYER_ID]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", showWards ? "visible" : "none");
    }
    for (const layerId of [COMMISSIONERS_FILL_LAYER_ID, COMMISSIONERS_OUTLINE_LAYER_ID, COMMISSIONERS_LABEL_LAYER_ID]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", showWards ? "none" : "visible");
    }
    for (const { marker, properties } of mayorMarkersRef.current) {
      marker.getElement().style.display = showWards && visibleCitiesRef.current[properties.city as City] ? "" : "none";
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
      const [wardsRes, mayorsRes, commissionersRes] = await Promise.all([
        fetch("/wards.geojson", { cache: "no-store" }),
        fetch("/mayors.geojson", { cache: "no-store" }),
        fetch("/commissioners.geojson", { cache: "no-store" }),
      ]);
      const data: FeatureCollection = await wardsRes.json();
      const mayorsData: FeatureCollection = await mayorsRes.json();
      const commissionersData: FeatureCollection = await commissionersRes.json();
      wardsDataRef.current = data;
      commissionersDataRef.current = commissionersData;

      // Guards the whole "add sources/layers/markers" block as a unit —
      // without it, a second 'load' firing would duplicate every mayor
      // marker on top of itself (Marker instances aren't deduped the way
      // map.addSource/addLayer already are below).
      if (map.getSource(WARDS_SOURCE_ID)) return;

      for (const feature of mayorsData.features) {
        if (feature.geometry.type !== "Point") continue;
        const properties = feature.properties as RepProperties;
        const [lng, lat] = feature.geometry.coordinates as [number, number];
        const el = createMayorMarkerElement(properties);
        const marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([lng, lat]).addTo(map);

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
          zoomToBounds(boundsAroundPoint(lng, lat));
        });

        mayorMarkersRef.current.push({ marker, properties });
      }

      map.addSource(WARDS_SOURCE_ID, { type: "geojson", data });
      map.addSource(COMMISSIONERS_SOURCE_ID, { type: "geojson", data: commissionersData });

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
      map.addLayer({
        id: WARDS_LABEL_LAYER_ID,
        type: "symbol",
        source: WARDS_SOURCE_ID,
        layout: {
          "text-field": ["concat", "Ward ", ["to-string", ["get", "ward"]]],
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

      // Registered here, after both fill layers exist, rather than
      // synchronously at effect setup — map.on(event, layerId, handler) is
      // itself a layer-scoped query, and MapLibre throws the same "layer
      // does not exist" error queryRenderedFeatures does if the mouse moves
      // over the canvas before the target layer has been added.
      map.on("mousemove", WARDS_FILL_LAYER_ID, handleHoverMove);
      map.on("mouseleave", WARDS_FILL_LAYER_ID, handleHoverLeave);
      map.on("mousemove", COMMISSIONERS_FILL_LAYER_ID, handleHoverMove);
      map.on("mouseleave", COMMISSIONERS_FILL_LAYER_ID, handleHoverLeave);

      applyCityFilter(visibleCitiesRef.current);

      // Fit the map to each layer's actual extent rather than a hardcoded
      // bounding box, so this keeps working if boundaries shift. Stored so
      // clicking away (or switching modes) can fly back to the right view
      // — commissioner districts reach well past the wards' extent, out
      // into the surrounding suburbs.
      const wardsBounds = boundsFromFeatureCollection(data);
      const commissionersBounds = boundsFromFeatureCollection(commissionersData);
      if (!wardsBounds.isEmpty()) wardsBoundsRef.current = wardsBounds;
      if (!commissionersBounds.isEmpty()) commissionersBoundsRef.current = commissionersBounds;
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
      const queryableLayers = [WARDS_FILL_LAYER_ID, COMMISSIONERS_FILL_LAYER_ID].filter((id) =>
        map.getLayer(id),
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
      const isCommissioner = hit.layer.id === COMMISSIONERS_FILL_LAYER_ID;
      const sourceData = isCommissioner ? commissionersDataRef.current : wardsDataRef.current;
      const fullFeature = sourceData?.features.find((f) =>
        isCommissioner
          ? f.properties?.county === hitProps.county && f.properties?.district === hitProps.district
          : f.properties?.city === hitProps.city && f.properties?.ward === hitProps.ward,
      );
      zoomToBounds(boundsFromFeature((fullFeature ?? hit) as Feature<Geometry>));
    });

    const handleResize = () => map.resize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      for (const { marker } of mayorMarkersRef.current) marker.remove();
      mayorMarkersRef.current = [];
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

      <div className="absolute left-3 top-3 z-20 flex flex-col gap-2 font-sans">
        <div
          role="group"
          aria-label="Choose map layer"
          className="flex rounded-lg bg-white/90 backdrop-blur-sm border border-neutral-200 shadow-lg p-1 text-sm"
        >
          {(["wards", "commissioners"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => switchMode(mode)}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                layerMode === mode ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {mode === "wards" ? "Council & Mayors" : "County Commissioners"}
            </button>
          ))}
        </div>

        <div
          role="group"
          aria-label="Filter by area"
          className="rounded-lg bg-white/90 backdrop-blur-sm border border-neutral-200 shadow-lg divide-y divide-neutral-100 text-sm text-neutral-700"
        >
          {CITIES.map((city) => (
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
      </div>

      {selected && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center pointer-events-none pb-[env(safe-area-inset-bottom)] sm:inset-x-auto sm:justify-start sm:left-4 sm:bottom-4 sm:pb-0">
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
