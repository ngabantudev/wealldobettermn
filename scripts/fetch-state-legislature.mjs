#!/usr/bin/env node
// scripts/fetch-state-legislature.mjs
//
// Writes public/state-legislature.geojson — every MN House + Senate
// district statewide, each joined to its current legislator (Open States)
// and a party-unity score computed from a sample of recent roll-call
// votes: the share of party-line votes where the legislator voted with
// their own party's majority. See computePartyUnity() below for the
// exact method.
//
// Statewide since #61 (#15's first follow-up): this script used to filter
// districts down to a Twin Cities bounding box (TWIN_CITIES_BOUNDS/
// boundsContainPoint, removed there) even though fetchLegislators() and
// fetchRecentVoteEvents() below were already querying Open States for
// all of Minnesota, unfiltered — the geographic filter only ever
// discarded districts after they'd already been fetched. Removing it
// cost no extra API calls; district/legislator coverage has been
// statewide (201 seats) since that PR. See src/lib/coverage.ts's
// STATE_LEGISLATURE_NOTE.
//
// What #15 flagged as still-bounded work, and what this pass (#15's
// second follow-up) does about it: vote-*sampling* depth, not roster
// coverage, was the actual gap. A single run's sample
// (BILL_PAGES_TO_SAMPLE pages of "recently updated" MN bills) was pulled
// from one combined, unfiltered list — and Open States' `updated_desc`
// ordering across the whole jurisdiction turned out to skew hard toward
// one chamber's bills on any given day. Confirmed against the
// then-committed public/state-legislature.geojson (2026-08-08): 133/134
// House seats had a party-unity score, 1/67 Senate seats did — the
// sample had found a House floor vote (which alone covers nearly the
// whole House, since one roll call lists every member present) but
// never a Senate one. Two changes address this without requesting any
// more of Open States' free tier than before:
//
//   1. fetchRecentVoteEvents() now samples each chamber separately
//      (`chamber=upper`/`chamber=lower` on /bills, confirmed as a real
//      filter parameter against v3.openstates.org/openapi.json — see
//      LESSONS.md's Open States entry for this API's live-verification
//      status generally) and splits BILL_PAGES_TO_SAMPLE evenly between
//      them, sequentially, with the same inter-page backoff as before.
//      Total requests per run are unchanged; the House-heavy skew that
//      starved the Senate sample is gone by construction.
//   2. Vote events are now cached across runs (scripts/cache/
//      state-legislature-votes.json, committed like every other derived
//      artifact — see mergeVoteEventCache()/loadVoteEventCache()/
//      saveVoteEventCache() below) instead of discarded at the end of
//      each run. party-unity is computed from the accumulated cache, not
//      just this run's sample, so coverage only grows across the
//      scheduled refreshes in .github/workflows/refresh-state-legislature.yml
//      — a legislator who didn't appear in this week's sample keeps
//      whatever score last week's did find, rather than losing it.
//
// This does not guarantee 201/201 seats get a score on any given day —
// see the knownGaps note near MAX_CACHED_VOTE_EVENTS below for what's
// still an honest, disclosed gap rather than a silent truncation.
//
// Unlike every other layer in this app, state legislature data needs a
// free Open States API key (https://open.pluralpolicy.com/accounts/signup/)
// passed as OPEN_STATES_API_KEY.
//
// AGENTS.md §0.8 prefers bulk downloads over the keyed API ("Prefer bulk
// files over the keyed API"). This script does not yet ship a bulk-file
// ingest path — openstates/people's YAML-per-legislator bulk export on
// GitHub is the documented target (see FEATURES.md Phase 1) — and that
// gap is tracked here rather than silently worked around with the keyed
// API standing in as if it were the intended long-term source:
//
//   knownGaps: bulk-download ingest for MN roster data (openstates/people
//   on GitHub) is not implemented. The keyed v3 API below is used as an
//   interim source and should be replaced once a bulk-file loader lands.
//   The bill/vote sampling in fetchRecentVoteEvents() has no bulk
//   equivalent in the openstates/people export at all (it's roster-only,
//   not votes) and is expected to stay on the keyed API regardless.
//
// Every emitted record carries `verifiedAt`/`verifiedAgainst`
// (AGENTS.md §3.2) and the build fails loudly if `verifiedAt` predates
// the most recent MN state general election recorded in
// src/lib/electionConfig.ts. Run with `--self-test` to exercise the pure
// transform functions (buildFeature, computePartyUnity, the verification
// checks) against a small, clearly-labeled fixture instead of the live
// API — see scripts/fixtures/state-legislature-sample.json. The
// self-test never touches public/state-legislature.geojson and never
// presents its fixture output as real roster data.

