#!/usr/bin/env node
// scripts/fetch-commissioners.mjs
//
// Writes public/commissioners.geojson — county board districts for the two
// counties the app's cities sit in (Hennepin ~ Minneapolis, Ramsey ~
// St. Paul). These are a genuinely different government layer than city
// wards: county-wide, not city-wide, so the districts extend well past
// each city's own border into the surrounding suburbs. WardMap renders
// them as an alternate mode rather than overlaid on wards, since the two
// don't nest and would just look like visual noise stacked together.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { union } from "@turf/union";
import { featureCollection } from "@turf/helpers";
import { recentVotesFromLegistar } from "./lib/legistarRecentVotes.mjs";
import { simplifyAndRound, SIMPLIFY_TOLERANCE } from "./lib/geoSimplify.mjs";
import { updateDataManifest } from "./lib/dataManifest.mjs";
import { fetchJson } from "./lib/fetchJson.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "../public/commissioners.geojson");

// County offices are nonpartisan by state statute (Minn. Stat. 204B.06
// subd. 6 defines "nonpartisan offices" to include all county offices) —
// confirmed against the statute rather than assumed, same as the city
// council/mayor data. A commissioner's own bio page mentioning party
// organizing work (several do) is personal background, not a ballot line.
const NONPARTISAN = "Nonpartisan";

// --- Ramsey County (~ St. Paul) ------------------------------------------
//
// Ramsey's own ArcGIS layer already carries each commissioner's name,
// phone, email, and profile URL — no separate roster needed, unlike every
// other data source this app uses. Photos and office-since dates below are
// hand-transcribed from each commissioner's own profile page (linked in
// the source data's Web field) since the layer itself doesn't carry them.
const RAMSEY_DISTRICTS_URL =
  "https://gis.ramseycountymn.gov/server/rest/services/Boundary/BOUND_CommissionerDistrict2022_ViewOnly/FeatureServer/25/query?where=1%3D1&outFields=*&f=geojson";

// Full photo URLs, not a shared base path — each was uploaded to Ramsey's
// asset host under a different date-stamped (or "migrated-files") folder,
// so there's no common prefix to factor out.
const RAMSEY_EXTRAS = {
  1: { photo: "https://assets.ramseycountymn.gov/files/2025-08/Tara%20Jebens-Singh%20200x250.jpg", termStart: "2025-01-01", committees: [] },
  2: { photo: "https://assets.ramseycountymn.gov/files/2026-02/Mary-Jo-McGuire-2026-200x250_0.jpg", termStart: "2012-01-01", committees: ["Chair, Legislative Committee", "Vice Chair, Budget and Audit Committee"] },
  3: { photo: "https://assets.ramseycountymn.gov/files/2025-08/Garrison-McMurtrey-200x250.jpg", termStart: "2025-02-01", committees: [] },
  4: { photo: "https://assets.ramseycountymn.gov/files/2025-08/Rena-Moran-200x250.jpg", termStart: "2022-01-01", committees: ["Chair, Economic Growth and Community Investment Committee", "Vice Chair, Budget Committee"] },
  5: { photo: "https://assets.ramseycountymn.gov/files/2025-08/Rafael-Ortega-200x250.jpg", termStart: "1994-01-01", committees: ["Chair, Ramsey County Board", "Chair, Regional Rail Authority"] },
  6: { photo: "https://assets.ramseycountymn.gov/files/migrated-files/Mai-Chong-Xiong-200x250.jpg", termStart: "2023-01-01", committees: ["Vice Chair, Ramsey County Board"] },
  7: { photo: "https://assets.ramseycountymn.gov/files/2025-08/Kelly-Miller-200x250.jpg", termStart: "2025-01-01", committees: [] },
};

// --- Hennepin County (~ Minneapolis) --------------------------------------
//
// Hennepin's layer carries only a district number (NAME_TXT) — everything
// else is hand-transcribed from each commissioner's page at
// hennepincounty.gov/government/leadership/board-of-commissioners/district-N.
// Unlike the city councils this app covers, Hennepin's board has staggered
// terms (districts 2/3/4 elect together, 1/5/6/7 elect together on the
// opposite 4-year cadence) confirmed by cross-checking each member's stated
// term info — so termStart is genuinely per-member, not one shared date.
// Districts 4 and 6 didn't state an exact first-elected date on their own
// page; those two are the cycle-implied best estimate, not confirmed —
// termStart is null for both per issue #96, not the guessed date this file
// used to carry. District 3's own comment below flags a similar problem:
// the stated date is her first-ever-elected year, not her current (3rd)
// term's start, so it's null too rather than misrepresenting which term it
// describes.
const HENNEPIN_DISTRICTS_URL =
  "https://gis.hennepin.us/arcgis/rest/services/HennepinData/BOUNDARIES/MapServer/0/query?where=1%3D1&outFields=*&f=geojson";
