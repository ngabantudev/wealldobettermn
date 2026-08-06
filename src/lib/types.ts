export interface CandidateInfo {
  name: string;
  party: string;
  isIncumbent: boolean;
  // e.g. "Democratic Socialists of America" — organizations that have
  // publicly endorsed this candidate. Not a ballot-line party; kept
  // separate from `party` since a candidate can carry several of these.
  endorsements: string[];
}

export interface BillVote {
  // The roll call's own id (Open States' ocd-vote/... identifier) — a bill
  // can carry more than one roll call on the same day (an amendment, then
  // final passage), so identifier+date alone isn't a unique key for this.
  voteId: string;
  identifier: string; // e.g. "HF 4541"
  title: string;
  option: string; // this legislator's own vote: "yes" | "no" | etc.
  result: string; // the roll call's outcome: "pass" | "fail"
  date: string; // ISO date the vote was taken
  openstatesUrl: string | null;
}

export interface RepProperties {
  role: "Mayor" | "Council Member" | "County Commissioner" | "State Representative" | "State Senator";
  // "Minneapolis" | "St. Paul" — drives map color/filter grouping for every
  // role, including commissioners: a Hennepin district is grouped/colored
  // with Minneapolis, Ramsey with St. Paul, even though the district itself
  // covers a lot of suburbs the city name doesn't literally describe. `county`
  // below carries the accurate label for display.
  city: string;
  county: string | null;
  ward: number | null;
  // A handful of cities (Brooklyn Park's Central/East/West, currently) name
  // their council districts instead of numbering them — their GIS source
  // carries no ward number at all. `ward` still gets a synthetic, stable
  // number in that case (fill-color cycling and click-identity matching
  // both key off it), but display code should prefer this field when it's
  // set so the UI says what the city actually calls the area, not "Ward 1."
  // Same reasoning as stateDistrict below: a string sibling field rather
  // than changing what the numeric field means for every other city.
  wardName: string | null;
  district: number | null;
  // MN House/Senate districts are alphanumeric ("47B", "50"), not the plain
  // numbers `district` above holds for county commissioners — a separate
  // field rather than widening `district`'s type for every other role.
  stateDistrict: string | null;
  chamber: "house" | "senate" | null;
  repName: string | null;
  repParty: string;
  repPhotoUrl: string | null;
  repEmail: string | null;
  repPhone: string | null;
  officeSince: string;
  committees: string[];
  neighborhoods: string[];
  officeRoom: string | null;
  profileUrl: string | null;
  // Who's on the ballot for this seat's next election — independent of
  // repName above, which is always the current officeholder whether or not
  // they're running again. Empty until real filing data is sourced (no
  // clean API for this; see fetch-*.mjs).
  candidates: CandidateInfo[];
  // Precomputed candidates.length >= 2, set alongside candidates in the
  // same fetch script so it can't drift. Exists as its own primitive field
  // (not just derived from candidates.length at render time) because
  // MapLibre's fill/line-layer filter expressions need something they can
  // read directly off the tiled feature — see WardModal's isContested()
  // for the derivation this mirrors, used everywhere outside a layer filter.
  isContested: boolean;
  // State legislators only (null for every other role): share of this
  // legislator's own party-line roll-call votes where they voted with
  // their party's majority — see scripts/fetch-state-legislature.mjs for
  // the exact method. Null, not 0, when there weren't enough sampled
  // votes to compute a number worth showing.
  partyUnityPercent: number | null;
  // A handful of this legislator's most recent roll-call votes, newest
  // first — doubles as "what have they been voting on" and as the raw
  // material partyUnityPercent above is computed from.
  recentVotes: BillVote[];
}

// A pointer to one ward — the join key between the address/ZIP gazetteer
// (src/lib/addressSearch.ts, public/address-index.json) and the ward
// features already loaded from wards.geojson. Deliberately just the two
// fields that identify a ward feature (matches the `${city}-${ward}` key
// shape used elsewhere, e.g. WardMap.tsx's wardPinOccurrences) rather than
// duplicating the full RepProperties — the gazetteer's job is "which
// ward," not "who represents it," so it always resolves through a lookup
// against the real, current ward data rather than carrying its own
// (potentially stale) copy of rep info.
export interface WardRef {
  city: string;
  ward: number;
}

