// Pure resolution logic for the search bar — no DOM/MapLibre import, same
// shape as hearings.ts (deterministic functions over plain data, wired up
// by WardMap.tsx). This is the client-side half of AGENTS.md §2.5's
// on-device gazetteer; scripts/fetch-addresses.mjs is the build-time half.
//
// The one rule everything here is built around: ward *identity* is never
// decided here. It was already decided once, offline, in
// scripts/fetch-addresses.mjs (see AddressEdge.wardCandidates in
// src/lib/types.ts). Resolution below is house-number arithmetic and
// plain string matching only — no point-in-polygon math ships to the
// browser, and nothing here ever silently picks one ward when more than
// one candidate is on the table.

import type { AddressEdge, AddressIndex, MnPlaces, WardRef } from "./types";
import { CITIES, COUNTIES, COUNTY_CITIES, type City, type County } from "./cities";
import { normalizeStreetName } from "./streetNormalize.mjs";

export { normalizeStreetName };

export type ParsedQuery =
  | { kind: "zip"; zip: string }
  | { kind: "city"; city: City }
  | { kind: "county"; county: County }
  // A real Minnesota city or county name (from public/mn-places.json) that
  // isn't one of the ones this app has ward/commissioner data for — see
  // the "not-covered" SearchOutcome this maps to in resolve() below.
  // Deliberately its own kind rather than folded into "unparseable": the
  // whole point is telling "we don't understand you" apart from "we
  // understood you perfectly, we just don't have that place yet."
  | { kind: "uncovered-place"; name: string; placeType: "city" | "county" }
  | { kind: "address"; houseNumber: number; street: string; cityHint: City | null; zipHint: string | null }
  | { kind: "unparseable" };

export type SearchOutcome =
  // Exactly one ward — the caller auto-selects it, same as a real click.
  | { status: "single"; wards: [WardRef]; point: [number, number] | null }
  // 2+ candidate wards — never auto-picked; the caller must show all of them.
  | { status: "ambiguous"; wards: WardRef[]; reason: string }
  // Resolves to a whole city (not one ward) — the caller expands this
  // against live ward data, since addressSearch.ts never touches that.
  | { status: "city"; city: City }
  | { status: "county"; county: County; cities: City[] }
  // Parsed as a real street/ZIP shape, and that street/ZIP exists in the
  // data, but every match falls outside every ward this app covers. Also
  // covers a real MN city/county name this app just doesn't map yet.
  | { status: "not-covered"; reason: string }
  // Parsed as a real street/ZIP shape, but nothing in the data matches at
  // all (unknown street, or a house number outside any range on file).
  | { status: "not-found"; reason: string }
  // Didn't parse as anything recognizable — never falls through to a guess.
  | { status: "unparseable" };

