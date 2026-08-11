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
import { CITIES, COUNTIES, COUNTY_CITIES, type City, type County } from "./cities.ts";
import { normalizeStreetName } from "./streetNormalize.mjs";

export { normalizeStreetName };

export type ParsedQuery =
  | { kind: "zip"; zip: string }
  | { kind: "city"; city: City }
  | { kind: "county"; county: County }
  // A bare name that's exactly both a covered city's name AND a covered
  // county's name — first arose when the city of Ramsey (Anoka County) was
  // added alongside the already-covered Ramsey County (St. Paul's county).
  // Per this file's own rule ("nothing here ever silently picks one ward
  // when more than one candidate is on the table"), the same applies one
  // level up: picking city-over-county by fixed priority would silently
  // guess for whichever resident actually meant the other one, with no way
  // for them to notice. Surfaced instead, same spirit as "ambiguous" wards.
  | { kind: "ambiguous-name"; city: City; county: County }
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
  // `formattedAddress` is the canonical "HOUSE NUMBER STREET" form (see
  // formatConfirmedAddress below) — set only when this
  // came from an actual house-number match (mirrors `point`: both are
  // null together, both non-null together), never for a ZIP-only match
  // or a ward picked off an ambiguous list, which have no single address
  // behind them to format.
  | { status: "single"; wards: [WardRef]; point: [number, number] | null; formattedAddress: string | null }
  // 2+ candidate wards — never auto-picked; the caller must show all of them.
  | { status: "ambiguous"; wards: WardRef[]; reason: string }
  // Resolves to a whole city (not one ward) — the caller expands this
  // against live ward data, since addressSearch.ts never touches that.
  | { status: "city"; city: City }
  | { status: "county"; county: County; cities: City[] }
  // See ParsedQuery's "ambiguous-name" kind above — the caller must show
  // both options, never auto-pick.
  | { status: "ambiguous-name"; city: City; county: County }
  // A real Minnesota *city* (never a county — see below) this app has no
  // ward/mayor data for, straight from ParsedQuery's "uncovered-place"
  // kind. Kept as its own status rather than folded into "not-covered"
  // (which it used to be) for the same reason "uncovered-place" is its
  // own ParsedQuery kind and not "unparseable": a resident who typed a
  // real city name gets an actionable next step — AGENTS.md §2.6's
  // community-contribution entry point — not just an apology. `name` is
  // the plain city string (never geocoded, never a point — see §2.5),
  // exactly what the caller needs for a `/contribute?city=` link. County-
  // level uncovered-place still falls through to plain "not-covered"
  // below: §2.6 scopes the pipeline to brand-new *cities* only.
  | { status: "uncovered-city"; name: string; reason: string }
  // Parsed as a real street/ZIP shape, and that street/ZIP exists in the
  // data, but every match falls outside every ward this app covers. Also
  // covers a real MN *county* name this app just doesn't map yet (city
  // names split off into "uncovered-city" above).
  | { status: "not-covered"; reason: string }
  // Parsed as a real street/ZIP shape, but nothing in the data matches at
  // all (unknown street, or a house number outside any range on file).
  | { status: "not-found"; reason: string }
  // Didn't parse as anything recognizable — never falls through to a guess.
  | { status: "unparseable" };