const HENNEPIN_PHOTO_BASE = "https://www.hennepincounty.gov/-/media/Hennepin-Headless/Hennepin-Gov/government/leadership/board/";

const HENNEPIN_COMMISSIONERS = {
  1: {
    name: "Jeffrey Lunde",
    photo: "dist-1/jeffrey-lunde-620x465.jpg",
    termStart: "2020-01-01",
    committees: ["Chair, Law, Safety and Justice Committee", "Chair, Hennepin Healthcare System Board"],
  },
  2: {
    name: "Irene Fernando",
    photo: "dist-2/irene-fernando-620x465.jpg",
    termStart: "2019-01-01", // elected Nov 2018
    committees: ["Chair, Hennepin County Board", "Chair, Municipal Building Commission"],
  },
  3: {
    name: "Marion Greene",
    photo: "dist-3/marion-greene-620x465.jpg",
    // 2014 is her first-ever-elected date, not her current (3rd) term's
    // start (that began 2022 at this district's 4-year cadence) — null per
    // issue #96 rather than carrying forward a date that describes the
    // wrong term.
    termStart: null,
    committees: ["Chair, Regional Railroad Authority"],
  },
  4: {
    name: "Angela Conley",
    photo: "dist-4/angela-conley-620x465.jpg",
    termStart: null, // best estimate only: same election cycle as districts 2/3, not confirmed
    committees: ["Chair, Health Committee", "Chair, Housing and Redevelopment Authority"],
  },
  5: {
    name: "Debbie Goettel",
    photo: "dist-5/debbie-goettel-620x465.jpg",
    termStart: "2017-01-01", // elected Nov 2016
    committees: ["Vice Chair, Hennepin County Board", "Chair, Administration, Operations and Budget Committee"],
  },
  6: {
    name: "Heather Edelson",
    photo: "dist-6/heather-edelson-620x465.jpg",
    termStart: null, // best estimate only: opposite cycle from districts 2/3/4, not confirmed
    committees: ["Chair, Human Services Committee", "Chair, Resident Services Committee"],
  },
  7: {
    name: "Kevin Anderson",
    photo: "dist-7/kevin-anderson-620x465.jpg",
    termStart: "2021-01-01", // took office 2021, off the regular even-year cycle (likely a special election)
    committees: ["Chair, Hennepin Health", "Chair, Public Works Committee"],
  },
};

async function fetchRamseyDistricts() {
  console.log("[commissioners] fetching Ramsey County...");
  const geojson = await fetchJson(RAMSEY_DISTRICTS_URL, { logLabel: "commissioners" });
  const features = (geojson.features ?? []).map((feature) => {
    const props = feature.properties ?? {};
    const districtNum = Number(props.District);
    const extra = RAMSEY_EXTRAS[districtNum] ?? { photo: null, termStart: null, committees: [] };
    const profileUrl = props.Web ?? null;
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        role: "County Commissioner",
        city: "St. Paul",
        county: "Ramsey County",
        ward: null,
        wardName: null,
        district: districtNum,
        stateDistrict: null,
        chamber: null,
        repName: props.Name ?? null,
        repParty: NONPARTISAN,
        repPhotoUrl: extra.photo,
        repEmail: props.Email ?? null,
        repPhone: props.Phone ?? null,
        termsOfService: [{ termStart: extra.termStart ?? null, termEnd: null, current: true, sourceUrl: profileUrl }],
        committees: extra.committees,
        neighborhoods: [],
        officeRoom: null,
        profileUrl,
        // No source for candidate filings is wired up yet — empty rather
        // than guessed, since a civic-transparency app is the last place
        // that should show made-up election data. isContested mirrors
        // candidates.length >= 2 and must be kept in sync with it here.
        candidates: [],
        isContested: false,
        partyUnityPercent: null,
        recentVotes: [],
      },
    };
  });
  console.log(`[commissioners] Ramsey County: ${features.length} district(s)`);
  return features;
}

