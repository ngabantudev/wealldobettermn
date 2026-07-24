#!/usr/bin/env node
// scripts/fetch-wards.mjs
//
// Pulls current ward boundaries + council member info from each city's own
// open-data portal and writes one combined FeatureCollection to
// public/wards.geojson (served as a static asset, fetched client-side by
// the map component). Re-run this periodically (council rosters change
// after every municipal election) — it always re-fetches live, never reads
// the previous output.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "../public/wards.geojson");

// Neither city's council race carries a party label — Minnesota municipal
// elections are nonpartisan by charter — confirmed by reading every one of
// both cities' own councilmember bio pages below (linked per-ward) rather
// than assumed: none state a party, so "Nonpartisan" is the accurate
// value, not a stand-in for missing data.
const NONPARTISAN = "Nonpartisan";

// --- St. Paul -----------------------------------------------------------
//
// St. Paul's ArcGIS feature service returns rep name/email/phone/photo
// directly on each ward polygon. Committees/neighborhoods/office room
// below are hand-transcribed from each member's own bio page at
// stpaul.gov/department/city-council/ward-N (ward 7's URL is the one
// exception: ward-7-cheniqua-johnson) — re-check those pages after an
// election, since this council is entirely re-elected on one citywide
// cycle and turnover can be total.
const ST_PAUL_WARDS_URL =
  "https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/Council_Ward_/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson";

// Current term runs Jan 2024-Dec 2027 for all 7 seats (citywide cycle).
const ST_PAUL_TERM_START = "2024-01-01";
// Ward 6 is the one exception found on the bio pages: Nelsie Yang has
// served continuously since her original swearing-in, not just the term
// that began with everyone else's in 2024.
const ST_PAUL_OFFICE_SINCE_OVERRIDES = {
  6: "2020-01-01",
};
const ST_PAUL_OFFICE_ROOM = {
  1: "Room 310-A, City Hall",
  2: "Room 310-B, City Hall",
  3: "Room 310-C, City Hall",
  4: "Room 310-D, City Hall",
  5: "Room 320-A, City Hall",
  6: "Room 320-B, City Hall",
  7: "Room 320-C, City Hall",
};
const ST_PAUL_COMMITTEES = {
  1: ["Chair, Public Safety Committee", "Vice Chair, Library Board"],
  2: ["President of the City Council", "Chair, Council Operations Committee", "Chair, Policy Committee", "Chair, Audit Committee"],
  3: ["Chair, Library Board", "Vice Chair, Housing and Redevelopment Authority"],
  4: ["Vice Chair, Public Safety Committee", "Vice Chair, Audit Committee"],
  5: ["Council Vice President (2024-2026)"],
  6: ["Council Vice President", "Vice Chair, Budget Committee", "Vice Chair, Council Operations Committee"],
  7: ["Chair, Housing and Redevelopment Authority", "Chair, Budget Committee", "Vice Chair, Policy Committee"],
};
// Every ward's bio page is /ward-N except Ward 7, whose slug includes the
// member's name.
const ST_PAUL_PROFILE_SLUG = {
  7: "ward-7-cheniqua-johnson",
};
const ST_PAUL_NEIGHBORHOODS = {
  1: ["Thomas-Dale (Frogtown)", "Summit-University", "North End", "Lexington-Hamline"],
  2: ["West 7th Street", "West Side", "Summit Hill", "Railroad Island", "Lowertown", "Downtown"],
  3: ["Highland Park", "Macalester-Groveland", "West End"],
  4: ["Hamline-Midway", "Merriam Park", "Saint Anthony Park", "Como"],
  5: ["Como", "Payne-Phalen", "North End"],
  6: ["Frost Lake", "Hayden Heights", "Hazel Park", "Payne-Phalen", "Phalen Village", "Prosperity Heights"],
  7: ["Dayton's Bluff", "Battle Creek", "Conway", "Mounds Park", "Swede Hollow"],
};

// --- Minneapolis ----------------------------------------------------------
//
// Minneapolis's ward polygons only carry a ward number (BDNUM) — no rep
// fields at all — so everything below is hand-transcribed from each
// member's own page at minneapolismn.gov/government/city-council/members/
// ward-N/. Re-check after an election; names change every 4 years and
// this covers the term that began January 2026.
const MINNEAPOLIS_WARDS_URL =
  "https://hub.arcgis.com/datasets/cityoflakes::city-council-wards.geojson";
