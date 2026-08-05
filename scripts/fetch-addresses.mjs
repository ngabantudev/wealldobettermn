#!/usr/bin/env node
// Builds the on-device address/ZIP gazetteer that powers the search bar's
// street-address and ZIP lookups (src/lib/addressSearch.ts) — the entire
// implementation of AGENTS.md §2.5's "static index shipped with the app."
// No geocoding ever happens at runtime; this script does all of it once,
// offline, from free/public-domain US Census TIGER/Line data — the same
// address-range data the Census Bureau's own online geocoder is built on
// (house number + parity matched into the correct range on a street
// segment, then interpolated along its line geometry).
//
// Must run *after* `npm run data:wards` — it reads public/wards.geojson
// to compute, once here rather than in the browser, which ward(s) each
// address range falls inside. That's the key design choice: ward
// *identity* is decided entirely in this script (see computeWardCandidates
// below); the client only ever does house-number arithmetic against the
// precomputed result. See src/lib/types.ts's AddressEdge comment for why.
//
// City/county search need no data from here at all — city search reads
// wards.geojson directly, county search uses the hardcoded COUNTY_CITIES
// table in src/lib/cities.ts (wards.geojson carries no county field).

import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import shp from "shpjs";
import { normalizeStreetName } from "../src/lib/streetNormalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "../public/address-index.json");
const WARDS_PATH = path.join(__dirname, "../public/wards.geojson");

// TIGER/Line "Address Range Feature" files, one zipped shapefile per
// county, free and public domain (US federal government work), no API
// key. These three counties cover every city this app maps.
const COUNTIES = [
  {
    name: "Hennepin County, MN",
    fips: "27053",
    url: "https://www2.census.gov/geo/tiger/TIGER2024/ADDRFEAT/tl_2024_27053_addrfeat.zip",
  },
  {
    name: "Ramsey County, MN",
    fips: "27123",
    url: "https://www2.census.gov/geo/tiger/TIGER2024/ADDRFEAT/tl_2024_27123_addrfeat.zip",
  },
  {
    name: "Anoka County, MN",
    fips: "27003",
    url: "https://www2.census.gov/geo/tiger/TIGER2024/ADDRFEAT/tl_2024_27003_addrfeat.zip",
  },
];

// Degrees of padding around *each ward's own* bounding box (not one
// combined box spanning every mapped city — see the comment on
// loadWardIndex for why that distinction matters a lot for output size)
// for the cheap prefilter below. Generous enough to catch a few streets
// just outside a ward boundary (so "found the street, but it's outside
// our coverage" is a real, honest outcome, not just "no such street"),
// tight enough to not pull in unrelated cities' entire street networks.
// Real ward-boundary correctness never depends on this value — that
// comes entirely from the per-vertex point-in-polygon test in
// computeWardCandidates() — so this can only ever under- or over-include
// nearby streets, never cause a *wrong* ward match.
const BBOX_PADDING_DEGREES = 0.015; // roughly 1-1.5km at this latitude

// census.gov's edge WAF was observed returning a 200 OK "Request
// Rejected" HTML page (not a real 4xx/5xx) for one specific county's
// bare URL while the identical file served fine both via its own
// directory listing and via every other county's URL — a stale
// cache/rule keyed on the exact path, not an actual access restriction
// (the data is public with no auth). A fixed, non-random query string
// sidesteps that without making the fetch non-deterministic.
function withCacheBust(url) {
  return `${url}?src=mn-civic-watch-etl`;
}

async function fetchZip(url) {
  const res = await fetch(withCacheBust(url), { headers: { "User-Agent": "mn-civic-map-etl/0.1" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  // Belt-and-suspenders: confirm we actually got zip bytes (PK magic
  // number) rather than another WAF rejection page slipping through as
  // a 200 — fail loudly instead of feeding shpjs garbage.
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error(`Response for ${url} doesn't look like a zip file (got ${buffer.length} byte(s))`);
  }
  return buffer;
}

function ringBBox(points) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, minLat, maxLng, maxLat };
}

