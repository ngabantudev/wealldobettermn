// CoverageTier (A/B/C) is defined once, in models.ts — the FEATURES.md
// "Coverage tiers" concept applies project-wide, not per-file. Imported
// here only for JurisdictionPlatformRecord's field type below (Phase 7);
// consumers of CoverageTier itself should import it from "./models"
// directly rather than through this re-export-free import, so it stays
// obvious there's exactly one definition. See the 2026-08-06 note above
// CoverageTier in models.ts.
import type { CoverageTier } from "./models";

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
  // Link to the primary record for this specific roll call. Named
  // source-agnostically (not openstatesUrl) since #57 added a second
  // producer — scripts/lib/legistarRecentVotes.mjs — alongside
  // fetch-state-legislature.mjs's Open States one. Null, never guessed,
  // when the producing script doesn't have a confirmed working per-item
  // URL (AGENTS.md §3.3 "Missing Sources").
  sourceUrl: string | null;
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
  // Replaces the old officeSince scalar (see AGENTS.md §1d and issue #96):
  // a single string couldn't represent "we know the term-end date but not
  // the start," an ambiguous first-elected-vs-current-term date, or a
  // genuinely unconfirmed date without smuggling in a placeholder that
  // renders identically to a real one. Every record today gets exactly one
  // entry (current: true) — historical term backfill is a separate, later
  // issue (#98). termStart/termEnd are real dates only when a primary or
  // clearly-cited source states them; null otherwise, never a guess or
  // sentinel placeholder.
  termsOfService: Array<{
    termStart: string | null;
    termEnd: string | null;
    current: boolean;
    sourceUrl: string;
  }>;
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
  // AGENTS.md §3.2's per-record verification bookkeeping — "Every record
  // carries verifiedAt and verifiedAgainst... The UI surfaces the
  // verification date wherever a name or contact appears." Optional
  // because only scripts/fetch-state-legislature.mjs sets these today;
  // the other fetch-*.mjs scripts (mayors, wards, commissioners) don't
  // yet emit them (a known gap, not fixed by this field's addition).
  // Rendering a staleness notice from these in the UI is deferred — see
  // src/lib/electionConfig.ts's isStale() for the check a future
  // component would call.
  verifiedAt?: string;
  verifiedAgainst?: string;
  // State legislators only, populated by
  // scripts/fetch-state-legislature-bio.mjs's enrichment pass over
  // scripts/fetch-state-legislature.mjs's own output — none of these are
  // exposed by Open States at all (senate.mn/house.mn are the only
  // source), so they stay optional/null for every other role and for any
  // state legislator this bio scraper hasn't successfully reached yet.
  // See that script's own header for why it's a separate ingest pass
  // rather than folded into the roster fetch.
  leadershipTitle?: string | null;
  legislativeAssistant?: { name: string; phone: string | null } | null;
  // e.g. "4th" — the source's own ordinal text, not re-derived from
  // electedYears below (an off-cycle special election can make the
  // arithmetic wrong).
  termNumber?: string | null;
  // The source's own free-text elected-years sequence, e.g. "2012,
  // re-elected 2016, 2020, 2022" — kept as reported rather than parsed
  // into a year array, since the format isn't perfectly uniform across
  // members and AGENTS.md §3.3 prefers showing a source's own words over
  // a fragile re-interpretation of them.
  districtMapUrl?: string | null;
  districtDemographicsUrl?: string | null;
}

// A pointer to one ward — the join key between the address/ZIP gazetteer
// (src/lib/addressSearch.ts, public/address-index/) and the ward
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