async function fetchHennepinDistricts() {
  console.log("[commissioners] fetching Hennepin County...");
  const geojson = await fetchJson(HENNEPIN_DISTRICTS_URL, { logLabel: "commissioners" });
  const features = (geojson.features ?? []).map((feature) => {
    const props = feature.properties ?? {};
    const districtNum = Number(props.NAME_TXT);
    const info = HENNEPIN_COMMISSIONERS[districtNum];
    const profileUrl = `https://www.hennepincounty.gov/government/leadership/board-of-commissioners/district-${districtNum}`;
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        role: "County Commissioner",
        city: "Minneapolis",
        county: "Hennepin County",
        ward: null,
        wardName: null,
        district: districtNum,
        stateDistrict: null,
        chamber: null,
        repName: info?.name ?? null,
        repParty: NONPARTISAN,
        repPhotoUrl: info?.photo ? `${HENNEPIN_PHOTO_BASE}${info.photo}` : null,
        repEmail: null,
        repPhone: null,
        termsOfService: [{ termStart: info?.termStart ?? null, termEnd: null, current: true, sourceUrl: profileUrl }],
        committees: info?.committees ?? [],
        neighborhoods: [],
        officeRoom: null,
        profileUrl,
        // No source for candidate filings is wired up yet — empty rather
        // than guessed, since a civic-transparency app is the last place
        // that should show made-up election data. isContested mirrors
        // candidates.length >= 2 and must be kept in sync with it here.
        candidates: [],
        isContested: false,
        partyUnityPercent: null,
        // Hennepin is a known Legistar client (webapi.legistar.com/v1/
        // hennepinmn) — see #57. Surname-matched against public/legistar/
        // hennepinmn.json's own already-resolved holding→vote records; []
        // (the honest gap note, not an error) for a name that doesn't
        // resolve. Ramsey County (below) has no known Legistar client, so
        // it isn't wired up here — stays on the same honest gap note.
        recentVotes: info ? recentVotesFromLegistar("hennepinmn", info.name) : [],
      },
    };
  });
  console.log(`[commissioners] Hennepin County: ${features.length} district(s)`);
  return features;
}

// --- Olmsted County (~ Rochester) ------------------------------------------
//
// Top-20-by-population batch (2026-08) — the first non-metro county this
// app covers a commissioner layer for (see the COUNTIES comment in
// src/lib/cities.ts). Olmsted's own GIS carries district geometry only
// (DISTRICT field, no roster) — same shape as Hennepin above — via the
// "Political_Administrative" MapServer's Commissioner Districts layer
// (id 4), the same server Rochester's own wards already come from (see
// fetch-wards.mjs). Roster hand-transcribed from OLMSTED_PROFILE_URL
// (fetched 2026-08-08); the page states no email or phone for any member,
// only a per-member photo and a link to the county's general "Contact Us."
const OLMSTED_DISTRICTS_URL =
  "https://public.gis.olmstedcounty.gov/arcgis/rest/services/Political_Administrative/MapServer/4/query?where=1%3D1&outFields=DISTRICT&f=geojson";
const OLMSTED_PROFILE_URL = "https://www.olmstedcounty.gov/government/county-boards-commissions/board-of-commissioners";
const OLMSTED_PHOTO_BASE = "https://www.olmstedcounty.gov";
const OLMSTED_COMMISSIONERS = {
  1: { name: "Laurel Podulke-Smith", photo: "/sites/default/files/styles/pod/public/2026-01/Laurel%20Podulke-Smith-2026.jpg.webp" },
  2: { name: "David Senjem", photo: "/sites/default/files/styles/pod/public/2026-01/Dave%20Senjem%20-%202%20-%202026.jpg.webp" },
  3: { name: "Gregg Wright", photo: "/sites/default/files/styles/pod/public/2026-01/Gregory%20Wright.jpg.webp" },
  4: { name: "Brian Mueller", photo: "/sites/default/files/styles/pod/public/2023-01/BrianMueller2023.jpg.webp" },
  5: { name: "Michelle Rossman", photo: "/sites/default/files/styles/pod/public/2026-01/Michelle%20Rossman%20-%202026.jpg.webp" },
  6: { name: "Bob Hopkins", photo: "/sites/default/files/styles/pod/public/2024-12/Bob%20Hopkins_0.jpg.webp" },
  7: { name: "Mark Thein", photo: "/sites/default/files/styles/pod/public/2024-12/Mark%20Thein.jpg.webp" },
};

