// Plain ESM (not .ts) so the exact same normalizer runs in two contexts
// that can't share a TypeScript build step: scripts/fetch-addresses.mjs
// (plain `node`, no ts-node) at index-build time, applied to TIGER's
// FULLNAME field, and src/lib/addressSearch.ts (via tsconfig's
// `allowJs: true`) at query time, applied to what a resident typed. One
// file, imported both ways, is what guarantees the two can never drift
// apart — a duplicated implementation is exactly how "123 Main Street"
// stops matching an index built from "123 MAIN ST".
//
// TIGER/Line's own FULLNAME field already ships in standard USPS
// abbreviated form ("NICOLLET AVE", not "Nicollet Avenue"), so this table
// only needs to map the spelled-out form a person might type *toward*
// that convention — not the other direction, and not every possible
// variant. Deliberately small and defensible rather than exhaustive.
const SUFFIX_SYNONYMS = {
  STREET: "ST",
  AVENUE: "AVE",
  BOULEVARD: "BLVD",
  DRIVE: "DR",
  LANE: "LN",
  ROAD: "RD",
  PARKWAY: "PKWY",
  PLACE: "PL",
  COURT: "CT",
  CIRCLE: "CIR",
  TRAIL: "TRL",
  HIGHWAY: "HWY",
};

const DIRECTION_SYNONYMS = {
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
  NORTHEAST: "NE",
  NORTHWEST: "NW",
  SOUTHEAST: "SE",
  SOUTHWEST: "SW",
};

/**
 * Canonicalizes a street name so index-build time (TIGER's FULLNAME) and
 * query time (parsed user input) land on the same key. Idempotent —
 * running it on an already-abbreviated name is a no-op, so it's safe to
 * apply to both sides unconditionally.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeStreetName(raw) {
  return raw
    .toUpperCase()
    .replace(/[.,]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => SUFFIX_SYNONYMS[token] ?? DIRECTION_SYNONYMS[token] ?? token)
    .join(" ")
    .trim();
}