import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MN_STATE_GENERAL_ELECTION_DATE,
  assertVerifiedSinceLastGeneralElection,
} from "../src/lib/electionConfig.ts";
import { simplifyAndRound, SIMPLIFY_TOLERANCE } from "./lib/geoSimplify.mjs";
import { updateDataManifest } from "./lib/dataManifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "../public/state-legislature.geojson");
const FIXTURE_PATH = path.join(__dirname, "fixtures/state-legislature-sample.json");
// Not under public/ — this is an ETL-intermediate accumulation cache, not
// a published artifact per AGENTS.md §2.1's registry contract, and never
// fetched by any client code. Committed to the repo (like public/legistar/
// *.json) so it survives across scheduled-workflow runs, not gitignored.
const VOTE_CACHE_PATH = path.join(__dirname, "cache/state-legislature-votes.json");

const SELF_TEST = process.argv.includes("--self-test");

// Source cited on every emitted record's `verifiedAgainst` — the Open
// States v3 people endpoint this script actually queries. Kept as one
// named constant rather than inlined per-record so the provenance string
// and the fetch URL below can't drift from each other.
const OPEN_STATES_PEOPLE_SOURCE = "https://v3.openstates.org/people?jurisdiction=Minnesota";

const OPEN_STATES_API_KEY = process.env.OPEN_STATES_API_KEY;
if (!SELF_TEST && !OPEN_STATES_API_KEY) {
  console.error("[fatal] OPEN_STATES_API_KEY environment variable is required.");
  console.error("Get a free key at https://open.pluralpolicy.com/accounts/signup/");
  console.error(
    "public/state-legislature.geojson is already committed from a prior run, so the app's " +
      "own build does not depend on this script running — see AGENTS.md §3.2. This failure " +
      "only blocks `npm run data:state-legislature` itself, not `npm run build`.",
  );
  console.error("Run with --self-test to exercise this script's logic against a fixture instead.");
  process.exit(1);
}

// Official district boundaries from the MN Legislature's own GIS office
// (Legislative Coordinating Commission), current since the 2022
// redistricting cycle — the same ArcGIS FeatureServer pattern used
// throughout this app for city/county boundaries.
const HOUSE_DISTRICTS_URL =
  "https://services2.arcgis.com/BLy9fHcJU1W8LU8M/arcgis/rest/services/house2022/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson";
const SENATE_DISTRICTS_URL =
  "https://services2.arcgis.com/BLy9fHcJU1W8LU8M/arcgis/rest/services/senate2022/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson";

const MINNEAPOLIS_CITY_HALL = [-93.2650683, 44.9773133];
const ST_PAUL_CITY_HALL = [-93.093173, 44.9439666];

const OPEN_STATES_BASE = "https://v3.openstates.org";

// How many pages of recently-updated MN bills (with vote data included) to
// sample when computing party-unity — enough to gather a real number of
// roll calls without over-using a free-tier API key. Split evenly across
// the two chambers by fetchRecentVoteEvents() below (see the header
// comment) rather than pulled from one combined list, so total requests
// per run are unchanged from before this pass.
const BILL_PAGES_TO_SAMPLE = 8;
const BILLS_PER_PAGE = 20;
const RECENT_VOTES_TO_KEEP = 5;
const QUALIFYING_OPTIONS = new Set(["yes", "no"]);
const CHAMBER_ORG_CLASSIFICATION = { house: "lower", senate: "upper" };