async function fetchOlmstedDistricts() {
  console.log("[commissioners] fetching Olmsted County...");
  const geojson = await fetchJson(OLMSTED_DISTRICTS_URL, { logLabel: "commissioners" });
  const features = (geojson.features ?? []).map((feature) => {
    const districtNum = Number(feature.properties?.DISTRICT);
    const info = OLMSTED_COMMISSIONERS[districtNum];
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        role: "County Commissioner",
        city: "Rochester",
        county: "Olmsted County",
        ward: null,
        wardName: null,
        district: districtNum,
        stateDistrict: null,
        chamber: null,
        repName: info?.name ?? null,
        repParty: NONPARTISAN,
        repPhotoUrl: info?.photo ? `${OLMSTED_PHOTO_BASE}${info.photo}` : null,
        repEmail: null,
        repPhone: null,
        termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: OLMSTED_PROFILE_URL }],
        committees: [],
        neighborhoods: [],
        officeRoom: null,
        profileUrl: OLMSTED_PROFILE_URL,
        candidates: [],
        isContested: false,
        partyUnityPercent: null,
        recentVotes: [],
      },
    };
  });
  console.log(`[commissioners] Olmsted County: ${features.length} district(s)`);
  return features;
}

// --- St. Louis County (~ Duluth) --------------------------------------------
//
// Same batch as Olmsted above. St. Louis County's own GIS layer already
// carries each commissioner's name/phone/email directly on the district
// polygon (REPNAME1/Phone/Email — same embedded-roster shape as Ramsey
// County's layer, per this file's own comment above), so no hand-
// transcribed roster is needed — confirmed live 2026-08-08. The layer
// carries no photo field and none was separately sourced, so repPhotoUrl
// is null.
const ST_LOUIS_DISTRICTS_URL =
  "https://gis.stlouiscountymn.gov/server2/rest/services/GeneralUse/Open_Data/MapServer/21/query?where=1%3D1&outFields=*&f=geojson";
const ST_LOUIS_PROFILE_URL = "https://www.stlouiscountymn.gov/our-county/board-of-commissioners";

async function fetchStLouisDistricts() {
  console.log("[commissioners] fetching St. Louis County...");
  const geojson = await fetchJson(ST_LOUIS_DISTRICTS_URL, { logLabel: "commissioners" });
  const features = (geojson.features ?? []).map((feature) => {
    const props = feature.properties ?? {};
    const districtNum = Number(props.DISTRICTID);
    // One observed record carries a trailing space on its own email value
    // ("haralaa@stlouiscountymn.gov ") — trimmed rather than republished
    // with the source's own stray whitespace baked in.
    const email = typeof props.Email === "string" ? props.Email.trim() : null;
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        role: "County Commissioner",
        city: "Duluth",
        county: "St. Louis County",
        ward: null,
        wardName: null,
        district: districtNum,
        stateDistrict: null,
        chamber: null,
        repName: props.REPNAME1 ?? null,
        repParty: NONPARTISAN,
        repPhotoUrl: null,
        repEmail: email || null,
        repPhone: props.Phone ?? null,
        termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: ST_LOUIS_PROFILE_URL }],
        committees: [],
        neighborhoods: [],
        officeRoom: null,
        profileUrl: ST_LOUIS_PROFILE_URL,
        candidates: [],
        isContested: false,
        partyUnityPercent: null,
        recentVotes: [],
      },
    };
  });
  console.log(`[commissioners] St. Louis County: ${features.length} district(s)`);
  return features;
}

