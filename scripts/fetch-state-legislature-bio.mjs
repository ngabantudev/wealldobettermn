#!/usr/bin/env node
// scripts/fetch-state-legislature-bio.mjs
//
// Enriches the *already-committed* public/state-legislature.geojson (see
// scripts/fetch-state-legislature.mjs) with the bio-page fields Open
// States does not expose at all: leadership title, Capitol office room,
// legislative assistant name/phone, committee chair/co-chair role (not
// just membership), term number, the elected-years sequence, and the
// district map/demographics PDF links. Every one of those is only on
// senate.mn and house.mn.gov's own member pages — this script is the
// "nightly scrape of senate.mn and house.mn for the bio fields nobody
// exposes" half of the two-source design; fetch-state-legislature.mjs
// remains the live spine for identity/roster/votes.
//
// Deliberately a separate ingest script rather than folded into
// fetch-state-legislature.mjs's own main(): it has its own upstream (two
// unkeyed government websites, not Open States), its own failure domain
// (a senate.mn/house.mn markup change breaks this script, not the roster
// fetch that resolves address -> representative), and — usefully — no
// API key requirement at all, so its own refresh workflow needs no
// secret. Run *after* `npm run data:state-legislature` in any pipeline
// that wants both: this script reads the district/chamber/party list
// already written to public/state-legislature.geojson rather than
// re-deriving it, and skips any district that geojson reports Vacant
// (nothing to scrape a bio page for).
//
// No stable crosswalk file is checked in separately; each run re-derives
// district -> mem_id (Senate) / -> legid (House) from these same two
// sites' own bulk listings and prints it as part of its own log output.
// The join key is the district identifier both major sources already
// agree on (senate.mn/house.mn's own numbering matches Open States' and
// the ArcGIS district layer's, once normalizeDistrictKey-style padding is
// handled) — the same district-string join
// scripts/fetch-state-legislature.mjs already relies on, not a separate
// person-id crosswalk that could drift out of sync on its own schedule.
//
// AGENTS.md §2.2 "Good-Citizen Fetcher": identifies itself with a
// descriptive User-Agent, paces requests with a fixed delay between
// hits (one bio page per legislator — roughly 200, across two sites),
// and retries a failed fetch a few times with backoff rather than
// failing the whole run over one legislator's page. A page that never
// succeeds is skipped (logged, not fabricated) rather than blocking
// every other legislator's real data — see AGENTS.md §3.3 "Missing
// Sources: never fabricate or infer."
//
// AGENTS.md §3.2: every enriched record's verifiedAt/verifiedAgainst is
// refreshed as part of this run (see mergeBio()) and re-validated against
// the same election-date gate fetch-state-legislature.mjs uses.
//
// Run with --self-test to exercise buildBioRecord()/mergeBio() against a
// small, clearly-labeled fixture instead of the live sites — see
// scripts/fixtures/state-legislature-bio-sample.json. Never touches
// public/state-legislature.geojson.

import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MN_STATE_GENERAL_ELECTION_DATE,
  assertVerifiedSinceLastGeneralElection,
} from "../src/lib/electionConfig.ts";
import { updateDataManifest } from "./lib/dataManifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEOJSON_PATH = path.join(__dirname, "../public/state-legislature.geojson");
const FIXTURE_PATH = path.join(__dirname, "fixtures/state-legislature-bio-sample.json");

const SELF_TEST = process.argv.includes("--self-test");

const SENATE_MEMBERS_API = "https://www.senate.mn/api/members";
const SENATE_BIO_URL = (memId) => `https://www.senate.mn/members/member_bio.html?mem_id=${memId}`;
const HOUSE_LIST_URL = "https://www.house.mn.gov/members/list";
const HOUSE_PROFILE_URL = (legid) => `https://www.house.mn.gov/members/profile/${legid}`;

