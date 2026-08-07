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
// Statewide since #15's follow-up: this script used to filter districts
// down to a Twin Cities bounding box (TWIN_CITIES_BOUNDS/
// boundsContainPoint, now removed) even though fetchLegislators() and
// fetchRecentVoteEvents() below were already querying Open States for
// all of Minnesota, unfiltered — the geographic filter only ever
// discarded districts after they'd already been fetched. Removing it
// costs no extra API calls; see src/lib/coverage.ts's
// STATE_LEGISLATURE_NOTE, which used to describe this same bounding box
// and has been updated to match.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "../public/state-legislature.geojson");
const FIXTURE_PATH = path.join(__dirname, "fixtures/state-legislature-sample.json");

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
// roll calls without over-using a free-tier API key.
const BILL_PAGES_TO_SAMPLE = 8;
const BILLS_PER_PAGE = 20;
const RECENT_VOTES_TO_KEEP = 5;
const QUALIFYING_OPTIONS = new Set(["yes", "no"]);

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

// House districts are alphanumeric ("47B") and already match Open States'
// district field exactly. Senate districts are zero-padded ("01") in the
// GIS data but not in Open States ("1") — normalize both to the same key.
function normalizeDistrictKey(raw, chamber) {
  const trimmed = String(raw).trim().toUpperCase();
  return chamber === "senate" ? String(Number(trimmed)) : trimmed;
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

// Collects every roll-call vote found on a sample of recently-updated MN
// bills. Most bills never get a floor vote (they die in committee), so
// this pages through more bills than it expects to find votes on.
async function fetchRecentVoteEvents() {
  console.log(`[state-legislature] sampling ${BILL_PAGES_TO_SAMPLE * BILLS_PER_PAGE} recent MN bills for roll-call votes...`);
  const voteEvents = [];
  for (let page = 1; page <= BILL_PAGES_TO_SAMPLE; page++) {
    if (page > 1) await sleep(500); // spread requests out rather than lean entirely on 429 retries
    let data;
    try {
      data = await openStatesFetch(
        `/bills?jurisdiction=Minnesota&sort=updated_desc&per_page=${BILLS_PER_PAGE}&page=${page}&include=votes`,
      );
    } catch (err) {
      // This endpoint appears to carry a tighter quota than the rest of
      // the API — a free-tier key can exhaust it mid-run. Score whoever
      // was covered by the pages that did succeed rather than fail the
      // whole build over one endpoint's quota.
      console.warn(`[state-legislature] stopping vote sample early at page ${page}: ${err.message}`);
      break;
    }
    for (const bill of data.results) {
      for (const voteEvent of bill.votes ?? []) {
        if (!voteEvent.votes || voteEvent.votes.length === 0) continue;
        voteEvents.push({
          voteId: voteEvent.id,
          identifier: bill.identifier,
          title: bill.title,
          date: voteEvent.start_date,
          result: voteEvent.result,
          sourceUrl: bill.openstates_url ?? null,
          votes: voteEvent.votes,
        });
      }
    }
    if (page >= data.pagination.max_page) break;
  }
  console.log(`[state-legislature] found ${voteEvents.length} roll-call vote(s)`);
  return voteEvents;
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
  const voteEvents = await fetchRecentVoteEvents();
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

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(featureCollection));
  console.log(`[done] wrote ${featureCollection.features.length} state legislature district feature(s) to ${OUTPUT_PATH}`);
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

  console.log(
    `[self-test] PASS — built ${featureCollection.features.length} fixture feature(s), verification fields present, ` +
      "stale-record check correctly rejects an old verifiedAt.",
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