// --- Stearns County (~ St. Cloud) -------------------------------------------
//
// Same batch as Olmsted/St. Louis above. Stearns County's own GIS publishes
// commissioner districts only as a *precinct* layer (COMM_DIST attribute,
// several precincts per district) — the same "Elections/
// ElectionsRedistricting" server St. Cloud's own wards pull precincts from
// (see fetch-wards.mjs) — dissolved the same way Rochester's wards and
// Anoka County's suburbs are.
//
// KNOWN GAP: every commissioner's name is unconfirmed as of 2026-08-08.
// stearnscountymn.gov serves its Board of Commissioners roster client-side
// (JS-rendered) — every fetch attempt against the board page and each
// individual district page returned only navigation chrome, no commissioner
// content, not routed around per AGENTS.md §2.2. Search-indexed snippets
// only weakly corroborate 2 of 5 names (not primary-sourced, not citable),
// and District 4 may have an unresolved vacancy per a 2026 special-election
// reference — not good enough to publish per AGENTS.md §3.3's "never
// fabricate or infer; leave null, record the gap." repName is null for all
// 5 districts pending a primary-sourced roster; geometry and county
// grouping are real and correct regardless.
const STEARNS_PRECINCTS_URL =
  "https://gis.co.stearns.mn.us/arcgis/rest/services/Elections/ElectionsRedistricting/MapServer/39/query?where=1%3D1&outFields=COMM_DIST&f=geojson";
const STEARNS_PROFILE_URL = "https://www.stearnscountymn.gov/907/Board-of-Commissioners";

async function fetchStearnsDistricts() {
  console.log("[commissioners] fetching Stearns County...");
  const geojson = await fetchJson(STEARNS_PRECINCTS_URL, { logLabel: "commissioners" });

  const precinctsByDistrict = new Map();
  for (const feature of geojson.features ?? []) {
    const districtNum = Number(feature.properties?.COMM_DIST);
    if (!Number.isFinite(districtNum)) continue;
    if (!precinctsByDistrict.has(districtNum)) precinctsByDistrict.set(districtNum, []);
    precinctsByDistrict.get(districtNum).push(feature);
  }

  const features = [];
  for (const [districtNum, precincts] of precinctsByDistrict) {
    const dissolved = precincts.length === 1 ? precincts[0] : union(featureCollection(precincts));
    if (!dissolved) {
      console.warn(`[commissioners] Stearns district ${districtNum}: union() returned null, skipping`);
      continue;
    }
    features.push({
      type: "Feature",
      geometry: dissolved.geometry,
      properties: {
        role: "County Commissioner",
        city: "St. Cloud",
        county: "Stearns County",
        ward: null,
        wardName: null,
        district: districtNum,
        stateDistrict: null,
        chamber: null,
        // KNOWN GAP — see this section's header comment. Never a guess.
        repName: null,
        repParty: NONPARTISAN,
        repPhotoUrl: null,
        repEmail: null,
        repPhone: null,
        termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: STEARNS_PROFILE_URL }],
        committees: [],
        neighborhoods: [],
        officeRoom: null,
        profileUrl: STEARNS_PROFILE_URL,
        candidates: [],
        isContested: false,
        partyUnityPercent: null,
        recentVotes: [],
      },
    });
  }
  console.log(`[commissioners] Stearns County: ${features.length} district(s) (roster: KNOWN GAP, see header comment)`);
  return features;
}

// --- Sherburne County (~ St. Cloud) -----------------------------------------
//
// Same batch as Stearns above — one of St. Cloud's other two counties (see
// the COUNTIES comment in src/lib/cities.ts). Sherburne's own GIS layer
// already carries each commissioner's name/phone/email/profile-URL
// directly on the district polygon (REPNAME/PhoneNumber/EmailAddress/
// DISTRICTURL) — confirmed live 2026-08-08, no hand-transcribed roster
// needed.
const SHERBURNE_DISTRICTS_URL =
  "https://gis.co.sherburne.mn.us/arcgis4/rest/services/OpenData/Commissioner_Districts/FeatureServer/5/query?where=1%3D1&outFields=*&f=geojson";
const SHERBURNE_PROFILE_URL = "https://www.co.sherburne.mn.us/573/Board-of-Commissioners";

async function fetchSherburneDistricts() {
  console.log("[commissioners] fetching Sherburne County...");
  const geojson = await fetchJson(SHERBURNE_DISTRICTS_URL, { logLabel: "commissioners" });
  const features = (geojson.features ?? []).map((feature) => {
    const props = feature.properties ?? {};
    const districtNum = Number(props.DISTRICTID);
    const profileUrl = props.DISTRICTURL ?? SHERBURNE_PROFILE_URL;
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        role: "County Commissioner",
        city: "St. Cloud",
        county: "Sherburne County",
        ward: null,
        wardName: null,
        district: districtNum,
        stateDistrict: null,
        chamber: null,
        repName: props.REPNAME ?? null,
        repParty: NONPARTISAN,
        repPhotoUrl: null,
        repEmail: props.EmailAddress ?? null,
        repPhone: props.PhoneNumber ? String(props.PhoneNumber) : null,
        termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: profileUrl }],
        committees: [],
        neighborhoods: [],
        officeRoom: null,
        profileUrl,
        candidates: [],
        isContested: false,
        partyUnityPercent: null,
        recentVotes: [],
      },
    };
  });
  console.log(`[commissioners] Sherburne County: ${features.length} district(s)`);
  return features;
}