// One TIGER/Line ADDRFEAT edge (a single block-face's worth of address
// range on one street), as emitted by scripts/fetch-addresses.mjs. House
// number ranges are kept as strings — TIGER's own encoding, and some
// ranges carry non-numeric suffixes — and parsed defensively at query
// time in addressSearch.ts rather than coerced at ingest.
export interface AddressEdge {
  tlid: number;
  // WGS84 [lng, lat] endpoints ([start, end] — TIGER's ~5-vertex polyline
  // simplified to its two ends, plenty for linear interpolation across a
  // single block face), used only for approximating a house number's
  // position along the block for map-zoom/pin precision. Never consulted
  // for ward identity: that's wardCandidates below, computed once at
  // build time instead. Empty when wardCandidates is empty — a zoom
  // target only ever matters for an edge that resolved into a ward this
  // app covers.
  coords: [number, number][];
  lfromhn: string | null;
  ltohn: string | null;
  rfromhn: string | null;
  rtohn: string | null;
  // Odd/Even/Both — which house-number parity this side's range covers.
  parityL: "O" | "E" | "B" | null;
  parityR: "O" | "E" | "B" | null;
  zipl: string | null;
  zipr: string | null;
  // Every ward whose polygon contains any vertex of this edge, computed
  // once offline in scripts/fetch-addresses.mjs — never recomputed in the
  // browser. Usually length 1; length 2 means this block straddles a
  // ward boundary (surfaced as a disambiguation, never resolved
  // silently — see addressSearch.ts's resolve()); length 0 means this
  // edge falls outside every ward this app covers, which is kept (not
  // dropped) so "found the street, but it's outside our coverage" can be
  // told apart from "no such street" in the UI.
  wardCandidates: WardRef[];
}

// The on-device gazetteer shipped as public/address-index.json — the
// entire implementation of AGENTS.md §2.5's "static index shipped with
// the app." Built once per npm run data:addresses from free, public-domain
// US Census TIGER/Line data; never fetched or computed against a live
// service at request time.
export interface AddressIndex {
  schemaVersion: 1;
  generatedAt: string; // build metadata only, never derived from a query
  sourceCounties: { name: string; fips: string; url: string }[];
  // Keyed by normalizeStreetName(FULLNAME) — see streetNormalize.mjs.
  streets: Record<string, AddressEdge[]>;
  // Keyed by 5-digit ZIP. An absent key means honestly "not covered,"
  // never an empty-but-present array standing in for the same thing.
  zips: Record<string, WardRef[]>;
}

// The full Minnesota gazetteer, shipped as public/mn-places.json and built
// once per npm run data:places from the U.S. Census Bureau's public-domain
// Gazetteer Files (scripts/fetch-places.mjs) — every incorporated city and
// every county in the state, not just the much smaller set this app has
// ward/commissioner data for (src/lib/cities.ts's CITIES/COUNTIES). This
// is what lets SearchBar recognize *any* MN place name at all; whether the
// app actually covers it is a separate question, answered by cross-
// referencing cities.ts. A name found here but absent from cities.ts
// resolves to an honest "not covered yet" outcome (AGENTS.md §3.3
// Coverage Honesty) — never silence, and never a fabricated ward.
export interface MnPlaces {
  schemaVersion: 1;
  generatedAt: string;
  source: {
    sourceAgency: string;
    documentType: string;
    primarySourceUrl: string;
    placesUrl: string;
    countiesUrl: string;
    licence: string;
  };
  // No "County"/"city" suffix — same bare-name style as cities.ts's
  // CITIES/COUNTIES, so the two lists compare directly without either
  // side needing to strip anything first.
  counties: string[];
  cities: string[];
}

// ---------------------------------------------------------------------------
// Phase 2 — state bills & roll-call votes (FEATURES.md "Phase 2 — State
// bills & roll-call votes"). See scripts/ingest/state-bills.mjs for the
// ingest side of this schema.
// ---------------------------------------------------------------------------