const MINNEAPOLIS_TERM_START = "2026-01-01";
const MINNEAPOLIS_OFFICE_ROOM = "Room 370, City Hall";
const MINNEAPOLIS_PHOTO_BASE =
  "https://www.minneapolismn.gov/media/-www-content-assets/images/headshots/";

const MINNEAPOLIS_ROSTER = {
  1: "Elliott Payne",
  2: "Robin Wonsley",
  3: "Michael Rainville",
  4: "LaTrisha Vetaw",
  5: "Pearll Warren",
  6: "Jamal Osman",
  7: "Elizabeth Shaffer",
  8: "Soren Stevenson",
  9: "Jason Chavez",
  10: "Aisha Chughtai",
  11: "Jamison Whiting",
  12: "Aurin Chowdhury",
  13: "Linea Palmisano",
};

const MINNEAPOLIS_PHOTOS = {
  1: "Council-President-Elliott-Payne.jpg",
  2: "Ward-2-Robin-Wonsley.jpg",
  3: "Ward-3-Michael-Rainville.jpg",
  4: "Ward-4-LaTrisha-Vetaw.jpg",
  5: "Ward-5-Pearll-Warren.jpg",
  6: "Ward-6-Jamal-Osman.jpg",
  7: "Ward-7-Elizabeth-Shaffer.jpg",
  8: "Ward-8-Soren-Stevenson.jpg",
  9: "Ward-9-Jason-Chavez.jpg",
  10: "Ward-10-Aisha-Chughtai.jpg",
  11: "Ward-11-Jamison-Whiting.jpg",
  12: "Ward-12-Aurin-Chowdhury.jpg",
  13: "Ward-13-Linea-Palmisano.jpg",
};

// Members serving continuously since before the current 2026-2029 term.
// Where the bio page states only an election year (not an exact swearing-
// in date), this uses January 1 of the following year as an approximation
// (Minnesota's regular cycle seats winners the January after a November
// election) — flagged per entry since two special-election seats (6, 12)
// may be off by a few months. Wards not listed here either started with
// the current term (elected 2025) or didn't state a date on their page,
// so they fall back to MINNEAPOLIS_TERM_START.
const MINNEAPOLIS_OFFICE_SINCE_OVERRIDES = {
  1: "2022-01-01", // Payne, first elected 2021
  3: "2022-01-01", // Rainville, first elected 2021
  6: "2020-01-01", // Osman, won a 2020 special election — exact date unconfirmed
  9: "2022-01-01", // Chavez, first elected 2021
  10: "2022-01-01", // Chughtai, first elected 2021
  12: "2023-01-01", // Chowdhury, first elected 2023 (off-cycle/special) — exact date unconfirmed
  13: "2014-01-01", // Palmisano, first elected 2013
};

const MINNEAPOLIS_COMMITTEES = {
  1: ["Council President"],
  6: ["Council Vice-President"],
};

const MINNEAPOLIS_NEIGHBORHOODS = {
  1: ["Audubon Park", "Bottineau", "Columbia Park", "Como", "Holland", "Logan Park", "Northeast Park", "Waite Park", "Windom Park"],
  2: ["Cedar Riverside", "Como", "Marcy Holmes", "Prospect Park", "Seward", "University of Minnesota"],
  3: ["Downtown East", "Downtown West", "Marcy Holmes", "North Loop", "Nicollet Island", "St. Anthony East", "St. Anthony West"],
  4: ["Camden Industrial", "Cleveland", "Folwell", "Jordan", "Lind-Bohanon", "McKinley", "Victory", "Webber-Camden", "Willard-Hay"],
  5: ["Harrison", "Hawthorne", "Jordan", "Near-North", "North Loop", "Sumner-Glenwood", "Willard-Hay"],
  6: ["Cedar Riverside", "Elliot Park", "Phillips West", "Seward", "Stevens Square-Loring Heights", "Ventura Village"],
  7: ["Bryn Mawr", "Cedar-Isles-Dean", "Downtown West", "East Isles", "Kenwood", "Linden Hills", "Loring Park", "Lowry Hill"],
  8: ["Bancroft", "Bryant", "Central", "Field", "King Field", "Lyndale", "Northrop", "Regina"],
  9: ["Central", "Corcoran", "East Phillips", "Midtown Phillips", "Howe", "Longfellow", "Powderhorn Park"],
  10: ["East Bde Maka Ska", "East Isles", "Lowry Hill East", "South Uptown", "Whittier"],
  11: ["Diamond Lake", "Field", "Hale", "Keewaydin", "Northrop", "Page", "Tangletown", "Wenonah", "Windom"],
  12: ["Cooper", "Ericsson", "Hiawatha", "Howe", "Keewaydin", "Minnehaha", "Morris Park", "Standish"],
  13: ["Armatage", "East Harriet", "Fulton", "Kenny", "Linden Hills", "Lynnhurst"],
};

