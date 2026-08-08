#!/usr/bin/env node
// scripts/fetch-mayors.mjs
//
// Writes public/mayors.geojson — a Point FeatureCollection (one feature
// per official, at their city's City Hall) that WardMap renders as photo
// pins. No city publishes a mayor API, so this is hand-transcribed from
// each city's own site (linked per-entry below) — re-check after an
// election, since names, photos, and dates all change then.
//
// Despite the filename, this also carries at-large council members for
// cities that elect their whole council citywide (no wards at all) —
// Woodbury is the first, added alongside issue #65's "8 more cities"
// batch once it turned out Woodbury has no ward polygon to source. That's
// not a misuse of this file: src/lib/officials.ts's resolveOfficialsAtPoint
// already special-cases "Mayor" *and* "Council Member" roles arriving
// through sources.mayors (city-name-matched, not polygon-matched, since
// neither role owns a polygon) — this file existed as the one already-
// built place for "an official this app can't put on a ward" before
// Woodbury needed it, so a new sibling file/source would have duplicated
// working plumbing rather than added anything. `role` is per-entry (see
// MAYORS below) and defaults to "Mayor" so every existing entry needed no
// change. Multiple officials sharing one city's coordinates (Woodbury's
// mayor + 4 council members, all at City Hall) fan out into a formation
// the same way a multi-member ward already does — see WardMap.tsx's
// groupFeaturesByCity.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { updateDataManifest } from "./lib/dataManifest.mjs";

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
  // --- Woodbury (Washington County) — fully at-large, no wards ------------
  //
  // Mayor + all 4 council seats elected citywide (confirmed via the city's
  // own site: woodburymn.gov/574/Mayor-and-City-Council), so all 5 sit
  // here at the same City Hall coordinate rather than each getting a ward
  // polygon in wards.geojson. None of the 5 individual profile pages
  // publish a per-member email — the city directs contact through a
  // general form instead — so repEmail stays null rather than
  // substituting a shared inbox, same convention as Coon Rapids above.
  // None state a term-start date either (only "Term expires"); every
  // officeSince below is the same documented placeholder used elsewhere
  // in this file for that exact gap.
  {
    city: "Woodbury",
    coordinates: [-92.9391, 44.9201], // Woodbury City Hall, 8301 Valley Creek Rd
    repName: "Anne Burt",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.woodburymn.gov/ImageRepository/Document?documentID=4179",
    repEmail: null,
    repPhone: "651-714-3576",
    officeSince: "2025-01-01",
    committees: ["Mayor of Woodbury"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.woodburymn.gov/m/directory/employee?eid=57",
  },
  {
    city: "Woodbury",
    coordinates: [-92.9391, 44.9201],
    role: "Council Member",
    repName: "Jennifer Santini",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.woodburymn.gov/ImageRepository/Document?documentID=4181",
    repEmail: null,
    repPhone: "651-714-3578",
    officeSince: "2025-01-01",
    committees: ["Mayor Pro Tem"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.woodburymn.gov/m/directory/employee?eid=60",
  },
  {
    city: "Woodbury",
    coordinates: [-92.9391, 44.9201],
    role: "Council Member",
    repName: "Steve Morris",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.woodburymn.gov/ImageRepository/Document?documentID=4180",
    repEmail: null,
    repPhone: "651-714-3575",
    officeSince: "2025-01-01",
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.woodburymn.gov/m/directory/employee?eid=59",
  },
  {
    city: "Woodbury",
    coordinates: [-92.9391, 44.9201],
    role: "Council Member",
    repName: "Kim Wilson",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.woodburymn.gov/ImageRepository/Document?documentID=4182",
    repEmail: null,
    repPhone: "651-714-3577",
    officeSince: "2025-01-01",
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.woodburymn.gov/m/directory/employee?eid=61",
  },
  {
    city: "Woodbury",
    coordinates: [-92.9391, 44.9201],
    role: "Council Member",
    repName: "Donna Stafford",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.woodburymn.gov/ImageRepository/Document?documentID=4178",
    repEmail: null,
    repPhone: "651-714-3579",
    officeSince: "2025-01-01",
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.woodburymn.gov/m/directory/employee?eid=106",
  },
  // --- Eagan (Dakota County) — fully at-large, no wards --------------------
  //
  // Mayor + 4 council members, all elected citywide (confirmed directly on
  // cityofeagan.com/council: "The Mayor and four Council Members are
  // elected at large..."). Every field below was read from each member's
  // own bio page (cityofeagan.com/<slug>), including email — the page
  // *displays* "protected from spambots," but the address is right there in
  // the page's own markup, base64-encoded for a client-side unmask script
  // (<joomla-hidden-mail text="...">), so decoding it is reading the page's
  // own published data, not guessing a firstname.lastname@ pattern. Every
  // officeSince date is the page's own stated first-elected/first-term date
  // (Maguire's is his first year as Mayor, having previously served as a
  // council member 2003-2007; Bakken and Hansen's own pages state an exact
  // "served/elected since" year with no month, so January 1 fills the
  // unstated day within that stated year, same convention as Robbinsdale's
  // Mia Parisian entry in fetch-wards.mjs).
  {
    city: "Eagan",
    coordinates: [-93.1664607, 44.8181446], // Eagan Municipal Center, 3830 Pilot Knob Rd
    repName: "Mike Maguire",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://cityofeagan.com/images/Council/Portraits/2022/MikeMaguire-1008-1_192w_72ppi.jpg",
    repEmail: "mike.maguire@eaganmn.gov",
    repPhone: "651-675-5048",
    officeSince: "2007-01-01", // elected Eagan's 8th Mayor in 2006, seated Jan 2007
    committees: ["Mayor of Eagan"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://cityofeagan.com/mayor-mike-maguire",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://cityofeagan.com/mayor-mike-maguire",
  },
  {
    city: "Eagan",
    coordinates: [-93.1664607, 44.8181446],
    role: "Council Member",
    repName: "Paul Bakken",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://cityofeagan.com/images/Council/Portraits/2022/PaulBakken-1006_192w_72ppi.jpg",
    repEmail: "paul.bakken@eaganmn.gov",
    repPhone: "651-688-7075",
    officeSince: "2007-01-01", // own bio page: "having served since January 2007" (also served 1999-2002)
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://cityofeagan.com/councilmember-paul-bakken",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://cityofeagan.com/councilmember-paul-bakken",
  },
  {
    city: "Eagan",
    coordinates: [-93.1664607, 44.8181446],
    role: "Council Member",
    repName: "Cyndee Fields",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://cityofeagan.com/images/Council/Portraits/2022/CyndeeFields-1005_Preferred_192w_72ppi.jpg",
    repEmail: "cyndee.fields@eaganmn.gov",
    repPhone: "952-270-3093",
    officeSince: "2001-01-01", // own bio page: "began her first term...in January, 2001"
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://cityofeagan.com/councilmember-cyndee-fields",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://cityofeagan.com/councilmember-cyndee-fields",
  },
  {
    city: "Eagan",
    coordinates: [-93.1664607, 44.8181446],
    role: "Council Member",
    repName: "Gary Hansen",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://cityofeagan.com/images/Council/Portraits/2022/GaryHansen-1007_192w_72ppi.jpg",
    repEmail: "gary.hansen@eaganmn.gov",
    repPhone: "651-454-1172",
    officeSince: "2009-01-01", // own bio page: "first elected to the Eagan City Council in 2008"
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://cityofeagan.com/councilmember-gary-hansen",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://cityofeagan.com/councilmember-gary-hansen",
  },
  {
    city: "Eagan",
    coordinates: [-93.1664607, 44.8181446],
    role: "Council Member",
    repName: "Mike Supina",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://cityofeagan.com/images/Council/Portraits/2022/MikeSupina-1008_192w_72ppi.jpg",
    repEmail: "mike.supina@eaganmn.gov",
    repPhone: "651-706-0061",
    officeSince: "2021-01-01", // own bio page: "elected...in 2020 and began his first term in January 2021"
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://cityofeagan.com/council-member-mike-supina",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://cityofeagan.com/council-member-mike-supina",
  },
  // --- Lakeville (Dakota County) — fully at-large, no wards -----------------
  //
  // Mayor + 4 council members, all elected citywide, confirmed directly on
  // lakevillemn.gov/428/City-Council: "elected at-large to represent the
  // entire community." Every field (including "First elected to Council"/
  // "First appointed to Council" dates) is read straight from that one
  // page's own table — no per-member bio pages exist on this site, so
  // profileUrl falls back to the shared council page for all five.
  {
    city: "Lakeville",
    coordinates: [-93.2434846, 44.6568619], // Lakeville City Hall, 20195 Holyoke Ave
    repName: "Luke Hellier",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.lakevillemn.gov/ImageRepository/Document?documentId=16903",
    repEmail: "lhellier@lakevillemn.gov",
    repPhone: "612-237-2551",
    officeSince: "2023-01-03", // page states "First elected as Mayor: January 3, 2023" (council member since 2017)
    committees: ["Mayor of Lakeville"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.lakevillemn.gov/428/City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.lakevillemn.gov/428/City-Council",
  },
  {
    city: "Lakeville",
    coordinates: [-93.2434846, 44.6568619],
    role: "Council Member",
    repName: "John Bermel",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.lakevillemn.gov/ImageRepository/Document?documentId=16904",
    repEmail: "jbermel@lakevillemn.gov",
    repPhone: "612-709-0180",
    officeSince: "2021-01-04", // page states "First elected to Council: January 4, 2021"
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.lakevillemn.gov/428/City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.lakevillemn.gov/428/City-Council",
  },
  {
    city: "Lakeville",
    coordinates: [-93.2434846, 44.6568619],
    role: "Council Member",
    repName: "Joshua Lee",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.lakevillemn.gov/ImageRepository/Document?documentId=16905",
    repEmail: "jlee@lakevillemn.gov",
    repPhone: "763-245-3677",
    officeSince: "2019-01-01", // page states "First elected to Council: January 1, 2019"
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.lakevillemn.gov/428/City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.lakevillemn.gov/428/City-Council",
  },
  {
    city: "Lakeville",
    coordinates: [-93.2434846, 44.6568619],
    role: "Council Member",
    repName: "Michelle Volk",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.lakevillemn.gov/ImageRepository/Document?documentId=16906",
    repEmail: "mvolk@lakevillemn.gov",
    repPhone: "952-270-7125",
    officeSince: "2019-01-01", // page states "First elected to Council: January 1, 2019"
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.lakevillemn.gov/428/City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.lakevillemn.gov/428/City-Council",
  },
  {
    city: "Lakeville",
    coordinates: [-93.2434846, 44.6568619],
    role: "Council Member",
    repName: "Dan Wolter",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.lakevillemn.gov/ImageRepository/Document?documentId=16907",
    repEmail: "dwolter@lakevillemn.gov",
    repPhone: "952-479-0020",
    officeSince: "2023-01-17", // page states "First appointed to Council: January 17, 2023"
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.lakevillemn.gov/428/City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.lakevillemn.gov/428/City-Council",
  },
];

async function main() {
  const featureCollection = {
    type: "FeatureCollection",
    features: MAYORS.map(({ city, coordinates, ...properties }) => ({
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
    })),
  };

  const output = JSON.stringify(featureCollection);
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, output);
  await updateDataManifest(path.basename(OUTPUT_PATH), output);
  console.log(`[done] wrote ${featureCollection.features.length} mayor feature(s) to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