function unionBBox(a, b) {
  return {
    minLng: Math.min(a.minLng, b.minLng),
    minLat: Math.min(a.minLat, b.minLat),
    maxLng: Math.max(a.maxLng, b.maxLng),
    maxLat: Math.max(a.maxLat, b.maxLat),
  };
}

function bboxContainsPoint(bbox, [lng, lat]) {
  return lng >= bbox.minLng && lng <= bbox.maxLng && lat >= bbox.minLat && lat <= bbox.maxLat;
}

function bboxIntersects(a, b) {
  return a.minLng <= b.maxLng && a.maxLng >= b.minLng && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}

// Standard ray-casting point-in-ring test.
function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

// A point is inside a polygon if it's inside the outer ring (rings[0])
// and not inside any hole ring (rings[1+]) — assumes holes don't nest
// inside each other, true for every ward/city boundary this app draws.
function pointInPolygonCoords(point, rings) {
  if (!pointInRing(point, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(point, rings[i])) return false;
  }
  return true;
}

function pointInGeometry(point, geometry) {
  if (geometry.type === "Polygon") return pointInPolygonCoords(point, geometry.coordinates);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.some((rings) => pointInPolygonCoords(point, rings));
  return false;
}

function bufferBBox(bbox, degrees) {
  return {
    minLng: bbox.minLng - degrees,
    minLat: bbox.minLat - degrees,
    maxLng: bbox.maxLng + degrees,
    maxLat: bbox.maxLat + degrees,
  };
}

// The app's 10 cities are spread across the whole metro (Plymouth in the
// northwest down to Richfield in the south, over to St. Paul, up to
// Blaine/Coon Rapids in the north) — a *single* bounding box around all
// of them would be a huge rectangle that also swallows every uncovered
// city in between (Edina, Golden Valley, Roseville, Eden Prairie, ...),
// barely filtering anything. Each ward keeps its own (buffered) bbox
// instead, so "is this edge near a ward we actually cover" means near
// *some* real ward, not merely inside the metro-wide envelope of all of
// them combined.
function loadWardIndex(wardsGeojson) {
  const wards = [];
  for (const feature of wardsGeojson.features) {
    if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") continue;
    const rings = feature.geometry.type === "Polygon" ? feature.geometry.coordinates : feature.geometry.coordinates.flat();
    const bbox = rings.reduce((acc, ring) => (acc ? unionBBox(acc, ringBBox(ring)) : ringBBox(ring)), null);
    const ref = { city: feature.properties.city, ward: feature.properties.ward };
    wards.push({ ref, geometry: feature.geometry, bbox, prefilterBBox: bufferBBox(bbox, BBOX_PADDING_DEGREES) });
  }
  return wards;
}