// The on-device gazetteer shipped as public/address-index/ — the entire
// implementation of AGENTS.md §2.5's "static index shipped with the app"
// and §4's "chunked and lazily loaded so nobody downloads the whole state
// to find one ward." Built once per npm run data:addresses from free,
// public-domain US Census TIGER/Line data; never fetched or computed
// against a live service at request time. See issue #70 / PR that closed
// it for why this used to be one flat public/address-index.json file.
//
// Three shapes now exist where one used to:
//
//   AddressGazetteerManifest — public/address-index/manifest.json. Small,
//     always fetched (see WardMap.tsx): every ZIP's ward list (resolving a
//     ZIP never needs edge/geometry data, so it never needed chunking —
//     see fetch-addresses.mjs's own comment on "Why zips stay unchunked"),
//     plus streetChunks, the routing table src/lib/addressChunks.ts
//     consults to know which chunk(s) a *committed* address query needs.
//   AddressIndexChunk — public/address-index/<county-key>.json, one per
//     county. Holds only that county's own streets map — the actual
//     edge/geometry payload, which is what made the old flat file large.
//   AddressIndex — no longer a fetched file at all. It's the shape
//     src/lib/addressSearch.ts's resolve()/suggestStreets()/etc. still
//     expect (so none of that pure resolution logic had to change), now
//     assembled client-side in src/lib/addressChunks.ts by merging the
//     manifest's zips with whichever chunk(s) have been lazily fetched so
//     far. `streets` only ever contains entries for chunks actually
//     loaded — see addressChunks.ts's own comment for why that's safe.
export interface AddressGazetteerManifest {
  schemaVersion: 1;
  generatedAt: string; // build metadata only, never derived from a query
  sourceCounties: { key: string; name: string; fips: string; url: string }[];
  chunks: { key: string; county: string; fips: string; sourceUrl: string; streetCount: number; edgeCount: number }[];
  // Keyed by 5-digit ZIP. An absent key means honestly "not covered,"
  // never an empty-but-present array standing in for the same thing.
  zips: Record<string, WardRef[]>;
  // Keyed by normalizeStreetName(FULLNAME) (see streetNormalize.mjs) ->
  // the chunk key(s) whose streets map carries that name. A street that
  // exists in two counties (not rare — "Main St" isn't unique) lists both,
  // and addressChunks.ts fetches both before resolving, per §2.5's
  // "ambiguity is surfaced, never silently resolved" — chunking must
  // never cause a real candidate to go missing, only change how many
  // bytes are on the wire to find it.
  streetChunks: Record<string, string[]>;
}

// One county's own chunk of the gazetteer — public/address-index/
// <county-key>.json. Never fetched eagerly; see addressChunks.ts.
export interface AddressIndexChunk {
  schemaVersion: 1;
  county: { key: string; name: string; fips: string };
  streets: Record<string, AddressEdge[]>;
}