// Caps scripts/cache/state-legislature-votes.json's growth across runs.
// A two-year MN legislative biennium runs on the order of a few hundred
// recorded floor votes across both chambers combined; 300 is generous
// enough to accumulate toward full statewide coverage over a session
// (each floor vote's roll call lists nearly every member of that chamber
// at once — see the header comment's House/Senate confirmation) while
// keeping the file from growing without bound across years of scheduled
// refreshes. Eviction is oldest-by-date first (mergeVoteEventCache()),
// which only matters once accumulated coverage actually exceeds this cap.
//
//   knownGaps: a seat can still legitimately have no partyUnityPercent/
//   recentVotes — a brand-new legislator (special election) who hasn't
//   cast a qualifying vote yet, or one whose chamber simply hasn't held
//   a floor vote since the cache started accumulating. This is disclosed
//   in src/lib/coverage.ts's STATE_LEGISLATURE_NOTE and rendered as an
//   absent field, never a fabricated score (WardModal renders nothing
//   when partyUnityPercent/recentVotes are null/empty) — not a silent
//   truncation of statewide coverage, which is unconditional (201/201
//   seats always get a district, legislator name, and party).
const MAX_CACHED_VOTE_EVENTS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The bill+votes endpoint is rate-limited on a free-tier key tightly enough
// that a plain page-by-page loop trips it — retry 429s with backoff rather
// than fail the whole fetch over a transient limit.
async function fetchJson(url, headers = {}, attempt = 1) {
  const res = await fetch(url, { headers: { "User-Agent": "mn-civic-map-etl/0.1", ...headers } });
  if (res.status === 429 && attempt <= 5) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 2000;
    console.log(`[state-legislature] rate limited, waiting ${Math.round(delayMs / 1000)}s (attempt ${attempt})...`);
    await sleep(delayMs);
    return fetchJson(url, headers, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function openStatesFetch(pathAndQuery) {
  return fetchJson(`${OPEN_STATES_BASE}${pathAndQuery}`, { "X-API-KEY": OPEN_STATES_API_KEY });
}

function centroidOfFeature(feature) {
  const geom = feature.geometry;
  const polygons = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let sumLng = 0, sumLat = 0, count = 0;
  for (const rings of polygons) {
    for (const [lng, lat] of rings[0]) {
      sumLng += lng;
      sumLat += lat;
      count++;
    }
  }
  return [sumLng / count, sumLat / count];
}

// RepProperties.city (src/lib/types.ts) is a required string on every
// role, but nothing downstream actually reads it for state legislature
// records — WardMap.tsx filters/colors this layer by chamber and party,
// never city (see areaLabel() in WardModal.tsx, which reports "MN
// House"/"MN Senate" from `chamber` before it would ever fall back to
// this field). Now that districts are statewide, "nearest of Minneapolis
// or St. Paul" is a meaningless label for, say, a Duluth or Rochester
// seat — kept only to satisfy the shared type, not presented as a real
// geographic claim anywhere in the UI.
function nearestCity([lng, lat]) {
  const dMpls = Math.hypot(lng - MINNEAPOLIS_CITY_HALL[0], lat - MINNEAPOLIS_CITY_HALL[1]);
  const dStPaul = Math.hypot(lng - ST_PAUL_CITY_HALL[0], lat - ST_PAUL_CITY_HALL[1]);
  return dMpls <= dStPaul ? "Minneapolis" : "St. Paul";
}

// Both chambers' GIS DISTRICT field zero-pads single-digit districts
// ("02A", "01") where Open States doesn't ("2A", "1") — confirmed live
// against both sources, not assumed. This only matters for districts 1-9;
// 10 and up already match either way, which is exactly why the bug this
// fixes went unnoticed under the old Twin Cities-only filter (every
// metro district is numbered well above 9) and only surfaced once
// district fetching went statewide: house districts 01A-09B were coming
// back "Vacant" for 18 real, filled seats because the join key never
// matched, not because anyone actually left office.
function normalizeDistrictKey(raw, chamber) {
  const trimmed = String(raw).trim().toUpperCase();
  if (chamber === "senate") return String(Number(trimmed));
  return trimmed.replace(/^0+(\d)/, "$1"); // "02A" -> "2A", "10A" untouched
}

async function fetchDistricts(url, chamber) {
  console.log(`[state-legislature] fetching MN ${chamber} districts...`);
  const geojson = await fetchJson(url);
  console.log(`[state-legislature] MN ${chamber}: ${geojson.features.length} district(s) statewide`);
  return geojson.features;
}

async function fetchLegislators(chamber) {
  const orgClassification = chamber === "house" ? "lower" : "upper";
  console.log(`[state-legislature] fetching MN ${chamber} members...`);
  const results = [];
  for (let page = 1; ; page++) {
    const data = await openStatesFetch(
      `/people?jurisdiction=Minnesota&org_classification=${orgClassification}&per_page=50&page=${page}`,
    );
    results.push(...data.results);
    if (page >= data.pagination.max_page) break;
  }
  console.log(`[state-legislature] MN ${chamber}: ${results.length} member(s)`);
  return new Map(results.map((m) => [normalizeDistrictKey(m.current_role.district, chamber), m]));
}

// Only the fields computePartyUnity()/buildFeature() actually read are
// kept before a vote event is added to the in-memory list or the
// persistent cache — Open States' raw vote-event payload carries more
// per-voter fields (voter_name, chamber, etc.) that this app never uses
// and that would otherwise inflate scripts/cache/state-legislature-votes
// .json for no benefit.
function slimVoteEvent(event) {
  return {
    voteId: event.voteId,
    identifier: event.identifier,
    title: event.title,
    date: event.date,
    result: event.result,
    sourceUrl: event.sourceUrl,
    votes: event.votes.map((v) => ({
      option: v.option,
      voter: v.voter?.id ? { id: v.voter.id, party: v.voter.party ?? null } : null,
    })),
  };
}

// Collects every roll-call vote found on a sample of recently-updated MN
// bills for one chamber. Most bills never get a floor vote (they die in
// committee), so this pages through more bills than it expects to find
// votes on. Filtered to one chamber's bills via Open States' `chamber`
// parameter (confirmed present on /bills against v3.openstates.org/
// openapi.json — "filter by chamber of origination") specifically so a
// jurisdiction-wide `updated_desc` sample can't skew toward whichever
// chamber happens to have more bill activity on a given day and starve
// the other chamber's sample entirely — see the file header comment for
// the confirmed real-world case (House 133/134 scored, Senate 1/67) that
// motivated splitting this per chamber instead of sampling once overall.
async function fetchRecentVoteEventsForChamber(chamber, pageBudget) {
  const orgClassification = CHAMBER_ORG_CLASSIFICATION[chamber];
  console.log(`[state-legislature] sampling up to ${pageBudget * BILLS_PER_PAGE} recently-updated MN ${chamber} bills for roll-call votes...`);
  const voteEvents = [];
  for (let page = 1; page <= pageBudget; page++) {
    if (page > 1) await sleep(500); // spread requests out rather than lean entirely on 429 retries
    let data;
    try {
      data = await openStatesFetch(
        `/bills?jurisdiction=Minnesota&chamber=${orgClassification}&sort=updated_desc&per_page=${BILLS_PER_PAGE}&page=${page}&include=votes`,
      );
    } catch (err) {
      // This endpoint appears to carry a tighter quota than the rest of
      // the API — a free-tier key can exhaust it mid-run. Score whoever
      // was covered by the pages that did succeed rather than fail the
      // whole build over one endpoint's quota.
      console.warn(`[state-legislature] stopping ${chamber} vote sample early at page ${page}: ${err.message}`);
      break;
    }
    for (const bill of data.results) {
      for (const voteEvent of bill.votes ?? []) {
        if (!voteEvent.votes || voteEvent.votes.length === 0) continue;
        voteEvents.push(
          slimVoteEvent({
            voteId: voteEvent.id,
            identifier: bill.identifier,
            title: bill.title,
            date: voteEvent.start_date,
            result: voteEvent.result,
            sourceUrl: bill.openstates_url ?? null,
            votes: voteEvent.votes,
          }),
        );
      }
    }
    if (page >= data.pagination.max_page) break;
  }
  console.log(`[state-legislature] MN ${chamber}: found ${voteEvents.length} roll-call vote(s) in this run's sample`);
  return voteEvents;
}

// Splits the same total page budget this script has always used
// (BILL_PAGES_TO_SAMPLE) evenly across both chambers, sequentially — no
// increase in requests-per-run versus the single combined sample this
// replaced. Run sequentially (not Promise.all) so the two chambers' pages
// share the same gentle pacing as pages within a single chamber always
// have, rather than doubling instantaneous request concurrency.
async function fetchRecentVoteEvents() {
  const perChamberPages = Math.ceil(BILL_PAGES_TO_SAMPLE / 2);
  const houseEvents = await fetchRecentVoteEventsForChamber("house", perChamberPages);
  await sleep(500);
  const senateEvents = await fetchRecentVoteEventsForChamber("senate", perChamberPages);
  return [...houseEvents, ...senateEvents];
}

// scripts/cache/state-legislature-votes.json accumulates vote events
// across scheduled runs (see file header) instead of each run discarding
// its sample at exit. Missing/unreadable cache -> empty, same
// honest-empty-state posture as every other "build must succeed with no
// prior data" path in this app (AGENTS.md §0.8/§3.2) — a first run (or a
// fresh clone that never ran this script live) just starts accumulating
// from zero rather than failing.
async function loadVoteEventCache() {
  try {
    const raw = JSON.parse(await readFile(VOTE_CACHE_PATH, "utf8"));
    if (!Array.isArray(raw.voteEvents)) return [];
    return raw.voteEvents;
  } catch (err) {
    console.warn(`[state-legislature] no usable vote cache at ${VOTE_CACHE_PATH} (${err.message}) — starting from an empty cache.`);
    return [];
  }
}

// Fresh events win on a voteId collision (Open States could in principle
// re-report the same roll call with corrected data); otherwise every
// distinct voteId from either list survives. Sorted newest-first and
// capped at MAX_CACHED_VOTE_EVENTS so the file's growth is bounded — see
// that constant's own comment for why oldest-first eviction is an
// acceptable tradeoff here.
function mergeVoteEventCache(cachedEvents, freshEvents, maxSize = MAX_CACHED_VOTE_EVENTS) {
  const byId = new Map(cachedEvents.map((e) => [e.voteId, e]));
  for (const event of freshEvents) byId.set(event.voteId, event);
  return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, maxSize);
}

async function saveVoteEventCache(voteEvents, verifiedAt) {
  const payload = {
    schemaVersion: 1,
    updatedAt: verifiedAt,
    sourceNote: "Accumulated across scheduled runs of scripts/fetch-state-legislature.mjs — see that script's header comment.",
    voteEvents,
  };
  await mkdir(path.dirname(VOTE_CACHE_PATH), { recursive: true });
  await writeFile(VOTE_CACHE_PATH, JSON.stringify(payload));
}

// Party unity: for each roll call, find each party's majority yes/no
// position among members who actually voted yes or no. It only counts as
// a "party vote" once at least two parties show up with two different
// majority positions — a roll call every party agrees on says nothing
// about party loyalty. For a legislator's own tally, count how often
// their vote matched their own party's majority on those party votes.
// Every qualifying (yes/no) vote is also kept as a "recent vote" for
// display, whether or not it was a party vote.
function computePartyUnity(voteEvents) {
  const tally = new Map(); // person id -> { agree, total, votes: BillVote[] }

  for (const event of voteEvents) {
    const partyOptionCounts = new Map(); // party -> { yes, no }
    for (const v of event.votes) {
      if (!QUALIFYING_OPTIONS.has(v.option) || !v.voter?.party) continue;
      const counts = partyOptionCounts.get(v.voter.party) ?? { yes: 0, no: 0 };
      counts[v.option]++;
      partyOptionCounts.set(v.voter.party, counts);
    }
    const partyMajority = new Map();
    for (const [party, counts] of partyOptionCounts) {
      partyMajority.set(party, counts.yes >= counts.no ? "yes" : "no");
    }
    const isPartyVote = new Set(partyMajority.values()).size >= 2;

    for (const v of event.votes) {
      const person = v.voter;
      if (!person?.id) continue;
      if (!tally.has(person.id)) tally.set(person.id, { agree: 0, total: 0, votes: [] });
      const entry = tally.get(person.id);

      if (QUALIFYING_OPTIONS.has(v.option)) {
        entry.votes.push({
          voteId: event.voteId,
          identifier: event.identifier,
          title: event.title,
          option: v.option,
          result: event.result,
          date: event.date,
          sourceUrl: event.sourceUrl,
        });
      }
      if (!isPartyVote || !QUALIFYING_OPTIONS.has(v.option) || !person.party) continue;
      entry.total++;
      if (v.option === partyMajority.get(person.party)) entry.agree++;
    }
  }
  return tally;
}

function buildFeature(districtFeature, chamber, legislatorsByDistrict, partyUnityTally, verifiedAt) {
  const districtKey = normalizeDistrictKey(districtFeature.properties.DISTRICT, chamber);
  const member = legislatorsByDistrict.get(districtKey);
  const entry = member ? partyUnityTally.get(member.id) : undefined;
  const recentVotes = entry
    ? [...entry.votes].sort((a, b) => b.date.localeCompare(a.date)).slice(0, RECENT_VOTES_TO_KEEP)
    : [];

  return {
    type: "Feature",
    geometry: districtFeature.geometry,
    properties: {
      // AGENTS.md §3.2: every officeholder-sourced record carries its own
      // verifiedAt/verifiedAgainst. verifiedAt is this run's own fetch
      // date (never backdated); verifiedAgainst is the specific Open
      // States endpoint this member's data came from, so a downstream
      // consumer or a future UI staleness notice never has to guess.
      verifiedAt,
      verifiedAgainst: member?.openstates_url ?? OPEN_STATES_PEOPLE_SOURCE,
      role: chamber === "house" ? "State Representative" : "State Senator",
      // Best-effort label only — this layer's fill color is by party, not
      // city, since a district can straddle both or neither cleanly. Used
      // just for the pin ring color, matching every other role's pins.
      city: nearestCity(centroidOfFeature(districtFeature)),
      county: null,
      ward: null,
      wardName: null,
      district: null,
      stateDistrict: districtKey,
      chamber,
      repName: member?.name ?? null,
      repParty: member?.party ?? "Vacant",
      repPhotoUrl: member?.image || null,
      repEmail: member?.email || null,
      repPhone: null,
      // Open States doesn't expose a clean "first elected to this seat"
      // field — this is when Open States' own tracking of this person
      // began, a reasonable but unverified proxy (unlike the hand-checked
      // officeSince dates elsewhere in this app).
      officeSince: member?.created_at ? member.created_at.slice(0, 10) : "2023-01-01",
      committees: [],
      neighborhoods: [],
      officeRoom: null,
      profileUrl: member?.openstates_url ?? null,
      candidates: [],
      isContested: false,
      partyUnityPercent: entry && entry.total > 0 ? Math.round((entry.agree / entry.total) * 100) : null,
      recentVotes,
    },
  };
}

async function main() {
  const [houseDistricts, senateDistricts] = await Promise.all([
    fetchDistricts(HOUSE_DISTRICTS_URL, "house"),
    fetchDistricts(SENATE_DISTRICTS_URL, "senate"),
  ]);
  const [houseMembers, senateMembers] = await Promise.all([fetchLegislators("house"), fetchLegislators("senate")]);
  const freshVoteEvents = await fetchRecentVoteEvents();
  const cachedVoteEvents = await loadVoteEventCache();
  const voteEvents = mergeVoteEventCache(cachedVoteEvents, freshVoteEvents);
  console.log(
    `[state-legislature] vote cache: ${cachedVoteEvents.length} cached + ${freshVoteEvents.length} from this run's sample -> ${voteEvents.length} distinct roll call(s) after merge`,
  );
  const partyUnityTally = computePartyUnity(voteEvents);

  const featureCollection = buildFeatureCollection(
    houseDistricts,
    senateDistricts,
    houseMembers,
    senateMembers,
    partyUnityTally,
  );

  validateVerification(featureCollection);

  const scored = featureCollection.features.filter((f) => f.properties.partyUnityPercent !== null).length;
  console.log(`[state-legislature] ${scored} of ${featureCollection.features.length} district(s) got a party-unity score from this sample`);

  // Ingest-time geometry simplification — see scripts/lib/geoSimplify.mjs.
  // This is the layer issue #67 Finding 1 was actually filed over: raw
  // statewide ArcGIS output ran 15.2MB/5.4MB gzipped after #61 dropped the
  // old Twin Cities bounding-box filter, with zero simplification applied.
  const simplified = simplifyAndRound(featureCollection, {
    tolerance: SIMPLIFY_TOLERANCE.stateLegislature,
    label: "state-legislature",
  });
  const output = JSON.stringify(simplified);

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, output);
  await updateDataManifest(path.basename(OUTPUT_PATH), output);
  console.log(`[done] wrote ${simplified.features.length} state legislature district feature(s) to ${OUTPUT_PATH}`);

  // Persist the merged cache only after the geojson write above has
  // already succeeded — a run that fails earlier (bad district fetch, a
  // stale verifiedAt) leaves the cache exactly as the last successful run
  // left it, rather than committing a merge attached to output that never
  // shipped.
  await saveVoteEventCache(voteEvents, new Date().toISOString().slice(0, 10));
  console.log(`[state-legislature] wrote ${voteEvents.length} cached roll-call vote(s) to ${VOTE_CACHE_PATH}`);
}