// A person might type "Saint Paul" or "St Paul" for what CITIES spells
// "St. Paul" — fold punctuation/case away and accept a couple of common
// spellings, rather than growing CITIES itself into a matching table.
// Exported for several independent consumers that all need this exact
// normalization: SearchBar.tsx reuses it for live typeahead prefix-
// matching ("St" finding "Saint Paul" and vice versa); WardMap.tsx's click
// handler and its applyUncoveredCityZoom (the AGENTS.md §2.6 keyboard/
// search entry point) both need it for a different divergence between the
// same two spellings — the statewide city-boundaries backdrop (MnDOT/MnGeo
// CTU FeatureServer) spells some of these cities "Saint ___" in full,
// while CITIES (and every per-city dataset keyed off it — wards.geojson,
// mayors.geojson) uses the abbreviated "St. ___" this file's own CITIES/
// COUNTIES already do; and WardModal.tsx's showAddOfficialsCta guard needs
// it for the same reason (see that file's own comment on the bug this
// fixes).
export function fold(s: string): string {
  return s
    .toUpperCase()
    .replace(/\bSAINT\b/g, "ST")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const FOLDED_CITIES = new Map(CITIES.map((c) => [fold(c), c]));
const FOLDED_COUNTIES = new Map(COUNTIES.map((c) => [fold(c), c]));

/**
 * Is `name` a city this app already has officials/ward data for, under
 * either spelling divergence fold() reconciles (CTU "Saint ___" vs
 * CITIES' "St. ___")? Exported so every "is this city already covered"
 * call site — cityMatch.ts's `alreadyCovered`, WardModal.tsx's
 * showAddOfficialsCta guard — shares this one FOLDED_CITIES lookup
 * instead of each independently building its own `new
 * Set(CITIES.map(fold))` literal, which is exactly how a raw-string
 * (non-folded) comparison bug shipped once already — see WardModal.tsx's
 * own comment on that fix.
 */
export function isCoveredCityName(name: string): boolean {
  return FOLDED_CITIES.has(fold(name));
}

const ZIP_RE = /\b(\d{5})(?:-\d{4})?\s*$/;
const MN_SUFFIX_RE = /,?\s*(MN|MINNESOTA)\s*$/i;
const UNIT_RE = /\b(apt|unit|ste|suite|#)\.?\s*\S+\s*$/i;
// The street half is optional (wrapped in its own `(?:\s+...)?` group)
// so a bare house number — "123", nothing typed after it yet — still
// parses as an address shape (street: "") instead of falling through to
// "unparseable". That's what lets SearchBar populate suggestions the
// instant a house number is typed, before a resident has typed any part
// of the street name (see suggestStreetsForHouseNumber below) — the
// previous version required at least one street character to match at
// all, so the moment right after typing just a number showed nothing.
const ADDRESS_RE = /^(\d+)[A-Za-z]?(?:\s+(.+))?$/;

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
    // A bare city name (the whole query, not a trailing ", City" on an
    // address) isn't a hint to strip here — stripping it would leave `s`
    // empty and the query would fall through to "unparseable" instead of
    // reaching the exact-match city/county branch below, where a bare name
    // actually belongs. Pre-existing bug (predates the ambiguous-name work
    // this comment sits next to): every bare city search was broken this
    // way, not just newly-added ones — caught by addressSearch.test.mjs.
    if (fold(s) === folded) continue;
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
  // Checked together, before either wins individually: a bare name that's
  // both a covered city and a covered county (e.g. "Ramsey") must not be
  // silently decided by which check happens to run first.
  if (FOLDED_CITIES.has(foldedWhole) && FOLDED_COUNTIES.has(foldedWhole)) {
    return { kind: "ambiguous-name", city: FOLDED_CITIES.get(foldedWhole)!, county: FOLDED_COUNTIES.get(foldedWhole)! };
  }
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
      return { kind: "address", houseNumber, street: normalizeStreetName(addressMatch[2] ?? ""), cityHint, zipHint };
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

/**
 * Streets that actually carry `houseNumber` somewhere in their indexed
 * address ranges — what SearchBar shows the instant a resident has typed
 * a house number and nothing else yet (no street text to prefix-match
 * against, which is what suggestStreets above needs). Reuses
 * matchingSideFraction (below) rather than a second range check, so this
 * can never disagree with what resolveAddress would actually resolve to.
 *
 * A full scan over every indexed street/edge, not an index keyed by house
 * number — there isn't one to look up, since house-number ranges are
 * per-street-segment and don't compress into a single number->street map.
 * ~60k edges over ~9k streets is a handful of milliseconds even on a
 * modest phone, well inside "type a digit, see the list update."
 */
export function suggestStreetsForHouseNumber(index: AddressIndex, houseNumber: number, limit: number): string[] {
  const matches: string[] = [];
  for (const street of Object.keys(index.streets)) {
    const edges = index.streets[street];
    if (edges.some((edge) => matchingSideFraction(houseNumber, edge) !== null)) {
      matches.push(street);
      if (matches.length >= limit) break;
    }
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

// The canonical display/copy/clipboard form: "931 BIRMINGHAM ST" — house
// number and street only. `street` is already USPS-abbreviated uppercase
// (see normalizeStreetName above — both index-build and query time run
// the same normalizer, so this never has to re-abbreviate anything). City,
// state, and ZIP are deliberately left off: they're resolution metadata
// (ward disambiguation, polling-place lookup), not part of what the
// resident typed, and keeping the copied/displayed string to just the
// street address is what the resident actually asked to confirm.
function formatConfirmedAddress(houseNumber: number, street: string): string {
  return `${houseNumber} ${street}`;
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
  // A bare house number with no street yet (ADDRESS_RE's street group is
  // optional — see its own comment) parses to "address" so the dropdown
  // can suggest streets for it, but there's nothing to resolve to on a
  // direct Enter/commit: "unparseable" here is what keeps that keystroke
  // from producing `We don't have "" in our covered streets.` instead of
  // just leaving the still-open suggestion list as the answer.
  if (!street) return { status: "unparseable" };

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
    const formattedAddress = formatConfirmedAddress(houseNumber, street);
    return { status: "single", wards: [wards[0]], point, formattedAddress };
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
  if (wards.length === 1) return { status: "single", wards: [wards[0]], point: null, formattedAddress: null };
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
    case "ambiguous-name":
      return { status: "ambiguous-name", city: parsed.city, county: parsed.county };
    case "uncovered-place": {
      const label = parsed.placeType === "county" ? `${parsed.name} County` : parsed.name;
      const kindWord = parsed.placeType === "county" ? "county" : "city";
      const reason = `${label} isn't a ${kindWord} this site has data for yet — it currently covers ${CITIES.join(", ")}.`;
      // Cities get the actionable status (see SearchOutcome's own comment
      // on "uncovered-city") — counties stay "not-covered", since §2.6's
      // contribution pipeline never accepts a county-level submission.
      if (parsed.placeType === "city") return { status: "uncovered-city", name: parsed.name, reason };
      return { status: "not-covered", reason };
    }
    case "address":
      if (!index) return { status: "not-found", reason: "Address and ZIP search are still loading — try again in a moment." };
      return resolveAddress(index, parsed.houseNumber, parsed.street, parsed.cityHint, parsed.zipHint);
    case "unparseable":
      return { status: "unparseable" };
  }
}