// A person might type "Saint Paul" or "St Paul" for what CITIES spells
// "St. Paul" — fold punctuation/case away and accept a couple of common
// spellings, rather than growing CITIES itself into a matching table.
function fold(s: string): string {
  return s
    .toUpperCase()
    .replace(/\bSAINT\b/g, "ST")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const FOLDED_CITIES = new Map(CITIES.map((c) => [fold(c), c]));
const FOLDED_COUNTIES = new Map(COUNTIES.map((c) => [fold(c), c]));

const ZIP_RE = /\b(\d{5})(?:-\d{4})?\s*$/;
const MN_SUFFIX_RE = /,?\s*(MN|MINNESOTA)\s*$/i;
const UNIT_RE = /\b(apt|unit|ste|suite|#)\.?\s*\S+\s*$/i;
const ADDRESS_RE = /^(\d+)[A-Za-z]?\s+(.+)$/;

/**
 * Classifies free-text search input. Applied to a trimmed, whitespace-
 * collapsed copy of what the resident typed — never logged, never thrown
 * into an error, never written anywhere but the search input's own live
 * React state (see SearchBar.tsx).
 *
 * `allPlaces` is the full MN gazetteer (public/mn-places.json) — optional
 * and nullable because it loads asynchronously (see WardMap.tsx) and
 * because covered-city/-county recognition above never needed it anyway.
 * Passing it in only widens what counts as "recognized" (adding the
 * "uncovered-place" kind below); omitting it never changes a covered
 * city/county/address/ZIP result, it just means an uncovered MN place
 * falls through to "unparseable" instead of the more honest "not-covered."
 */
export function parseQuery(raw: string, allPlaces?: MnPlaces | null): ParsedQuery {
  let s = raw.trim().replace(/\s+/g, " ");
  if (!s) return { kind: "unparseable" };

  let zipHint: string | null = null;
  const zipMatch = s.match(ZIP_RE);
  if (zipMatch) {
    zipHint = zipMatch[1];
    s = s.slice(0, zipMatch.index).trim().replace(/,\s*$/, "");
  }

  let cityHint: City | null = null;
  for (const [folded, city] of FOLDED_CITIES) {
    const re = new RegExp(`,?\\s*${folded}\\s*$`, "i");
    if (fold(s).endsWith(folded) && re.test(s)) {
      cityHint = city;
      s = s.replace(re, "").trim();
      break;
    }
  }

  s = s.replace(MN_SUFFIX_RE, "").trim();
  s = s.replace(UNIT_RE, "").trim(); // units never affect ward, so this is safe to drop pre-classification

  // A bare ZIP, city, or county can still be typed with no leading
  // house-number text at all — check the untouched original before
  // falling through to the address shape below.
  if (!s && zipHint) return { kind: "zip", zip: zipHint };

  if (/^\d{5}$/.test(s)) return { kind: "zip", zip: s };

  const foldedWhole = fold(s);
  if (FOLDED_CITIES.has(foldedWhole)) return { kind: "city", city: FOLDED_CITIES.get(foldedWhole)! };
  const foldedCounty = foldedWhole.replace(/\bCOUNTY\b/, "").trim();
  if (FOLDED_COUNTIES.has(foldedCounty)) return { kind: "county", county: FOLDED_COUNTIES.get(foldedCounty)! };

  // Not one of the cities/counties this app covers — check whether it's a
  // *real* Minnesota place anyway before giving up. Linear scans over
  // allPlaces (854 cities + 87 counties) rather than precomputed Maps like
  // FOLDED_CITIES/FOLDED_COUNTIES above, since allPlaces is loaded async
  // and can't be folded once at module scope the way the small, static
  // CITIES/COUNTIES consts are.
  if (allPlaces) {
    const cityMatch = allPlaces.cities.find((c) => fold(c) === foldedWhole);
    if (cityMatch) return { kind: "uncovered-place", name: cityMatch, placeType: "city" };
    const countyMatch = allPlaces.counties.find((c) => fold(c) === foldedCounty);
    if (countyMatch) return { kind: "uncovered-place", name: countyMatch, placeType: "county" };
  }

  const addressMatch = s.match(ADDRESS_RE);
  if (addressMatch) {
    const houseNumber = parseInt(addressMatch[1], 10);
    if (Number.isFinite(houseNumber)) {
      return { kind: "address", houseNumber, street: normalizeStreetName(addressMatch[2]), cityHint, zipHint };
    }
  }

  return { kind: "unparseable" };
}

/** Local-only prefix match over indexed street names, for live typeahead. */
export function suggestStreets(index: AddressIndex, partial: string, limit: number): string[] {
  const prefix = normalizeStreetName(partial);
  if (!prefix) return [];
  const matches: string[] = [];
  for (const street of Object.keys(index.streets)) {
    if (street.startsWith(prefix)) matches.push(street);
    if (matches.length >= limit) break;
  }
  return matches.sort();
}

function parseHouseNumber(raw: string | null): number | null {
  if (!raw) return null;
  const digits = raw.match(/\d+/)?.[0];
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

function matchesParity(houseNumber: number, parity: "O" | "E" | "B" | null): boolean {
  if (parity === null || parity === "B") return true;
  const isEven = houseNumber % 2 === 0;
  return parity === "E" ? isEven : !isEven;
}

function inRange(houseNumber: number, fromRaw: string | null, toRaw: string | null): boolean {
  const from = parseHouseNumber(fromRaw);
  const to = parseHouseNumber(toRaw);
  if (from === null || to === null) return false;
  return houseNumber >= Math.min(from, to) && houseNumber <= Math.max(from, to);
}

// Cosmetic only — approximates where along a block face a house number
// falls, for map-zoom/pin precision. Never consulted for ward identity.
export function interpolateAlongLine(coords: [number, number][], fraction: number): [number, number] | null {
  if (coords.length === 0) return null;
  if (coords.length === 1) return coords[0];
  const clamped = Math.max(0, Math.min(1, fraction));
  const [lng0, lat0] = coords[0];
  const [lng1, lat1] = coords[coords.length - 1];
  return [lng0 + (lng1 - lng0) * clamped, lat0 + (lat1 - lat0) * clamped];
}

function matchingSideFraction(houseNumber: number, edge: AddressEdge): number | null {
  if (inRange(houseNumber, edge.lfromhn, edge.ltohn) && matchesParity(houseNumber, edge.parityL)) {
    const from = parseHouseNumber(edge.lfromhn)!;
    const to = parseHouseNumber(edge.ltohn)!;
    return from === to ? 0 : (houseNumber - from) / (to - from);
  }
  if (inRange(houseNumber, edge.rfromhn, edge.rtohn) && matchesParity(houseNumber, edge.parityR)) {
    const from = parseHouseNumber(edge.rfromhn)!;
    const to = parseHouseNumber(edge.rtohn)!;
    return from === to ? 0 : (houseNumber - from) / (to - from);
  }
  return null;
}

function dedupeWardRefs(refs: WardRef[]): WardRef[] {
  const map = new Map(refs.map((r) => [`${r.city}|${r.ward}`, r]));
  return [...map.values()];
}

function resolveAddress(
  index: AddressIndex,
  houseNumber: number,
  street: string,
  cityHint: City | null,
  zipHint: string | null,
): SearchOutcome {
  const edges = index.streets[street];
  if (!edges || edges.length === 0) {
    return { status: "not-found", reason: `We don't have "${street}" in our covered streets.` };
  }

  const matches: { edge: AddressEdge; fraction: number }[] = [];
  for (const edge of edges) {
    const fraction = matchingSideFraction(houseNumber, edge);
    if (fraction !== null) matches.push({ edge, fraction });
  }
  if (matches.length === 0) {
    return { status: "not-found", reason: `${street} is in our data, but not with house number ${houseNumber}.` };
  }

  // Progressive precision (AGENTS.md §2.5): narrow by whatever hints the
  // query carried *before* deciding this is ambiguous — a fully-specified
  // "123 Main St, Minneapolis 55401" should never show a disambiguation
  // list just because "Main St" alone is ambiguous somewhere else.
  let narrowed = matches;
  if (cityHint) {
    const byCity = narrowed.filter((m) => m.edge.wardCandidates.some((w) => w.city === cityHint));
    if (byCity.length > 0) narrowed = byCity;
  }
  if (zipHint) {
    const byZip = narrowed.filter((m) => m.edge.zipl === zipHint || m.edge.zipr === zipHint);
    if (byZip.length > 0) narrowed = byZip;
  }

  const wards = dedupeWardRefs(narrowed.flatMap((m) => m.edge.wardCandidates));
  if (wards.length === 0) {
    return {
      status: "not-covered",
      reason: `We found ${street}, but it's outside the cities this map covers.`,
    };
  }
  if (wards.length === 1) {
    const best = narrowed.find((m) => m.edge.wardCandidates.some((w) => w.city === wards[0].city && w.ward === wards[0].ward));
    const point = best ? interpolateAlongLine(best.edge.coords, best.fraction) : null;
    return { status: "single", wards: [wards[0]], point };
  }
  return {
    status: "ambiguous",
    wards,
    reason: `${street} crosses ${wards.length} wards — pick the one your address is in.`,
  };
}

function resolveZip(index: AddressIndex, zip: string): SearchOutcome {
  const wards = index.zips[zip];
  if (!wards || wards.length === 0) {
    return { status: "not-covered", reason: `ZIP ${zip} isn't in the cities this map covers.` };
  }
  if (wards.length === 1) return { status: "single", wards: [wards[0]], point: null };
  return {
    status: "ambiguous",
    wards,
    reason: `Addresses on file with ZIP ${zip} fall in ${wards.length} different wards — pick yours.`,
  };
}

/**
 * The single entry point SearchBar calls once a query is parsed. `index`
 * is nullable because the gazetteer fetch (a few MB — see
 * scripts/fetch-addresses.mjs) can still be in flight when someone
 * starts typing; city/county resolution never needed it anyway, and
 * zip/address resolution degrades to an honest "still loading" outcome
 * rather than the caller needing to remember to guard every call site.
 */
export function resolve(index: AddressIndex | null, parsed: ParsedQuery): SearchOutcome {
  switch (parsed.kind) {
    case "zip":
      if (!index) return { status: "not-found", reason: "Address and ZIP search are still loading — try again in a moment." };
      return resolveZip(index, parsed.zip);
    case "city":
      return { status: "city", city: parsed.city };
    case "county":
      return { status: "county", county: parsed.county, cities: COUNTY_CITIES[parsed.county] };
    case "uncovered-place": {
      const label = parsed.placeType === "county" ? `${parsed.name} County` : parsed.name;
      const kindWord = parsed.placeType === "county" ? "county" : "city";
      return {
        status: "not-covered",
        reason: `${label} isn't a ${kindWord} this site has data for yet — it currently covers ${CITIES.join(", ")}.`,
      };
    }
    case "address":
      if (!index) return { status: "not-found", reason: "Address and ZIP search are still loading — try again in a moment." };
      return resolveAddress(index, parsed.houseNumber, parsed.street, parsed.cityHint, parsed.zipHint);
    case "unparseable":
      return { status: "unparseable" };
  }
}