// --- Metro suburbs (pilot) -------------------------------------------------
//
// Five of these six share one GIS source: Hennepin County's own "Ward
// Districts" layer (the same MapServer this app already pulls commissioner
// districts from — see fetch-commissioners.mjs), filtered by MUNIC_NAME.
// Unlike St. Paul's feature service, this layer carries only a ward number —
// no rep info — so every roster below is hand-transcribed from each city's
// own council page, same as Minneapolis. Re-check after each city's next
// municipal election (most run on MN's regular odd-year cycle, but not all
// on the same odd year — see each city's own "since" comments below).
//
// Most Twin Cities suburbs are fully at-large (elect their whole council
// citywide, no wards) — confirmed by checking ~20 of the largest before
// picking these six, the only ones both (a) elect by ward and (b) have a
// sourceable GIS boundary + roster. Each of these cities also elects 1-2
// at-large council seats alongside its ward seats; those aren't covered
// here since there's no ward polygon to anchor a pin to (same reason mayors
// use a City Hall point instead of a boundary) — a possible follow-up, not
// this pilot.
const HENNEPIN_WARDS_URL = "https://gis.hennepin.us/arcgis/rest/services/HennepinData/BOUNDARIES/MapServer/11/query";

// None of these five cities' own sites state an exact "first elected/took
// office" date (only term-*expiration* dates) — every date below is a
// secondary-sourced best effort (Ballotpedia, local news, or the member's
// own campaign site), cross-checked but not primary-sourced, same caveat
// Hennepin County's own commissioner data already carries for districts 4/6
// in fetch-commissioners.mjs.

const BLOOMINGTON_PROFILE_URL = "https://www.bloomingtonmn.gov/cc/city-councilmembers-and-district-maps";
const BLOOMINGTON_ROSTER = {
  1: { name: "Dwayne Lowman", email: "dlowman@BloomingtonMN.gov", phone: "952-270-2377", photo: "https://www.bloomingtonmn.gov/sites/default/files/styles/240x336/public/2026-02/Lowman-Dwayne-2026.jpg?h=59969086&itok=PB1EelDt", officeSince: "2013-01-01" },
  2: { name: "Shawn Nelson", email: "snelson@BloomingtonMN.gov", phone: "952-479-0471", photo: "https://www.bloomingtonmn.gov/sites/default/files/styles/240x336/public/2026-02/Nelson-Shawn-2026.jpg?h=59969086&itok=c44_JY5w", officeSince: "2017-01-01" },
  3: { name: "Lona Dallessandro", email: "LDallessandro@BloomingtonMN.gov", phone: "612-231-6824", photo: "https://www.bloomingtonmn.gov/sites/default/files/styles/240x336/public/2026-02/Dallessandro-Lona-2026.jpg?h=59969086&itok=YmLq0W4U", officeSince: "2021-01-01" },
  4: { name: "Victor Rivas", email: "vrivas@bloomingtonmn.gov", phone: "651-247-5199", photo: "https://www.bloomingtonmn.gov/sites/default/files/styles/240x336/public/2026-02/Rivas-Victor-2026.jpg?h=59969086&itok=tEn3ybvl", officeSince: "2024-01-02" },
};

const PLYMOUTH_PROFILE_URL = "https://www.plymouthmn.gov/departments/city-council/city-council-members";
const PLYMOUTH_ROSTER = {
  1: { name: "Kimberly Nelson", email: "knelson@plymouthmn.gov", phone: "763-509-5001", photo: "https://www.plymouthmn.gov/home/showpublishedimage/12998/638775647365700000", officeSince: "2024-03-01" },
  2: { name: "Julie Peterson", email: "jpeterson@plymouthmn.gov", phone: "763-509-5002", photo: "https://www.plymouthmn.gov/home/showpublishedimage/12996/638775647645630000", officeSince: "2023-01-01" },
  3: { name: "Scott Aldrich", email: "saldrich@plymouthmn.gov", phone: "763-509-5003", photo: "https://www.plymouthmn.gov/home/showpublishedimage/13000/638775647154170000", officeSince: "2025-01-14" },
  // The city's own <img alt> text spells this "Julie Pointer," but the page
  // heading and her official email both use "Pointner" — used here as the
  // correct spelling.
  4: { name: "Julie Pointner", email: "jpointner@plymouthmn.gov", phone: "763-509-5004", photo: "https://www.plymouthmn.gov/home/showpublishedimage/11569/638134355229800000", officeSince: "2019-01-01" },
};