// --- Benton County (~ St. Cloud) --------------------------------------------
//
// Same batch as Sherburne above — St. Cloud's third county. Benton's own
// GIS layer already carries each commissioner's name/email/term-expiration
// directly on the district polygon (Commissioner/Email/TermExpires) —
// confirmed live 2026-08-08. Unlike Sherburne's layer, this one carries no
// phone field, so repPhone is null rather than guessed. TermExpires is
// published as "MM/YYYY" (no day) — the day is filled in as the 1st of
// that month, same "state the year, fill the unstated day" convention
// fetch-mayors.mjs's Eagan entries already use for a termStart known only
// to the year.
const BENTON_DISTRICTS_URL =
  "https://services.arcgis.com/cHtpFLI4WlqULV8k/arcgis/rest/services/CommissionerMap_WFL1/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson";
const BENTON_PROFILE_URL = "https://www.co.benton.mn.us/381/County-Board";

function parseBentonTermExpires(value) {
  const match = typeof value === "string" ? value.match(/^(\d{2})\/(\d{4})$/) : null;
  return match ? `${match[2]}-${match[1]}-01` : null;
}

async function fetchBentonDistricts() {
  console.log("[commissioners] fetching Benton County...");
  const geojson = await fetchJson(BENTON_DISTRICTS_URL, { logLabel: "commissioners" });
  const features = (geojson.features ?? []).map((feature) => {
    const props = feature.properties ?? {};
    const districtNum = Number(String(props.DistrictNumber ?? "").replace(/\D/g, ""));
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        role: "County Commissioner",
        city: "St. Cloud",
        county: "Benton County",
        ward: null,
        wardName: null,
        district: Number.isFinite(districtNum) && districtNum > 0 ? districtNum : null,
        stateDistrict: null,
        chamber: null,
        repName: props.Commissioner ?? null,
        repParty: NONPARTISAN,
        repPhotoUrl: null,
        repEmail: props.Email ?? null,
        repPhone: null,
        termsOfService: [{ termStart: null, termEnd: parseBentonTermExpires(props.TermExpires), current: true, sourceUrl: BENTON_PROFILE_URL }],
        committees: [],
        neighborhoods: [],
        officeRoom: null,
        profileUrl: BENTON_PROFILE_URL,
        candidates: [],
        isContested: false,
        partyUnityPercent: null,
        recentVotes: [],
      },
    };
  });
  console.log(`[commissioners] Benton County: ${features.length} district(s)`);
  return features;
}

async function main() {
  const [ramsey, hennepin, olmsted, stLouis, stearns, sherburne, benton] = await Promise.all([
    fetchRamseyDistricts(),
    fetchHennepinDistricts(),
    fetchOlmstedDistricts(),
    fetchStLouisDistricts(),
    fetchStearnsDistricts(),
    fetchSherburneDistricts(),
    fetchBentonDistricts(),
  ]);
  // Named outputCollection, not featureCollection — shadowing the
  // @turf/helpers import of the same name (needed by fetchStearnsDistricts'
  // own dissolve) would still work correctly here, but reads as if it might
  // be calling the imported function when it's really just a local object.
  // Same naming fix fetch-wards.mjs already made for its own union() use.
  const outputCollection = {
    type: "FeatureCollection",
    features: [...hennepin, ...ramsey, ...olmsted, ...stLouis, ...stearns, ...sherburne, ...benton],
  };

  // Ingest-time geometry simplification — see scripts/lib/geoSimplify.mjs
  // and issue #67 Finding 1.
  const simplified = simplifyAndRound(outputCollection, {
    tolerance: SIMPLIFY_TOLERANCE.commissioners,
    label: "commissioners",
  });
  const output = JSON.stringify(simplified);

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, output);
  await updateDataManifest(path.basename(OUTPUT_PATH), output);
  console.log(`[done] wrote ${simplified.features.length} commissioner district feature(s) to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