const REQUEST_DELAY_MS = 350; // spread ~200 sequential bio-page fetches across two sites politely
const MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Mirrors fetch-state-legislature.mjs's fetchJson() politeness/retry
// shape, but returns HTML text — these two sites are plain server-
// rendered pages, not a JSON API (Senate's /api/members bulk endpoint is
// the one exception, fetched with this same helper).
async function fetchText(url, attempt = 1) {
  let res;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": "mn-civic-map-etl/0.1 (+https://github.com/; civic transparency project, MN legislator bios)",
      },
    });
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) throw err;
    await sleep(attempt * 1000);
    return fetchText(url, attempt + 1);
  }
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= MAX_ATTEMPTS) throw new Error(`HTTP ${res.status} for ${url} after ${attempt} attempts`);
    const retryAfter = Number(res.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 2000;
    await sleep(delayMs);
    return fetchText(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

// The exact zero-padding gotcha fetch-state-legislature.mjs's own
// normalizeDistrictKey() documents at length, and independently
// confirmed live here too: senate.mn's /api/members "dist" field is
// zero-padded for single-digit districts ("01".."09"), and
// house.mn.gov's /members/list embeds House codes the same way ("09A",
// not "9A") — neither matches this app's already-normalized
// stateDistrict ("1", "9A") stored in state-legislature.geojson. Same
// fix as the main script's: strip a single leading zero before the first
// digit. Applied uniformly (not chamber-branched like the main script's
// version) since it's a no-op on values that were never padded.
function normalizeDistrictKey(raw) {
  return String(raw).trim().toUpperCase().replace(/^0+(\d)/, "$1");
}

// --- Senate ------------------------------------------------------------

async function fetchSenateCrosswalk() {
  console.log("[state-legislature-bio] fetching Senate member list (bulk API)...");
  const res = await fetch(SENATE_MEMBERS_API, {
    headers: { "User-Agent": "mn-civic-map-etl/0.1" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${SENATE_MEMBERS_API}`);
  const data = await res.json();
  const byDistrict = new Map();
  for (const m of data.members ?? []) {
    byDistrict.set(normalizeDistrictKey(m.dist), m);
  }
  console.log(`[state-legislature-bio] Senate: ${byDistrict.size} member(s) in bulk list`);
  return byDistrict;
}

// "Majority Member"/"Minority Member" is every rank-and-file senator's
// baseline leader_title in the bulk API — real caucus membership, not a
// distinguished leadership role. Only a title outside that pair (e.g.
// "Assistant Majority Leader", "President of the Senate", "Minority
// Leader") is worth surfacing as `leadershipTitle`.
const SENATE_BASELINE_TITLES = new Set(["Majority Member", "Minority Member", null, undefined, ""]);

function senateLeadershipTitle(bulkRecord) {
  const title = bulkRecord?.leader_title;
  return SENATE_BASELINE_TITLES.has(title) ? null : title;
}

function senateOfficeRoom(bulkRecord) {
  const lines = [bulkRecord?.office_address_first_line, bulkRecord?.office_address_second_line].filter(Boolean);
  return lines.length > 0 ? lines.join(", ") : null;
}

// Parses one senate.mn member_bio.html page for the fields the bulk API
// doesn't carry: legislative assistant, committee assignments (with
// chair/co-chair role), term/elected-years, and the district map/
// demographics PDF links. Regex-based, not a full HTML parser — matches
// the "dependency-light ETL" bias (AGENTS.md §0.8) the rest of this
// repo's fetch-*.mjs scripts already follow; confirmed against a live
// page (mem_id=1213) before writing these patterns, not guessed.
function parseSenateBio(html, memId) {
  const laMatch = html.match(/<strong>Legislative Assistant:<\/strong>\s*([^<]*?)\s*(?:<!--.*?)?<\/li>/s);
  let legislativeAssistant = null;
  if (laMatch) {
    const raw = laMatch[1].replace(/\s+/g, " ").trim();
    const phoneMatch = raw.match(/(\d{3}-\d{3}-\d{4})\s*$/);
    if (phoneMatch) {
      legislativeAssistant = { name: raw.slice(0, phoneMatch.index).trim(), phone: phoneMatch[1] };
    } else if (raw) {
      legislativeAssistant = { name: raw, phone: null };
    }
  }

  const committeesBlock = html.match(/<h4>Committee Assignments:<\/h4>([\s\S]*?)<\/ul>/);
  const committees = [];
  if (committeesBlock) {
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
    let li;
    while ((li = liRe.exec(committeesBlock[1])) !== null) {
      const roleMatch = li[1].match(/<strong>([^<]+)<\/strong>/);
      const nameMatch = li[1].match(/<a[^>]*>([^<]+)<\/a>/);
      if (!nameMatch) continue;
      committees.push({
        role: roleMatch ? roleMatch[1].trim() : null,
        name: nameMatch[1].trim(),
      });
    }
  }

  const electedMatch = html.match(/<strong>Elected:<\/strong>\s*([^<]*?)\s*<\/(?:td|li)>/);
  const termMatch = html.match(/<strong>Term:<\/strong>\s*([^<]*?)\s*<\/(?:td|li)>/);
  // <a and href= land on separate lines in senate.mn's markup ("<a\n
  // href=\"...\">District\nMap</a>") — confirmed live (mem_id=1213) —
  // hence \s+ between <a and href, unlike the single-line House markup
  // below.
  const mapMatch = html.match(/<a\s+href="([^"]+)">District\s*Map<\/a>/);
  const demoMatch = html.match(/<a\s+href="([^"]+)">\s*District \d+[A-Z]? Demographic Details\s*<\/a>/);

  return {
    sourceUrl: SENATE_BIO_URL(memId),
    legislativeAssistant,
    committees,
    electedYears: electedMatch ? electedMatch[1].replace(/\s+/g, " ").trim() : null,
    termNumber: termMatch ? termMatch[1].replace(/\s+/g, " ").trim() : null,
    districtMapUrl: mapMatch ? mapMatch[1] : null,
    districtDemographicsUrl: demoMatch ? demoMatch[1] : null,
  };
}

// --- House ---------------------------------------------------------------

// /members/list repeats every member 2-3 times (alphabetical, by-district,
// by-party sections) with identical office/phone/email each time — bulk,
// one fetch, deduped by legid below — but carries no committee, LA,
// leadership, or term data at all, hence the per-member profile fetch
// this script still does for every House member (parseHouseProfile()).
async function fetchHouseCrosswalk() {
  console.log("[state-legislature-bio] fetching House member list...");
  const html = await fetchText(HOUSE_LIST_URL);
  const byDistrict = new Map();
  const re = /href="\/members\/profile\/(\d+)">\s*<b>[^(]*\(([0-9A-Z]+),\s*[A-Z]+\)<\/b>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (byDistrict.has(normalizeDistrictKey(m[2]))) continue; // already captured from an earlier repeated section
    // The phone number is the only office-contact field this crosswalk
    // bothers to capture (repPhone is a shared RepProperties field the UI
    // already renders for every role) — room/address text is re-derived
    // per-member from the profile page instead, in parseHouseProfile(),
    // since that page's own <span> markup is already being parsed there
    // for other fields.
    const windowText = html.slice(m.index, m.index + 600);
    const phoneMatch = windowText.match(/(\d{3}-\d{3}-\d{4})/);
    byDistrict.set(normalizeDistrictKey(m[2]), { legid: m[1], phone: phoneMatch ? phoneMatch[1] : null });
  }
  console.log(`[state-legislature-bio] House: ${byDistrict.size} member(s) in list`);
  return byDistrict;
}

function parseHouseProfile(html, legid) {
  // The name/leadership h5 pair sits inside div.media-body; the second
  // one (if present at all) is a leadership title, never a second name —
  // confirmed against a leadership page (Torkelson, legid 15304,
  // "Assistant Republican Leader") and a rank-and-file page (Acomb, no
  // second h5) before writing this.
  const h5s = [...html.matchAll(/<h5 class="mt-0[^"]*">([\s\S]*?)<\/h5>/g)].map((mm) =>
    mm[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
  );
  const leadershipTitle = h5s.length > 1 && h5s[1] && !h5s[1].startsWith("(") ? h5s[1] : null;

  const roomMatch = html.match(/<span>([^<]*(?:Floor|Building)[^<]*)<\/span>/);

  const laBlock = html.match(/<strong>Legislative Assistant:<\/strong>([\s\S]*?)<\/ul>/);
  let legislativeAssistant = null;
  if (laBlock) {
    const nameMatch = laBlock[1].match(/<strong>Name:<\/strong>\s*([^<]*)/);
    const phoneMatch = laBlock[1].match(/<strong>Phone:<\/strong>\s*([^<]*)/);
    const name = nameMatch ? nameMatch[1].replace(/\s+/g, " ").trim() : "";
    if (name) {
      legislativeAssistant = {
        name,
        phone: phoneMatch ? phoneMatch[1].replace(/\s+/g, " ").trim() || null : null,
      };
    }
  }

  const committeesBlock = html.match(/<h4>Committee Assignments:<\/h4>([\s\S]*?)<\/ul>/);
  const committees = [];
  if (committeesBlock) {
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
    let li;
    while ((li = liRe.exec(committeesBlock[1])) !== null) {
      const roleMatch = li[1].match(/<strong>([^<]+)<\/strong>/);
      const nameMatch = li[1].match(/<a[^>]*>([^<]+)<\/a>/);
      if (!nameMatch) continue;
      committees.push({
        role: roleMatch ? roleMatch[1].trim() : null,
        name: nameMatch[1].replace(/\s+/g, " ").trim(),
      });
    }
  }

  const electedMatch = html.match(/<strong>Elected:<\/strong>\s*([^<]*?)\s*<\/li>/);
  const termMatch = html.match(/<strong>Term:<\/strong>\s*([^<]*?)\s*<\/li>/);
  const mapMatch = html.match(/<a href="([^"]+)">District Map<\/a>/);
  const demoMatch = html.match(/<a href="([^"]+)">District Demographics<\/a>/);

  return {
    sourceUrl: HOUSE_PROFILE_URL(legid),
    leadershipTitle,
    officeRoom: roomMatch ? roomMatch[1].trim() : null,
    legislativeAssistant,
    committees,
    electedYears: electedMatch ? electedMatch[1].replace(/\s+/g, " ").trim() : null,
    termNumber: termMatch ? termMatch[1].replace(/\s+/g, " ").trim() : null,
    districtMapUrl: mapMatch ? mapMatch[1] : null,
    districtDemographicsUrl: demoMatch ? demoMatch[1] : null,
  };
}

// --- shared merge/format ---------------------------------------------------

// RepProperties.committees (src/lib/types.ts) is a plain string[], shared
// by every role WardModal.tsx renders — not worth widening into an
// object shape for this one role when the existing UI already renders
// this field as-is. Role is folded into the string instead ("Chair —
// Environment, Climate, and Legacy") so a real committee chairship is
// visible without any WardModal.tsx change. See RepProperties'
// legislativeAssistant/leadershipTitle/etc. fields for where the richer,
// state-legislature-only data actually lives.
function formatCommittee(entry) {
  return entry.role ? `${entry.role} — ${entry.name}` : entry.name;
}

// Applies one legislator's scraped bio fields onto their already-built
// state-legislature.geojson Feature.properties, refreshing
// verifiedAt/verifiedAgainst to this run's own values (AGENTS.md §3.2 —
// this is itself a fresh verification against a primary source, not a
// copy of the roster fetch's verification). Pure function, shared by the
// live path and --self-test, same pattern as
// fetch-state-legislature.mjs's buildFeatureCollection().
function mergeBio(properties, bio, verifiedAt) {
  return {
    ...properties,
    officeRoom: bio.officeRoom ?? properties.officeRoom,
    repPhone: bio.repPhone ?? properties.repPhone,
    committees: bio.committees.length > 0 ? bio.committees.map(formatCommittee) : properties.committees,
    leadershipTitle: bio.leadershipTitle ?? null,
    legislativeAssistant: bio.legislativeAssistant ?? null,
    termNumber: bio.termNumber ?? null,
    electedYears: bio.electedYears ?? null,
    districtMapUrl: bio.districtMapUrl ?? null,
    districtDemographicsUrl: bio.districtDemographicsUrl ?? null,
    verifiedAt,
    verifiedAgainst: bio.sourceUrl,
  };
}

function validateVerification(featureCollection) {
  for (const feature of featureCollection.features) {
    const { stateDistrict, verifiedAt } = feature.properties;
    if (!verifiedAt) continue; // untouched (no bio page found) — leave for the roster fetch's own gate
    assertVerifiedSinceLastGeneralElection(
      verifiedAt,
      MN_STATE_GENERAL_ELECTION_DATE,
      `MN legislative district ${stateDistrict} (bio enrichment)`,
    );
  }
}

async function main() {
  console.log(`[state-legislature-bio] loading ${GEOJSON_PATH}...`);
  let featureCollection;
  try {
    featureCollection = JSON.parse(await readFile(GEOJSON_PATH, "utf8"));
  } catch (err) {
    console.error(
      `[fatal] could not read ${GEOJSON_PATH} — run \`npm run data:state-legislature\` first. ` +
        "This script enriches that file's output; it does not fetch the roster itself.",
    );
    throw err;
  }

  const [senateCrosswalk, houseCrosswalk] = await Promise.all([fetchSenateCrosswalk(), fetchHouseCrosswalk()]);
  const verifiedAt = new Date().toISOString().slice(0, 10);

  let enriched = 0;
  let skippedVacant = 0;
  let skippedNoMatch = 0;
  let skippedFetchFailed = 0;

  for (const feature of featureCollection.features) {
    const props = feature.properties;
    if (!props.repName || props.repParty === "Vacant") {
      skippedVacant++;
      continue;
    }

    const districtKey = normalizeDistrictKey(props.stateDistrict);
    if (props.chamber === "senate") {
      const bulk = senateCrosswalk.get(districtKey);
      if (!bulk) {
        skippedNoMatch++;
        continue;
      }
      await sleep(REQUEST_DELAY_MS);
      let html;
      try {
        html = await fetchText(SENATE_BIO_URL(bulk.mem_id));
      } catch (err) {
        console.warn(`[state-legislature-bio] senate district ${districtKey}: ${err.message}`);
        skippedFetchFailed++;
        continue;
      }
      const bio = parseSenateBio(html, bulk.mem_id);
      bio.leadershipTitle = senateLeadershipTitle(bulk);
      bio.officeRoom = senateOfficeRoom(bulk);
      bio.repPhone = bulk.full_phone_number ?? null;
      feature.properties = mergeBio(props, bio, verifiedAt);
      enriched++;
    } else if (props.chamber === "house") {
      const entry = houseCrosswalk.get(districtKey);
      if (!entry) {
        skippedNoMatch++;
        continue;
      }
      await sleep(REQUEST_DELAY_MS);
      let html;
      try {
        html = await fetchText(HOUSE_PROFILE_URL(entry.legid));
      } catch (err) {
        console.warn(`[state-legislature-bio] house district ${districtKey}: ${err.message}`);
        skippedFetchFailed++;
        continue;
      }
      const bio = parseHouseProfile(html, entry.legid);
      bio.repPhone = entry.phone ?? null;
      feature.properties = mergeBio(props, bio, verifiedAt);
      enriched++;
    }
  }

  console.log(
    `[state-legislature-bio] enriched ${enriched} district(s); skipped ${skippedVacant} vacant, ` +
      `${skippedNoMatch} with no crosswalk match, ${skippedFetchFailed} on fetch failure`,
  );

  validateVerification(featureCollection);

  const output = JSON.stringify(featureCollection);
  await writeFile(GEOJSON_PATH, output);
  await updateDataManifest(path.basename(GEOJSON_PATH), output);
  console.log(`[done] wrote enriched ${GEOJSON_PATH}`);
}

// --self-test: exercises parseSenateBio/parseHouseProfile/mergeBio
// against scripts/fixtures/state-legislature-bio-sample.json's saved
// HTML snippets instead of live senate.mn/house.mn — never touches
// public/state-legislature.geojson.
async function runSelfTest() {
  console.log(`[self-test] loading fixture from ${FIXTURE_PATH}`);
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  if (fixture.synthetic !== true) {
    throw new Error("[self-test] fixture is missing its required `synthetic: true` marker — refusing to use it.");
  }

  const senateBio = parseSenateBio(fixture.senateBioHtml, "9999");
  if (senateBio.committees.length !== 2 || senateBio.committees[0].role !== "Chair") {
    throw new Error("[self-test] parseSenateBio did not extract the expected committee chair role.");
  }
  if (!senateBio.legislativeAssistant || senateBio.legislativeAssistant.name !== "Fixture Assistant") {
    throw new Error("[self-test] parseSenateBio did not extract the legislative assistant name.");
  }
  if (senateBio.termNumber !== "2nd") {
    throw new Error("[self-test] parseSenateBio did not extract the term number.");
  }

  const houseBio = parseHouseProfile(fixture.houseProfileHtml, "9998");
  if (houseBio.leadershipTitle !== "Fixture Assistant Leader") {
    throw new Error("[self-test] parseHouseProfile did not extract the leadership title.");
  }
  if (houseBio.committees.length !== 1 || houseBio.committees[0].role !== "Co-Chair") {
    throw new Error("[self-test] parseHouseProfile did not extract the expected committee co-chair role.");
  }
  if (!houseBio.legislativeAssistant || houseBio.legislativeAssistant.phone !== "651-296-0000") {
    throw new Error("[self-test] parseHouseProfile did not extract the legislative assistant phone.");
  }

  senateBio.repPhone = "651-296-0001";
  const merged = mergeBio(
    { officeRoom: null, repPhone: null, committees: [], repName: "Fixture Legislator", repParty: "Fixture Party" },
    senateBio,
    "2026-01-01",
  );
  if (!merged.verifiedAt || !merged.verifiedAgainst) {
    throw new Error("[self-test] mergeBio did not set verifiedAt/verifiedAgainst.");
  }
  if (merged.repPhone !== "651-296-0001") {
    throw new Error("[self-test] mergeBio did not carry repPhone through.");
  }
  if (merged.committees[0] !== "Chair — Fixture Environment Committee") {
    throw new Error("[self-test] mergeBio did not fold committee role into the formatted string.");
  }

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
    "[self-test] PASS — parseSenateBio/parseHouseProfile extract LA/committee-role/term/leadership fields, " +
      "mergeBio sets verification fields and folds committee role into the formatted string, " +
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
