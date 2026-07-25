#!/usr/bin/env node
// scripts/fetch-state-legislature.mjs
//
// Writes public/state-legislature.geojson — MN House + Senate districts
// covering the Twin Cities area, each joined to its current legislator
// (Open States) and a party-unity score computed from a sample of recent
// roll-call votes: the share of party-line votes where the legislator
// voted with their own party's majority. See computePartyUnity() below
// for the exact method.
//
// Unlike every other layer in this app, state legislature data needs a
// free Open States API key (https://open.pluralpolicy.com/accounts/signup/)
// passed as OPEN_STATES_API_KEY.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "../public/state-legislature.geojson");

const OPEN_STATES_API_KEY = process.env.OPEN_STATES_API_KEY;
if (!OPEN_STATES_API_KEY) {
  console.error("[fatal] OPEN_STATES_API_KEY environment variable is required.");
  console.error("Get a free key at https://open.pluralpolicy.com/accounts/signup/");
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

// House and Senate districts cover the whole state; this app only covers
// the Twin Cities. Rather than a precise polygon intersection, a bounding
// box roughly matching Hennepin + Ramsey counties (with a little buffer)
// is enough to keep only the districts that actually reach Minneapolis or
// St. Paul, the same "close enough for a display filter, not a legal
// determination" tradeoff used for the commissioner-pin centroids.
const TWIN_CITIES_BOUNDS = { minLng: -93.95, minLat: 44.7, maxLng: -92.85, maxLat: 45.25 };

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

function boundsContainPoint(bounds, [lng, lat]) {
  return lng >= bounds.minLng && lng <= bounds.maxLng && lat >= bounds.minLat && lat <= bounds.maxLat;
}

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
  const inTwinCities = geojson.features.filter((f) => boundsContainPoint(TWIN_CITIES_BOUNDS, centroidOfFeature(f)));
  console.log(`[state-legislature] MN ${chamber}: ${inTwinCities.length} of ${geojson.features.length} districts are in the Twin Cities area`);
  return inTwinCities;
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
          openstatesUrl: bill.openstates_url ?? null,
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
          openstatesUrl: event.openstatesUrl,
        });
      }
      if (!isPartyVote || !QUALIFYING_OPTIONS.has(v.option) || !person.party) continue;
      entry.total++;
      if (v.option === partyMajority.get(person.party)) entry.agree++;
    }
  }
  return tally;
}

function buildFeature(districtFeature, chamber, legislatorsByDistrict, partyUnityTally) {
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

  const featureCollection = {
    type: "FeatureCollection",
    features: [
      ...houseDistricts.map((f) => buildFeature(f, "house", houseMembers, partyUnityTally)),
      ...senateDistricts.map((f) => buildFeature(f, "senate", senateMembers, partyUnityTally)),
    ],
  };

  const scored = featureCollection.features.filter((f) => f.properties.partyUnityPercent !== null).length;
  console.log(`[state-legislature] ${scored} of ${featureCollection.features.length} district(s) got a party-unity score from this sample`);

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(featureCollection));
  console.log(`[done] wrote ${featureCollection.features.length} state legislature district feature(s) to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