// Unlike Bloomington/Plymouth, each of these three cities' wards has its
// own individual profile page rather than one shared directory page.
const MINNETONKA_ROSTER = {
  1: { name: "Patsy Foster-Bolton", email: "pbolton@minnetonkamn.gov", phone: "952-314-8638", photo: "https://www.minnetonkamn.gov/home/showpublishedimage/4029/638436736809070000", officeSince: "2023-01-01", profileUrl: "https://www.minnetonkamn.gov/government/city-council-mayor/ward-1" },
  // Appointed (not elected) in March 2026 to fill the vacancy left when
  // Rebecca Schack moved from Ward 2 to mayor.
  2: { name: "Amanda Maxwell", email: "amaxwell@minnetonkamn.gov", phone: "612-466-0729", photo: "https://www.minnetonkamn.gov/home/showpublishedimage/5566/639087423947130000", officeSince: "2026-03-01", profileUrl: "https://www.minnetonkamn.gov/government/city-council-mayor/ward-2" },
  3: { name: "Paula Ramaley", email: "pramaley@minnetonkamn.gov", phone: "952-222-0105", photo: "https://www.minnetonkamn.gov/home/showpublishedimage/4031/638436738102070000", officeSince: "2023-01-01", profileUrl: "https://www.minnetonkamn.gov/government/city-council-mayor/ward-3" },
  4: { name: "Kissy Coakley", email: "kcoakley@minnetonkamn.gov", phone: "952-486-9670", photo: "https://www.minnetonkamn.gov/home/showpublishedimage/1687/638436738813470000", officeSince: "2019-01-01", profileUrl: "https://www.minnetonkamn.gov/government/city-council-mayor/ward-4" },
};

const ST_LOUIS_PARK_ROSTER = {
  1: { name: "Daniel Bashore", email: "dbashore@stlouisparkmn.gov", phone: "612-523-5702", photo: "https://www.stlouisparkmn.gov/home/showpublishedimage/6958/639046881787430000", officeSince: "2026-01-01", profileUrl: "https://www.stlouisparkmn.gov/government/city-council/mayor-council-members/ward-1" },
  2: { name: "Jim Engelking", email: "jengelking@stlouisparkmn.gov", phone: "612-449-0989", photo: "https://www.stlouisparkmn.gov/home/showpublishedimage/6960/639046881792530000", officeSince: "2026-01-01", profileUrl: "https://www.stlouisparkmn.gov/government/city-council/mayor-council-members/ward-2" },
  3: { name: "Sue Budd", email: "sbudd@stlouisparkmn.gov", phone: "612-523-5834", photo: "https://www.stlouisparkmn.gov/home/showpublishedimage/6966/639046881809400000", officeSince: "2022-01-01", profileUrl: "https://www.stlouisparkmn.gov/government/city-council/mayor-council-members/ward-3" },
  4: { name: "Tim Brausen", email: "tbrausen@stlouisparkmn.gov", phone: "612-523-5678", photo: "https://www.stlouisparkmn.gov/home/showpublishedimage/6968/639046881814570000", officeSince: "2014-01-01", profileUrl: "https://www.stlouisparkmn.gov/government/city-council/mayor-council-members/ward-4" },
};

const RICHFIELD_ROSTER = {
  1: { name: "Walter Burk", email: "WBurk@RichfieldMN.gov", phone: "651-236-0563", photo: "https://www.richfieldmn.gov/ImageRepository/Document?documentID=910", officeSince: "2025-01-01", profileUrl: "https://www.richfieldmn.gov/directory.aspx?eid=62" },
  2: { name: "Sean Hayford Oleary", email: "SHayfordoleary@RichfieldMN.gov", phone: "612-605-8837", photo: "https://www.richfieldmn.gov/ImageRepository/Document?documentID=906", officeSince: "2021-01-11", profileUrl: "https://www.richfieldmn.gov/directory.aspx?eid=63" },
  3: { name: "Rori A. Coleman-Woods", email: "RColeman-Woods@RichfieldMN.gov", phone: "612-490-2776", photo: "https://www.richfieldmn.gov/ImageRepository/Document?documentID=904", officeSince: "2025-01-01", profileUrl: "https://www.richfieldmn.gov/directory.aspx?eid=64" },
};

