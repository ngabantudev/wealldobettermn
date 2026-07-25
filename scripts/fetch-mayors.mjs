#!/usr/bin/env node
// scripts/fetch-mayors.mjs
//
// Writes public/mayors.geojson — a point FeatureCollection anchored at
// each city's City Hall — that WardMap renders as photo pins. Every city
// gets one Mayor point here; cities whose council is elected fully
// at-large (no wards to draw at all — see fetch-wards.mjs's cities for
// the ones that do have wards) also get one point per at-large council
// member, sharing their mayor's same City Hall coordinate. WardMap groups
// same-city points and fans them out side-by-side, the same mechanism
// wards that seat more than one member off a shared polygon already use.
// No city publishes an API for any of this, so it's all hand-transcribed
// from each city's own site (linked per-entry below) — re-check after an
// election, since names, photos, and dates all change then.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "../public/mayors.geojson");

const NONPARTISAN = "Nonpartisan";

// Coordinates via OpenStreetMap/Nominatim geocoding of each City Hall
// address, not eyeballed — see git history for the lookup.
const MAYORS = [
  {
    city: "Minneapolis",
    coordinates: [-93.2650683, 44.9773133],
    repName: "Jacob Frey",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.minneapolismn.gov/media/-www-content-assets/images/headshots/Mayor-Jacob-Frey.jpg",
    repEmail: null,
    repPhone: "612-673-2100",
    officeSince: "2018-01-01", // elected 2017, seated the following January
    committees: ["48th Mayor of Minneapolis"],
    neighborhoods: [],
    officeRoom: "Room 330, City Hall",
    profileUrl: "https://www.minneapolismn.gov/government/mayor/",
  },
  {
    city: "St. Paul",
    coordinates: [-93.093173, 44.9439666],
    repName: "Kaohly Her",
    repParty: NONPARTISAN,
    repPhotoUrl:
      "https://www.stpaul.gov/sites/default/files/styles/large/public/2025-12/Mayor-Elect%20Her%20-%20Ward%203%20Tour%20-%20December%209%202025-20-2048x2048.jpeg.webp?itok=Du3PTque",
    repEmail: "mayor@stpaul.gov",
    repPhone: "651-266-8510",
    officeSince: "2026-01-01", // elected Nov 2025, Saint Paul's first woman and first Asian American mayor
    committees: ["Mayor of Saint Paul"],
    neighborhoods: [],
    officeRoom: "Saint Paul City Hall, 15 Kellogg Blvd. West",
    profileUrl: "https://www.stpaul.gov/departments/mayors-office",
  },
  // --- Metro suburbs (pilot) — see fetch-wards.mjs for the matching ward
  // rosters. None of these six state an exact "took office" date on their
  // own site (only term-expiration dates) — dates below are secondary-
  // sourced best efforts, same caveat as the ward rosters.
  {
    city: "Bloomington",
    coordinates: [-93.3024154, 44.8251814], // Bloomington Civic Plaza
    repName: "Tim Busse",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.bloomingtonmn.gov/sites/default/files/styles/240x336/public/2026-02/Busse-Tim-2026.jpg?h=59969086&itok=ewxwDjDP",
    repEmail: "tbusse@BloomingtonMN.gov",
    repPhone: "952-457-7506",
    officeSince: "2020-01-02", // elected Nov 2019; previously an at-large councilmember 2011-2019
    committees: ["Mayor of Bloomington"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.bloomingtonmn.gov/cc/city-councilmembers-and-district-maps",
  },
  {
    city: "Plymouth",
    coordinates: [-93.474067, 45.018313],
    repName: "Jeff Wosje",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.plymouthmn.gov/home/showpublishedimage/4692/636190361468730000",
    repEmail: "jwosje@plymouthmn.gov",
    repPhone: "763-509-5007",
    officeSince: "2019-01-01", // elected Nov 2018; previously Ward 2 councilmember 2011-2018
    committees: ["Mayor of Plymouth"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.plymouthmn.gov/departments/city-council/city-council-members",
  },
  {
    city: "Minnetonka",
    coordinates: [-93.4660093, 44.9400905], // Minnetonka City Hall
    repName: "Rebecca Schack",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.minnetonkamn.gov/home/showpublishedimage/1103/638436738444100000",
    repEmail: "rschack@minnetonkamn.gov",
    repPhone: "612-590-3735",
    officeSince: "2025-01-01", // previously Ward 2 council member (appointed 2018, elected 2019, re-elected 2023)
    committees: ["Mayor of Minnetonka"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.minnetonkamn.gov/government/city-council-mayor/mayor",
  },
  {
    city: "St. Louis Park",
    coordinates: [-93.3428234, 44.9480894], // Saint Louis Park City Hall
    repName: "Nadia Mohamed",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.stlouisparkmn.gov/home/showpublishedimage/6962/639046881797230000",
    repEmail: "nmohamed@stlouisparkmn.gov",
    repPhone: "952-207-0256",
    officeSince: "2024-01-01", // previously an at-large council member starting 2020
    committees: ["Mayor of St. Louis Park"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.stlouisparkmn.gov/government/city-council/mayor-council-members/mayor",
  },
  {
    city: "Richfield",
    coordinates: [-93.2685853, 44.8806821], // Richfield Municipal Center
    repName: "Mary Supple",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.richfieldmn.gov/ImageRepository/Document?documentID=902",
    repEmail: "MSupple@RichfieldMN.gov",
    repPhone: "612-281-7482",
    officeSince: "2023-01-01", // elected Nov 2022; previously a ward council member since 2018
    committees: ["Mayor of Richfield"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.richfieldmn.gov/directory.aspx?eid=60",
  },
  {
    city: "Blaine",
    coordinates: [-93.208792, 45.1654714],
    repName: "Tim Sanders",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.blainemn.gov/ImageRepository/Document?documentID=11405",
    repEmail: "tsanders@blainemn.gov",
    repPhone: "763-203-3286",
    officeSince: "2021-01-01", // elected Nov 2020, replacing retiring mayor Tom Ryan; re-elected 2024
    committees: ["Mayor of Blaine"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.blainemn.gov/directory.aspx?eid=378",
  },
  {
    city: "Brooklyn Park",
    coordinates: [-93.3470976, 45.1095365], // Brooklyn Park City Hall
    repName: "Hollies J. Winston",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.brooklynpark.org/wp-content/uploads/2019/06/Hollies-Winston_Studio-scaled-e1673533312964.jpg",
    repEmail: "mayor@brooklynpark.org",
    repPhone: "763-493-8146",
    officeSince: "2023-01-01", // elected Nov 2022, sworn in Jan 2023 as the city's first Black mayor
    committees: ["Mayor of Brooklyn Park"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.brooklynpark.org/contact/hollies-winston/",
  },
  {
    city: "Coon Rapids",
    coordinates: [-93.3042559, 45.1723758], // Coon Rapids City Hall
    repName: "Jerry Koch",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.coonrapidsmn.gov/ImageRepository/Document?documentID=13430",
    repEmail: null, // no personal email published — the city's directory pages carry only a shared general inbox
    repPhone: "763-767-1811",
    officeSince: "2025-01-01", // not stated on the city's own site (checked directory + profile page) — best-effort fallback
    committees: ["Mayor of Coon Rapids"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.coonrapidsmn.gov/Directory.aspx?EID=2",
  },
  // --- Fully at-large cities (pilot) ------------------------------------
  //
  // Confirmed elsewhere (a ~20-city metro survey) as electing their whole
  // council citywide, with no wards at all — so unlike every city above,
  // these mayors have company: see AT_LARGE_COUNCIL below for their
  // council members, sharing this same City Hall coordinate.
  {
    city: "Edina",
    coordinates: [-93.3473318, 44.911093], // Edina City Hall
    repName: "James Hovland",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.edinamn.gov/ImageRepository/Document?documentID=10560",
    repEmail: "jhovland@EdinaMN.gov",
    repPhone: "612-874-8551",
    officeSince: "2005-01-01", // elected Nov 2004
    committees: ["Mayor of Edina"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.edinamn.gov/1144/Meet-the-Mayor-and-City-Council",
  },
  {
    city: "Eden Prairie",
    coordinates: [-93.4603848, 44.856807], // Eden Prairie City Hall
    repName: "Ron Case",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.edenprairiemn.gov/home/showpublishedimage/7492/637680867226730000",
    repEmail: "RCase@edenprairiemn.gov",
    repPhone: "952-949-8593",
    // Not stated anywhere on his own bio (only "re-elected mayor in 2022,
    // after one term as mayor and five-and-a-half terms on council") —
    // best-effort fallback, same convention as Coon Rapids' above.
    officeSince: "2025-01-01",
    committees: ["Mayor of Eden Prairie"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.edenprairiemn.gov/city-government/city-council/ron-case",
  },
  {
    city: "Roseville",
    coordinates: [-93.149359, 45.0208972], // Roseville City Hall
    repName: "Dan Roe",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.cityofroseville.com/ImageRepository/Document?documentID=37812",
    repEmail: "dan.roe@cityofroseville.com",
    repPhone: "651-487-9654",
    officeSince: "2011-01-01", // as Mayor; previously on Council 2007-2010
    committees: ["Mayor of Roseville"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.cityofroseville.com/56/Members",
  },
  {
    city: "Maplewood",
    coordinates: [-93.0218213, 45.0063231], // Maplewood City Hall
    repName: "Marylee Abrams",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.maplewoodmn.gov/ImageRepository/Document?documentId=23014",
    repEmail: "Marylee.Abrams@maplewoodmn.gov",
    repPhone: "612-322-1620",
    officeSince: "2019-01-01", // on Council since 2014; Mayor since 2019 (both stated in her official bio)
    committees: ["Mayor of Maplewood"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.maplewoodmn.gov/1974/Marylee-Abrams",
  },
];

// At-large council members for the fully at-large cities above — each
// shares their city's mayor's coordinates (same MAYORS entry, same City
// Hall) since there's no ward to anchor to instead, same reasoning as the
// mayors themselves. role/city/coordinates are set in main() below by
// looking up each entry's mayor, not repeated per member here.
const AT_LARGE_COUNCIL = [
  {
    city: "Edina",
    repName: "Kate Agnew",
    repPhotoUrl: "https://www.edinamn.gov/ImageRepository/Document?documentID=12855",
    repEmail: "KAgnew@EdinaMN.gov",
    repPhone: "952-833-9556",
    officeSince: "2023-01-01", // elected Nov 2022
    profileUrl: "https://www.edinamn.gov/1144/Meet-the-Mayor-and-City-Council",
  },
  {
    city: "Edina",
    repName: "Carolyn Jackson",
    repPhotoUrl: "https://www.edinamn.gov/ImageRepository/Document?documentID=15559",
    repEmail: "CJackson@EdinaMN.gov",
    repPhone: "952-833-9547",
    officeSince: "2021-01-01", // elected Nov 2020
    profileUrl: "https://www.edinamn.gov/1144/Meet-the-Mayor-and-City-Council",
  },
  {
    city: "Edina",
    repName: "James Pierce",
    repPhotoUrl: "https://www.edinamn.gov/ImageRepository/Document?documentID=14137",
    repEmail: "JPierce@EdinaMN.gov",
    repPhone: "952-833-9548",
    officeSince: "2021-01-01", // elected Nov 2020
    profileUrl: "https://www.edinamn.gov/1144/Meet-the-Mayor-and-City-Council",
  },
  {
    city: "Edina",
    repName: "Julie Risser",
    repPhotoUrl: "https://www.edinamn.gov/ImageRepository/Document?documentID=15558",
    repEmail: "JRisser@EdinaMN.gov",
    repPhone: "952-833-9557",
    officeSince: "2023-01-01", // elected Nov 2022
    profileUrl: "https://www.edinamn.gov/1144/Meet-the-Mayor-and-City-Council",
  },
  {
    city: "Eden Prairie",
    repName: "Mark Freiberg",
    repPhotoUrl: "https://www.edenprairiemn.gov/home/showpublishedimage/7496/637000945131870000",
    repEmail: "MFreiberg@edenprairiemn.gov",
    repPhone: "612-581-7504",
    officeSince: "2025-01-01", // not stated (bio: re-elected to 2nd term in 2022 election) — best-effort fallback
    profileUrl: "https://www.edenprairiemn.gov/city-government/city-council/mark-freiberg",
  },
  {
    city: "Eden Prairie",
    repName: "PG Narayanan",
    repPhotoUrl: "https://www.edenprairiemn.gov/home/showpublishedimage/7498/637680867626270000",
    repEmail: "PGNarayanan@edenprairiemn.gov",
    repPhone: "952-393-3100",
    officeSince: "2025-01-01", // not stated (bio: re-elected to 3rd term in 2024 election) — best-effort fallback
    profileUrl: "https://www.edenprairiemn.gov/city-government/city-council/pg-narayanan",
  },
  {
    city: "Eden Prairie",
    repName: "Kathy Nelson",
    repPhotoUrl: "https://www.edenprairiemn.gov/home/showpublishedimage/7500/637680867866430000",
    repEmail: "KNelson@edenprairiemn.gov",
    repPhone: "952-941-6613",
    officeSince: "2025-01-01", // not stated (bio: re-elected to 5th term in 2022 election) — best-effort fallback
    profileUrl: "https://www.edenprairiemn.gov/city-government/city-council/kathy-nelson",
  },
  {
    city: "Eden Prairie",
    repName: "Lisa Toomey",
    repPhotoUrl: "https://www.edenprairiemn.gov/home/showpublishedimage/9637/638963061056330000",
    repEmail: "LToomey@edenprairiemn.gov",
    repPhone: "952-388-8827",
    officeSince: "2025-01-01", // not stated (bio: re-elected to 2nd term in 2024 election) — best-effort fallback
    profileUrl: "https://www.edenprairiemn.gov/city-government/city-council/lisa-toomey",
  },
  {
    city: "Roseville",
    repName: "Matt Bauer",
    repPhotoUrl: "https://www.cityofroseville.com/ImageRepository/Document?documentID=37813",
    repEmail: "matt.bauer@cityofroseville.com",
    repPhone: "651-243-1218",
    officeSince: "2025-01-01", // first term
    profileUrl: "https://www.cityofroseville.com/56/Members",
  },
  {
    city: "Roseville",
    repName: "Wayne Groff",
    repPhotoUrl: "https://www.cityofroseville.com/ImageRepository/Document?documentID=37814",
    repEmail: "wayne.groff@cityofroseville.com",
    repPhone: "612-867-0915",
    officeSince: "2019-01-01",
    profileUrl: "https://www.cityofroseville.com/56/Members",
  },
  {
    city: "Roseville",
    repName: "Robin Schroeder",
    repPhotoUrl: "https://www.cityofroseville.com/ImageRepository/Document?documentID=37815",
    repEmail: "robin.schroeder@cityofroseville.com",
    repPhone: "651-488-0129",
    officeSince: "2023-01-01", // first term
    profileUrl: "https://www.cityofroseville.com/56/Members",
  },
  {
    city: "Roseville",
    repName: "Julie Strahan",
    repPhotoUrl: "https://www.cityofroseville.com/ImageRepository/Document?documentID=37816",
    repEmail: "julie.strahan@cityofroseville.com",
    repPhone: "612-460-7503",
    officeSince: "2021-01-01",
    profileUrl: "https://www.cityofroseville.com/56/Members",
  },
  {
    city: "Maplewood",
    repName: "Kathleen Juenemann",
    repPhotoUrl: "https://www.maplewoodmn.gov/ImageRepository/Document?documentId=23022",
    repEmail: "Kathleen.Juenemann@maplewoodmn.gov",
    repPhone: "651-771-3670",
    // Not stated on the city's own site; her own 2022 candidate statement
    // says "since January 2002, I have missed only one meeting" — unconfirmed
    // by the city itself, but specific enough to use over a generic fallback.
    officeSince: "2002-01-01",
    profileUrl: "https://www.maplewoodmn.gov/1975/Kathleen-Juenemann",
  },
  {
    city: "Maplewood",
    repName: "Chonburi Lee",
    repPhotoUrl: "https://www.maplewoodmn.gov/ImageRepository/Document?documentId=31748",
    repEmail: "Chonburi.Lee@maplewoodmn.gov",
    repPhone: "651-321-2299",
    // Not stated on the city's own site; his campaign bio says "currently
    // serving my fourth year," consistent with elected Nov 2022 — unconfirmed
    // by the city itself, but specific enough to use over a generic fallback.
    officeSince: "2023-01-01",
    profileUrl: "https://www.maplewoodmn.gov/1978/Chonburi-Lee",
  },
  {
    city: "Maplewood",
    repName: "Rebecca Cave",
    repPhotoUrl: "https://www.maplewoodmn.gov/ImageRepository/Document?documentId=29083",
    repEmail: "Rebecca.Cave@maplewoodmn.gov",
    repPhone: "651-399-1779",
    officeSince: "2025-01-01", // no bio, no reliable first-elected year found — best-effort fallback
    profileUrl: "https://www.maplewoodmn.gov/1977/Rebecca-Cave",
  },
  {
    city: "Maplewood",
    repName: "Nikki Villavicencio",
    repPhotoUrl: "https://www.maplewoodmn.gov/ImageRepository/Document?documentId=29082",
    repEmail: "Nikki.Villavicencio@maplewoodmn.gov",
    repPhone: "651-558-7662",
    // Not stated on the city's own site; a Nov 9, 2020 Sahan Journal report
    // of her election win implies taking office Jan 2021 — unconfirmed by
    // the city itself, but specific enough to use over a generic fallback.
    officeSince: "2021-01-01",
    profileUrl: "https://www.maplewoodmn.gov/1976/Nikki-Villavicencio",
  },
];

async function main() {
  const coordinatesByCity = new Map(MAYORS.map((m) => [m.city, m.coordinates]));

  const mayorFeatures = MAYORS.map(({ city, coordinates, ...properties }) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates },
    properties: {
      role: "Mayor",
      city,
      county: null,
      ward: null,
      wardName: null,
      district: null,
      stateDistrict: null,
      chamber: null,
      candidates: [],
      isContested: false,
      partyUnityPercent: null,
      recentVotes: [],
      ...properties,
    },
  }));

  const atLargeFeatures = AT_LARGE_COUNCIL.map(({ city, ...properties }) => {
    const coordinates = coordinatesByCity.get(city);
    if (!coordinates) throw new Error(`AT_LARGE_COUNCIL entry for "${city}" has no matching MAYORS entry to anchor to`);
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates },
      properties: {
        role: "Council Member",
        city,
        county: null,
        ward: null,
        wardName: null,
        district: null,
        stateDistrict: null,
        chamber: null,
        repParty: NONPARTISAN,
        candidates: [],
        isContested: false,
        partyUnityPercent: null,
        recentVotes: [],
        committees: [],
        neighborhoods: [],
        officeRoom: null,
        repEmail: null,
        repPhone: null,
        ...properties,
      },
    };
  });

  const featureCollection = {
    type: "FeatureCollection",
    features: [...mayorFeatures, ...atLargeFeatures],
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(featureCollection));
  console.log(`[done] wrote ${featureCollection.features.length} feature(s) to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