// The merged, in-memory view src/lib/addressSearch.ts's resolution logic
// operates over — see this section's own comment above for how it's
// assembled. Never a single fetched file anymore.
export interface AddressIndex {
  schemaVersion: 1;
  generatedAt: string;
  sourceCounties: { key: string; name: string; fips: string; url: string }[];
  // Keyed by normalizeStreetName(FULLNAME) — see streetNormalize.mjs.
  // Only ever contains streets from chunk(s) fetched so far.
  streets: Record<string, AddressEdge[]>;
  // Keyed by 5-digit ZIP. An absent key means honestly "not covered,"
  // never an empty-but-present array standing in for the same thing.
  // Always complete — sourced straight from the manifest, never chunked.
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
// NOTE (2026-08-06): two independent `Holding` interfaces used to live
// here at different times, from two different phase-scaffold PRs that
// couldn't see each other's work or src/lib/models.ts's canonical one:
//   - Phase 4 (St. Paul/Hennepin Legistar): Legistar-/officerecords-
//     shaped (client/personId/bodyId/officeTitle/startDate/endDate).
//     Zero real consumers — nothing ever imported it.
//   - Phase 3 (Minneapolis LIMS): a denormalized officeholding shape
//     (officeOcdId/personExternalId/name/officeHeld/jurisdiction/
//     termStart/termEnd/sourceUrl/verifiedAt), meant as the target for
//     that PR's toHoldings() — which throws (unimplemented), so nothing
//     depended on this exact shape either.
// Both removed as duplicates rather than reconciled: per AGENTS.md
// §0.1/§2.1, a `holding` is a single project-wide concept, and
// models.ts's `Holding` (id/office_id/person_id/term_start/term_end/…) is
// the canonical shape everything should converge on. Any future ingest
// that produces holdings — Legistar's persons/bodies/officerecords, LIMS's
// CouncilMembers/CouncilTerms, or anything else — should construct
// models.ts's `Holding` directly (resolving the source's own person/office
// identifiers into this repo's own `Office`/`Person` ids), not reintroduce
// a source-shaped duplicate here. See LESSONS.md's Process & Multi-PR
// Coordination section for the pattern behind both of these.

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
// ingest side of this schema, and src/app/bills/page.tsx for the one real
// consumer of Bill below.
//
// Bill/VoteEvent/Vote also exist in src/lib/models.ts, as normalized
// relational stubs (foreign keys, meant to be joined) — part of the same
// FEATURES.md Phase 1 entity model as Holding/Office/Person. The two
// aren't the same shapes and aren't meant to converge: models.ts's
// versions have zero real consumers as of this writing (nothing has ever
// constructed one), while the Bill/VoteEvent/Vote below are the flat,
// self-contained document shape scripts/ingest/state-bills.mjs actually
// writes and src/app/bills/page.tsx actually reads — the same
// flat-wire-vs-relational split this file's Holding note above and
// models.ts's own header comment describe for the rest of the schema,
// applied to these three entities too. If a real bill/vote ingest into
// the relational model is ever built, that's a deliberate design decision
// for whoever builds it, not an accidental duplicate to merge away.
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

// A lightweight pointer to a models.ts `Holding` — matching the same
// reference-by-id pattern this file already uses for WardRef above,
// rather than embedding a full Holding (with all its office/person/term
// fields) inside every vote record. `id` is meant to match a real
// `Holding["id"]` once holding resolution is actually implemented; kept
// as its own named type (not `Holding["id"]` directly) so this file
// doesn't need a value-level import of models.ts just for a string alias.
// (Originally scaffolded as a full stand-in before models.ts's `Holding`
// existed on this branch — updated 2026-08-06 now that it does; the
// shape doesn't need to change, just this comment.)
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
//
// `holding` is nullable (fixed 2026-08-06, matching BillSponsor.holding's
// already-correct `HoldingRef | null` above): resolution is a real,
// documented gap — no `Holding` row is ever constructed anywhere in this
// codebase for state legislators (see models.ts's NOTE (2026-08-06) above
// Holding/VoteEvent/Vote), so scripts/ingest/state-bills.mjs's
// resolveVoterHolding() always returns null today. This field was
// previously typed as non-nullable `HoldingRef`, which would have forced
// the ingest script to either fabricate a placeholder id (forbidden by
// AGENTS.md §3.3 "Missing Sources" — never fabricate or infer) or skip
// populating it altogether — neither is correct. Every recorded vote is
// still an honest `option`; only the office/term attribution is
// unresolved, per AGENTS.md §3.3.
export interface Vote {
  holding: HoldingRef | null;
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

// --- Phase 7: suburban/outstate coverage inventory --------------------
//
// FEATURES.md Phase 7's research deliverable: what meeting/agenda/vote
// system does each of the ~180 metro cities (and eventually the ~850
// cities + 87 counties statewide) run, so a handful of per-platform
// adapters (not ~180 per-city scrapers) can be written against whichever
// ones are common. This is a `jurisdiction_platform` table, not a scraper
// — see scripts/ingest/probe-legistar.mjs for the one live check this
// phase performs (a cheap read-only probe for a Legistar API instance),
// and public/jurisdiction-platform-inventory.json for the seeded, honest
// "unknown" starting inventory (AGENTS.md §3.3 Coverage Honesty: absence
// of a probe result is recorded as `"unknown"`, never guessed).
//
// No sibling `feature/data-model-phase1-state-legislature` branch exists
// yet to extend (checked: not present locally or on origin as of this
// PR), so `jurisdictionId` below is a minimal, compatible stand-in for
// that future shared jurisdiction type — an AGENTS.md §2.4 OCD identifier
// string (`ocd-division/country:us/state:mn/place:{slug}`) rather than a
// richer object, so a later shared type can absorb this field without a
// breaking rename.

// The four real platforms this phase expects to find among metro cities
// (CivicPlus, Granicus, iCompass, and Legistar — see FEATURES.md Phase 7
// and AGENTS.md §3.2's Legistar/Granicus row), plus the two honest
// fallbacks: `pdf-only` once a human has actually looked and confirmed
// there's no structured feed at all, and `unknown` for "not probed yet."
// `unknown` is the only value scripts/ingest/probe-legistar.mjs or the
// seed step in this PR may write — the other platform values require a
// human or a future adapter probe to have actually confirmed them.
export type CivicPlatform = "legistar" | "civicplus" | "granicus" | "icompass" | "pdf-only" | "unknown";

// CoverageTier: A = full votes + meetings + agendas (Legistar-class), B =
// meetings + agendas, no structured votes (CivicPlus/Granicus
// adapter-class), C = roster + contact info only. Every jurisdiction
// defaults to "C" until it's promoted by an actual adapter or probe
// result — see DEFAULT_COVERAGE_TIER in src/lib/jurisdictionPlatform.ts.
// Defined once in models.ts (imported at the top of this file) — this
// used to be a second, independent "A"|"B"|"C" definition here, added by
// the Phase 7 PR in parallel with (and blind to) the Phase 1 PR that
// defined the canonical one. Structurally identical so TypeScript never
// complained, but two names for one FEATURES.md concept is exactly the
// kind of drift AGENTS.md §2.1's registry pattern exists to prevent —
// consolidated 2026-08-06, see LESSONS.md.

export interface JurisdictionPlatformRecord {
  // ocd-division/country:us/state:mn/place:{slug} — AGENTS.md §2.4. Not
  // yet cross-checked against a canonical divisions dataset (none exists
  // in this repo yet); see jurisdictionPlatform.ts's toJurisdictionId().
  jurisdictionId: string;
  // Bare city name, same no-suffix style as cities.ts's CITIES, so this
  // table can be cross-referenced against the app's covered-city list
  // without either side stripping anything first.
  city: string;
  platform: CivicPlatform;
  // null until scripts/ingest/probe-legistar.mjs (or a future per-platform
  // probe) actually runs against this jurisdiction. Never backfilled with
  // today's date on a guess — AGENTS.md §3.3 Coverage Honesty.
  probedAt: string | null;
  // Evidence for `platform`: the URL that returned a hit (e.g. the
  // Legistar `/bodies` endpoint that responded), or null while `platform`
  // is still "unknown". Required once `platform` moves off "unknown".
  sourceUrl: string | null;
  coverageTier: CoverageTier;
}

export interface JurisdictionPlatformInventory {
  schemaVersion: 1;
  generatedAt: string;
  jurisdictions: JurisdictionPlatformRecord[];
}

// --- Phase 6: meeting documents & agenda ingestion --------------------
// (FEATURES.md's Phase 6 section.) scripts/ingest/agenda-documents.mjs
// produces ArchivedDocument records; scripts/ingest/agenda-versions.mjs
// builds and diffs AgendaItem version histories from AgendaItemSnapshots.
// No fetch script populates these yet — this is scaffolding for the
// Legistar/Granicus `/events`, `/matters` integration AGENTS.md §3.2
// calls the project's highest-value integration, so these shapes are the
// contract that work will emit into, not data that ships today.
//
// No `agenda_item` type existed in this file as of this addition (the
// sibling state-legislature-schema PR that might define one hadn't
// merged) — AgendaItem/AgendaItemSnapshot below are a minimal, from-
// scratch definition, named to match this file's PascalCase-interface
// convention rather than the snake_case FEATURES.md prose uses. If that
// sibling PR lands its own agenda_item shape first, reconcile by renaming
// rather than keeping two parallel types.

// One source document (agenda packet, minutes, or meeting video) already
// discovered by another ingest script's own upstream payload (e.g. a
// Legistar `/events` response's `EventAgendaFile`) and mirrored under
// public/documents/agendas/<contentHash>.<ext> by
// scripts/ingest/agenda-documents.mjs's archiveDocument(). Implements
// AGENTS.md §3.3 Document Retention.
export interface ArchivedDocument {
  sourceUrl: string;
  documentType: "agenda" | "minutes" | "video" | "other";
  sourceAgency: string | null;
  fetchedAt: string; // ISO timestamp of the archive fetch — not the document's own issued date
  contentHash: string; // sha256 hex of the exact bytes stored, per AGENTS.md §2.2's provenance record
  storedPath: string; // relative to public/, e.g. "documents/agendas/<hash>.pdf"
  byteLength: number;
  contentType: string | null;
  // Relative-to-public/ path to extracted plain text, populated by
  // scripts/ingest/extract-text.mjs's extractAndStoreDocumentText().
  // Null until extraction has run, and stays null if extraction failed
  // (see extractionStatus) — never a guess at what the text might say.
  extractedTextRef: string | null;
  extractionStatus: "pending" | "not_implemented" | "extracted" | "failed";
}

// One agenda item as it appeared in one specific agenda document.
// Cities amend agendas after initial publication — an item added,
// pulled, or reworded before the meeting — and FEATURES.md's Phase 6
// note requires keeping *both* versions and diffing them rather than
// overwriting. This is a snapshot, not a mutable record: a new
// AgendaItemSnapshot is appended each time the same logical item
// changes; existing snapshots are never edited in place. Mirrors
// AGENTS.md §0.5 ("a map that silently overwrites its own history is
// worse than no map").
export interface AgendaItemSnapshot {
  // Stable across amendments — identifies "this logical agenda item,"
  // not "this printing of it." Caller-assigned (e.g. derived from the
  // body's own matter/item id plus the meeting date).
  agendaItemId: string;
  version: number; // 1 for the first-seen printing, incrementing per amendment
  // The version number this one supersedes, or null for the first
  // version — chains back through history rather than a single "latest"
  // pointer, so the full amendment trail stays walkable.
  supersedesVersion: number | null;
  title: string;
  description: string | null;
  // The archived document this snapshot's text/title came from — join
  // key into ArchivedDocument.contentHash above. Null until the owning
  // document has actually been archived.
  documentHash: string | null;
  extractedTextRef: string | null;
  sourceUrl: string;
  fetchedAt: string;
}

// All known snapshots of one logical agenda item, oldest first. Never
// mutate `versions` in place — append via
// scripts/ingest/agenda-versions.mjs's appendAgendaItemVersion() and
// bump currentVersion instead.
export interface AgendaItem {
  agendaItemId: string;
  currentVersion: number;
  versions: AgendaItemSnapshot[];
}

// A field-level diff between two snapshots of the same agenda item —
// "what changed when this got amended," not a general-purpose deep-diff.
// Produced by scripts/ingest/agenda-versions.mjs's
// diffAgendaItemSnapshots().
export interface AgendaItemDiff {
  agendaItemId: string;
  fromVersion: number;
  toVersion: number;
  changedFields: Array<{
    field: "title" | "description" | "documentHash";
    before: string | null;
    after: string | null;
  }>;
}