// --- Blaine (Anoka County) --------------------------------------------------
//
// The one suburb here outside Hennepin County, and the only one with two
// council members per ward. Unusually convenient source: Blaine's own GIS
// FeatureServer embeds each ward's two reps' name/phone/email/profile URL
// directly on the polygon — no separate roster object needed for those
// fields, just photos (not on the layer) hand-transcribed below.
const BLAINE_WARDS_URL =
  "https://arcgis.blainemn.gov/server/rest/services/FeatureDatasets/Boundaries/FeatureServer/22/query?where=1%3D1&outFields=*&f=geojson";
const BLAINE_PHOTOS = {
  "jrobertson@blainemn.gov": "https://www.blainemn.gov/ImageRepository/Document?documentID=15383",
  "leslielarson@blainemn.gov": "https://www.blainemn.gov/ImageRepository/Document?documentID=15914",
  "tnewland@blainemn.gov": "https://www.blainemn.gov/ImageRepository/Document?documentID=14360",
  "cford@blainemn.gov": "https://www.blainemn.gov/ImageRepository/Document?documentID=18457",
  "tfleming@blainemn.gov": "https://www.blainemn.gov/ImageRepository/Document?documentID=15284",
  "cmassoglia@blainemn.gov": "https://www.blainemn.gov/ImageRepository/Document?documentID=11407",
};
// Not stated on any rep's own directory.aspx page (only term-expiration
// dates are shown there) — best-effort fallback, same convention as
// RAMSEY_EXTRAS's default below for a date that couldn't be confirmed.
const BLAINE_OFFICE_SINCE_FALLBACK = "2025-01-01";

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "mn-civic-map-etl/0.1" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function fetchMinneapolisWards() {
  console.log("[wards] fetching Minneapolis...");
  const geojson = await fetchJson(MINNEAPOLIS_WARDS_URL);
  const features = (geojson.features ?? []).map((feature) => {
    const wardNum = Number(feature.properties?.BDNUM);
    const photo = MINNEAPOLIS_PHOTOS[wardNum];
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        role: "Council Member",
        city: "Minneapolis",
        county: null,
        ward: wardNum,
        district: null,
        stateDistrict: null,
        chamber: null,
        repName: MINNEAPOLIS_ROSTER[wardNum] ?? null,
        repParty: NONPARTISAN,
        repPhotoUrl: photo ? `${MINNEAPOLIS_PHOTO_BASE}${photo}` : null,
        repEmail: null,
        repPhone: null,
        officeSince: MINNEAPOLIS_OFFICE_SINCE_OVERRIDES[wardNum] ?? MINNEAPOLIS_TERM_START,
        committees: MINNEAPOLIS_COMMITTEES[wardNum] ?? [],
        neighborhoods: MINNEAPOLIS_NEIGHBORHOODS[wardNum] ?? [],
        officeRoom: MINNEAPOLIS_OFFICE_ROOM,
        profileUrl: `https://www.minneapolismn.gov/government/city-council/members/ward-${wardNum}/`,
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
  console.log(`[wards] Minneapolis: ${features.length} ward(s)`);
  return features;
}

async function fetchStPaulWards() {
  console.log("[wards] fetching St. Paul...");
  const geojson = await fetchJson(ST_PAUL_WARDS_URL);
  const features = (geojson.features ?? []).map((feature) => {
    const props = feature.properties ?? {};
    const wardNum = Number(String(props.ward ?? "").replace(/\D/g, ""));
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        role: "Council Member",
        city: "St. Paul",
        county: null,
        ward: wardNum,
        district: null,
        stateDistrict: null,
        chamber: null,
        repName: props.name ?? null,
        repParty: NONPARTISAN,
        repPhotoUrl: props.imgpath ?? null,
        repEmail: props.email ?? null,
        repPhone: props.phone ?? null,
        officeSince: ST_PAUL_OFFICE_SINCE_OVERRIDES[wardNum] ?? ST_PAUL_TERM_START,
        committees: ST_PAUL_COMMITTEES[wardNum] ?? [],
        neighborhoods: ST_PAUL_NEIGHBORHOODS[wardNum] ?? [],
        officeRoom: ST_PAUL_OFFICE_ROOM[wardNum] ?? null,
        profileUrl: `https://www.stpaul.gov/department/city-council/${ST_PAUL_PROFILE_SLUG[wardNum] ?? `ward-${wardNum}`}`,
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
  console.log(`[wards] St. Paul: ${features.length} ward(s)`);
  return features;
}

// Shared by Bloomington/Plymouth/Minnetonka/St. Louis Park/Richfield — all
// five pull from the same Hennepin County layer, joined by ward number
// against a per-city hand-transcribed roster. See the comment on
// HENNEPIN_WARDS_URL above for why a per-city function isn't needed here.
async function fetchHennepinSuburbWards(cityName, roster, profileUrl) {
  console.log(`[wards] fetching ${cityName}...`);
  const url = new URL(HENNEPIN_WARDS_URL);
  url.searchParams.set("where", `MUNIC_NAME='${cityName}'`);
  url.searchParams.set("outFields", "WARD,MUNIC_NAME");
  url.searchParams.set("f", "geojson");
  const geojson = await fetchJson(url.toString());
  const features = (geojson.features ?? []).map((feature) => {
    const wardNum = Number(feature.properties?.WARD);
    const info = roster[wardNum];
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        role: "Council Member",
        city: cityName,
        county: null,
        ward: wardNum,
        district: null,
        stateDistrict: null,
        chamber: null,
        repName: info?.name ?? null,
        repParty: NONPARTISAN,
        repPhotoUrl: info?.photo ?? null,
        repEmail: info?.email ?? null,
        repPhone: info?.phone ?? null,
        officeSince: info?.officeSince ?? "2025-01-01",
        committees: [],
        neighborhoods: [],
        officeRoom: null,
        profileUrl: info?.profileUrl ?? profileUrl ?? null,
        candidates: [],
        isContested: false,
        partyUnityPercent: null,
        recentVotes: [],
      },
    };
  });
  console.log(`[wards] ${cityName}: ${features.length} ward(s)`);
  return features;
}

// Blaine seats two council members per ward, so this emits two features per
// polygon (one per rep, identical geometry) rather than one — WardMap
// already nudges the second pin sideways so both stay independently
// clickable (see the wardPinOccurrences comment in WardMap.tsx).
async function fetchBlaineWards() {
  console.log("[wards] fetching Blaine...");
  const geojson = await fetchJson(BLAINE_WARDS_URL);
  const features = [];
  for (const feature of geojson.features ?? []) {
    const props = feature.properties ?? {};
    const wardNum = Number(props.ward);
    for (const slot of ["1", "2"]) {
      const name = props[`rep${slot}`];
      if (!name) continue;
      const email = props[`rep${slot}email`] ?? null;
      features.push({
        type: "Feature",
        geometry: feature.geometry,
        properties: {
          role: "Council Member",
          city: "Blaine",
          county: null,
          ward: wardNum,
          district: null,
          stateDistrict: null,
          chamber: null,
          repName: name,
          repParty: NONPARTISAN,
          repPhotoUrl: (email && BLAINE_PHOTOS[email]) ?? null,
          repEmail: email,
          repPhone: props[`rep${slot}phone`] ?? null,
          officeSince: BLAINE_OFFICE_SINCE_FALLBACK,
          committees: [],
          neighborhoods: [],
          officeRoom: null,
          profileUrl: props[`rep${slot}website`] ?? null,
          candidates: [],
          isContested: false,
          partyUnityPercent: null,
          recentVotes: [],
        },
      });
    }
  }
  console.log(`[wards] Blaine: ${features.length} ward seat(s)`);
  return features;
}

async function main() {
  const [mpls, stPaul, bloomington, plymouth, minnetonka, stLouisPark, richfield, blaine] = await Promise.all([
    fetchMinneapolisWards(),
    fetchStPaulWards(),
    fetchHennepinSuburbWards("Bloomington", BLOOMINGTON_ROSTER, BLOOMINGTON_PROFILE_URL),
    fetchHennepinSuburbWards("Plymouth", PLYMOUTH_ROSTER, PLYMOUTH_PROFILE_URL),
    fetchHennepinSuburbWards("Minnetonka", MINNETONKA_ROSTER),
    fetchHennepinSuburbWards("St. Louis Park", ST_LOUIS_PARK_ROSTER),
    fetchHennepinSuburbWards("Richfield", RICHFIELD_ROSTER),
    fetchBlaineWards(),
  ]);
  const featureCollection = {
    type: "FeatureCollection",
    features: [...mpls, ...stPaul, ...bloomington, ...plymouth, ...minnetonka, ...stLouisPark, ...richfield, ...blaine],
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(featureCollection));
  console.log(`[done] wrote ${featureCollection.features.length} ward feature(s) to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