// Shared between the live run and --self-test so both exercise the exact
// same assembly logic — the fixture path is a real test of this
// function, not a separate reimplementation of it.
function buildFeatureCollection(houseDistricts, senateDistricts, houseMembers, senateMembers, partyUnityTally) {
  const verifiedAt = new Date().toISOString().slice(0, 10);
  return {
    type: "FeatureCollection",
    features: [
      ...houseDistricts.map((f) => buildFeature(f, "house", houseMembers, partyUnityTally, verifiedAt)),
      ...senateDistricts.map((f) => buildFeature(f, "senate", senateMembers, partyUnityTally, verifiedAt)),
    ],
  };
}

// AGENTS.md §3.2: "Build fails, loudly, if any record's verifiedAt
// predates the most recent general election date recorded in config."
// Runs over every feature this script is about to write; a single stale
// record fails the whole run rather than shipping silently alongside
// fresh ones.
function validateVerification(featureCollection) {
  for (const feature of featureCollection.features) {
    const { stateDistrict, verifiedAt } = feature.properties;
    assertVerifiedSinceLastGeneralElection(
      verifiedAt,
      MN_STATE_GENERAL_ELECTION_DATE,
      `MN legislative district ${stateDistrict}`,
    );
  }
}

// --self-test: exercises buildFeatureCollection/validateVerification
// against scripts/fixtures/state-legislature-sample.json — a small,
// clearly-labeled, non-production fixture (see that file's own header) —
// instead of the live Open States API. Never writes to public/, never
// touches OUTPUT_PATH, and never claims its output is a real roster.
// This is the fixture-driven test path for a build/CI environment where
// OPEN_STATES_API_KEY and network access to Open States are both
// unavailable.
async function runSelfTest() {
  console.log(`[self-test] loading fixture from ${FIXTURE_PATH}`);
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  if (fixture.synthetic !== true) {
    throw new Error("[self-test] fixture is missing its required `synthetic: true` marker — refusing to use it.");
  }

  const houseMembers = new Map(
    fixture.legislators.filter((m) => m.chamber === "house").map((m) => [normalizeDistrictKey(m.current_role.district, "house"), m]),
  );
  const senateMembers = new Map(
    fixture.legislators.filter((m) => m.chamber === "senate").map((m) => [normalizeDistrictKey(m.current_role.district, "senate"), m]),
  );
  const partyUnityTally = computePartyUnity(fixture.voteEvents);

  const featureCollection = buildFeatureCollection(
    fixture.houseDistricts,
    fixture.senateDistricts,
    houseMembers,
    senateMembers,
    partyUnityTally,
  );
  validateVerification(featureCollection);

  const first = featureCollection.features[0];
  if (!first || typeof first.properties.verifiedAt !== "string" || typeof first.properties.verifiedAgainst !== "string") {
    throw new Error("[self-test] built feature is missing verifiedAt/verifiedAgainst.");
  }

  // Confirm the stale-election check actually fires on a record it should
  // reject, not just that it passes on fresh ones above.
  let threwOnStaleRecord = false;
  try {
    assertVerifiedSinceLastGeneralElection("2000-01-01", MN_STATE_GENERAL_ELECTION_DATE, "self-test fixture");
  } catch {
    threwOnStaleRecord = true;
  }
  if (!threwOnStaleRecord) {
    throw new Error("[self-test] assertVerifiedSinceLastGeneralElection did not reject an obviously stale date.");
  }

  // mergeVoteEventCache() is the cross-run accumulation this pass adds —
  // exercised here against the fixture's own vote event plus two
  // synthetic "prior run" events, never against the real committed cache
  // file (loadVoteEventCache/saveVoteEventCache are never called in
  // self-test mode).
  const priorCacheEvents = [
    { voteId: "fixture-vote-1", identifier: "STALE COPY", title: "should be replaced by the fresh version", date: "2020-01-01", result: "pass", sourceUrl: null, votes: [] },
    { voteId: "fixture-vote-prior-only", identifier: "FIXTURE HF 2", title: "only ever in the cache, never refetched", date: "2025-06-01", result: "pass", sourceUrl: null, votes: [] },
  ];
  const merged = mergeVoteEventCache(priorCacheEvents, fixture.voteEvents);
  const replaced = merged.find((e) => e.voteId === "fixture-vote-1");
  if (!replaced || replaced.identifier !== "FIXTURE HF 1") {
    throw new Error("[self-test] mergeVoteEventCache did not let a fresh event win over a stale cached one with the same voteId.");
  }
  if (!merged.some((e) => e.voteId === "fixture-vote-prior-only")) {
    throw new Error("[self-test] mergeVoteEventCache dropped a cache-only event that had no fresh counterpart.");
  }
  const capped = mergeVoteEventCache(priorCacheEvents, fixture.voteEvents, 1);
  if (capped.length !== 1) {
    throw new Error("[self-test] mergeVoteEventCache did not respect its maxSize cap.");
  }

  console.log(
    `[self-test] PASS — built ${featureCollection.features.length} fixture feature(s), verification fields present, ` +
      "stale-record check correctly rejects an old verifiedAt, mergeVoteEventCache dedupes/preserves/caps correctly.",
  );
}

if (SELF_TEST) {
  runSelfTest().catch((err) => {
    console.error("[fatal]", err);
    process.exit(1);
  });
} else {
  main().catch((err) => {
    console.error("[fatal]", err);
    process.exit(1);
  });
}