// AGENTS.md §2.2's required provenance record, made a shared type instead
// of the ad-hoc inline shape MnPlaces.source above uses — every Phase 2
// feature (bills, vote events) carries one of these rather than each
// re-declaring the same seven fields slightly differently.
export interface Provenance {
  primarySourceUrl: string;
  sourceAgency: string;
  documentType: string;
  documentId: string;
  issuedDate: string | null;
  fetchedAt: string;
  licence: string;
  contentHash: string;
}

// A minimal stand-in for the full `holding` entity (a person's occupancy of
// a specific office over a specific term — see AGENTS.md §1d's
// officeHeld/jurisdiction/termStart/termEnd). As of this scaffold, no
// sibling branch with that entity model has merged, so this repo has no
// `holding` type to import yet: RepProperties still conflates person +
// office + term into one flat record (src/lib/types.ts above). Per
// FEATURES.md Phase 2, votes attach to *holding*, not *person*, resolved
// by (person, date) — this gives Vote below a stable join key without
// duplicating the eventual entity's fields here. When the real `holding`
// type ships, replace this with an import of it; keep the `id` field as
// that entity's primary key so no caller needs to change.
export interface HoldingRef {
  id: string;
}

export type VoteOption = "yes" | "no" | "other" | "absent" | "excused" | "not voting";

// One bill sponsor as reported by the source — not yet resolved to a
// HoldingRef in every case (a sponsor name from Open States doesn't always
// cleanly match a current officeholder, e.g. former members, so resolution
// failure is represented rather than guessed at).
export interface BillSponsor {
  name: string;
  classification: string | null; // e.g. "primary", "cosponsor", as the source reports it
  holding: HoldingRef | null;
}

export interface BillAction {
  date: string;
  description: string;
  // Open States' own action classification tags (e.g. "introduction",
  // "reading-2", "passage") — kept as reported, never re-interpreted.
  classification: string[];
}

// One upstream record's own identifier for a bill or vote event, so a
// disagreement between sources (see VoteEvent.tallies below) can always be
// traced back to each source's own page for the record.
export interface ExternalSource {
  provider: "openstates" | "legiscan";
  id: string;
  url: string | null;
}

export interface Bill {
  schemaVersion: 1;
  // Open States' own OCD bill id, e.g. "ocd-bill/...", the interchange key
  // per AGENTS.md §2.4.
  id: string;
  identifier: string; // e.g. "HF 4541"
  session: string;
  title: string;
  chamber: "house" | "senate" | null;
  sponsors: BillSponsor[];
  actions: BillAction[];
  // The bill's current status as the source reports it (e.g. "Signed into
  // law", "In committee") — displayed as-is, never inferred from actions.
  status: string;
  sources: ExternalSource[];
  provenance: Provenance;
}

// A single source's reported tally for one vote event. Kept per-source
// rather than collapsed into one number so that when Open States and
// LegiScan disagree, both survive — see VoteEvent.tallyDisagreement.
export interface VoteTally {
  source: "openstates" | "legiscan";
  yes: number;
  no: number;
  other: number;
  url: string | null;
}

// One legislator's recorded vote within a vote event, attached to the
// holding (office + term) they cast it from — never directly to a person
// record — resolved by matching (person, date) against the holding active
// on that date. See HoldingRef above.
export interface Vote {
  holding: HoldingRef;
  option: VoteOption;
}

export interface VoteEvent {
  // Open States' own OCD vote id.
  id: string;
  billId: string; // Bill.id this roll call belongs to
  identifier: string;
  motion: string;
  date: string; // ISO date the vote was taken
  result: string; // e.g. "pass" | "fail", as the source reports it
  chamber: "house" | "senate" | null;
  // Full yea/nay roster for this vote event.
  votes: Vote[];
  // Per-source tallies. Where Open States and LegiScan disagree on the
  // count, both entries are kept here rather than one being silently
  // chosen — FEATURES.md Phase 2's explicit requirement. Populated only
  // once the LegiScan cross-check (scripts/ingest/state-bills.mjs) is
  // implemented; a single-entry array is not itself a disagreement.
  tallies: VoteTally[];
  // True only when two or more entries in `tallies` report different
  // yes/no/other counts for the same vote event. Never resolved by picking
  // one source; the UI must show the flag and both tallies.
  tallyDisagreement: boolean;
  sources: ExternalSource[];
  provenance: Provenance;
}