// Narrows to wards whose bbox could plausibly contain this edge before
// doing the expensive per-vertex ring walk — with 56 ward polygons this
// keeps the full point-in-polygon test limited to the handful that are
// actually nearby, not all of them, for every one of tens of thousands
// of edges.
function computeWardCandidates(coords, edgeBBox, wardIndex) {
  const nearby = wardIndex.filter((w) => bboxIntersects(w.bbox, edgeBBox));
  const found = new Map(); // "city|ward" -> WardRef
  for (const point of coords) {
    for (const w of nearby) {
      const key = `${w.ref.city}|${w.ref.ward}`;
      if (found.has(key)) continue; // already matched via an earlier vertex
      if (!bboxContainsPoint(w.bbox, point)) continue;
      if (pointInGeometry(point, w.geometry)) found.set(key, w.ref);
    }
  }
  return [...found.values()];
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

function normalizeHouseNumber(raw) {
  return raw && raw.trim() !== "" ? raw.trim() : null;
}

function normalizeParity(raw) {
  return raw === "O" || raw === "E" || raw === "B" ? raw : null;
}

function normalizeZip(raw) {
  return raw && /^\d{5}$/.test(raw.trim()) ? raw.trim() : null;
}

async function main() {
  console.log("[addresses] reading ward boundaries...");
  let wardsGeojson;
  try {
    wardsGeojson = JSON.parse(await readFile(WARDS_PATH, "utf8"));
  } catch (err) {
    throw new Error(`Couldn't read ${WARDS_PATH} — run "npm run data:wards" first. (${err.message})`);
  }
  const wardIndex = loadWardIndex(wardsGeojson);
  console.log(`[addresses] ${wardIndex.length} ward polygon(s) loaded`);

  const streets = {};
  const zipWards = {}; // zip -> Map("city|ward" -> WardRef)

  for (const county of COUNTIES) {
    console.log(`[addresses] fetching ${county.name}...`);
    const zipBuffer = await fetchZip(county.url);
    console.log(`[addresses] parsing ${county.name}...`);
    const geojson = await shp(zipBuffer);
    const fc = Array.isArray(geojson) ? geojson[0] : geojson;
    console.log(`[addresses] ${county.name}: ${fc.features.length} raw edge(s)`);

    let kept = 0;
    for (const feature of fc.features) {
      if (feature.geometry.type !== "LineString") continue;
      const coords = feature.geometry.coordinates;
      const edgeBBox = ringBBox(coords);
      if (!wardIndex.some((w) => bboxIntersects(edgeBBox, w.prefilterBBox))) continue;

      const props = feature.properties;
      const fullname = (props.FULLNAME ?? "").trim();
      const lfromhn = normalizeHouseNumber(props.LFROMHN);
      const ltohn = normalizeHouseNumber(props.LTOHN);
      const rfromhn = normalizeHouseNumber(props.RFROMHN);
      const rtohn = normalizeHouseNumber(props.RTOHN);
      // Unnamed edges (alleys, waterway-adjacent slivers) and edges with
      // no address range on either side can never be a search match —
      // dropping them here is most of this script's size reduction.
      if (!fullname) continue;
      if (!lfromhn && !ltohn && !rfromhn && !rtohn) continue;

      const wardCandidates = computeWardCandidates(coords, edgeBBox, wardIndex);
      // A zoom/pin target only ever matters for an edge that resolved
      // into at least one covered ward — an edge kept purely for the
      // honest "found the street, but outside our coverage" case never
      // needs geometry at all. And even for a covered edge, the two
      // endpoints are enough for the linear interpolation
      // addressSearch.ts does (house-number position along the block) —
      // MN's urban block faces are close enough to straight that the
      // ~5-vertex TIGER polyline's intermediate points buy negligible
      // precision at ward-zoom scale, for real size cost across tens of
      // thousands of edges.
      const coordsOut =
        wardCandidates.length > 0
          ? [coords[0], coords[coords.length - 1]].map(([lng, lat]) => [round6(lng), round6(lat)])
          : [];

      const edge = {
        tlid: props.TLID,
        coords: coordsOut,
        lfromhn,
        ltohn,
        rfromhn,
        rtohn,
        parityL: normalizeParity(props.PARITYL),
        parityR: normalizeParity(props.PARITYR),
        zipl: normalizeZip(props.ZIPL),
        zipr: normalizeZip(props.ZIPR),
        wardCandidates,
      };

      const key = normalizeStreetName(fullname);
      (streets[key] ??= []).push(edge);

      for (const zip of [edge.zipl, edge.zipr]) {
        if (!zip) continue;
        const bucket = (zipWards[zip] ??= new Map());
        for (const ref of wardCandidates) bucket.set(`${ref.city}|${ref.ward}`, ref);
      }

      kept++;
    }
    console.log(`[addresses] ${county.name}: kept ${kept} edge(s) with a name and address range`);
  }

  const zips = Object.fromEntries(Object.entries(zipWards).map(([zip, wardMap]) => [zip, [...wardMap.values()]]));

  const index = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString().slice(0, 10),
    sourceCounties: COUNTIES,
    streets,
    zips,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(index));
  console.log(
    `[done] wrote ${Object.keys(streets).length} street name(s), ${Object.keys(zips).length} zip(s) to ${OUTPUT_PATH}`,
  );
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
