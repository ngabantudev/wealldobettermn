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
    termsOfService: [{ termStart: "2018-01-01", termEnd: null, current: true, sourceUrl: "https://www.minneapolismn.gov/government/mayor/" }],
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
    termsOfService: [{ termStart: "2026-01-01", termEnd: null, current: true, sourceUrl: "https://www.stpaul.gov/departments/mayors-office" }],
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
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.bloomingtonmn.gov/cc/city-councilmembers-and-district-maps" }],
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
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.plymouthmn.gov/departments/city-council/city-council-members" }],
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
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.minnetonkamn.gov/government/city-council-mayor/mayor" }],
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
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.stlouisparkmn.gov/government/city-council/mayor-council-members/mayor" }],
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
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.richfieldmn.gov/directory.aspx?eid=60" }],
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
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.blainemn.gov/directory.aspx?eid=378" }],
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
    termsOfService: [{ termStart: "2023-01-01", termEnd: null, current: true, sourceUrl: "https://www.brooklynpark.org/contact/hollies-winston/" }],
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
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.coonrapidsmn.gov/Directory.aspx?EID=2" }],
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
  // None state a term-start date either (only "Term expires," and no
  // actual expiration date is quoted anywhere reachable by this pipeline);
  // termsOfService below carries termStart: null / termEnd: null for that
  // exact gap, same convention used elsewhere in this file.
  {
    city: "Woodbury",
    coordinates: [-92.9391, 44.9201], // Woodbury City Hall, 8301 Valley Creek Rd
    repName: "Anne Burt",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.woodburymn.gov/ImageRepository/Document?documentID=4179",
    repEmail: null,
    repPhone: "651-714-3576",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.woodburymn.gov/m/directory/employee?eid=57" }],
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
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.woodburymn.gov/m/directory/employee?eid=60" }],
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
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.woodburymn.gov/m/directory/employee?eid=59" }],
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
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.woodburymn.gov/m/directory/employee?eid=61" }],
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
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.woodburymn.gov/m/directory/employee?eid=106" }],
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
  // termsOfService termStart date below is the page's own stated
  // first-elected/first-term date (Maguire's is his first year as Mayor,
  // having previously served as a
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
    termsOfService: [{ termStart: "2007-01-01", termEnd: null, current: true, sourceUrl: "https://cityofeagan.com/mayor-mike-maguire" }],
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
    termsOfService: [{ termStart: "2007-01-01", termEnd: null, current: true, sourceUrl: "https://cityofeagan.com/councilmember-paul-bakken" }],
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
    termsOfService: [{ termStart: "2001-01-01", termEnd: null, current: true, sourceUrl: "https://cityofeagan.com/councilmember-cyndee-fields" }],
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
    termsOfService: [{ termStart: "2009-01-01", termEnd: null, current: true, sourceUrl: "https://cityofeagan.com/councilmember-gary-hansen" }],
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
    termsOfService: [{ termStart: "2021-01-01", termEnd: null, current: true, sourceUrl: "https://cityofeagan.com/council-member-mike-supina" }],
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
    termsOfService: [{ termStart: "2023-01-03", termEnd: null, current: true, sourceUrl: "https://www.lakevillemn.gov/428/City-Council" }],
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
    termsOfService: [{ termStart: "2021-01-04", termEnd: null, current: true, sourceUrl: "https://www.lakevillemn.gov/428/City-Council" }],
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
    termsOfService: [{ termStart: "2019-01-01", termEnd: null, current: true, sourceUrl: "https://www.lakevillemn.gov/428/City-Council" }],
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
    termsOfService: [{ termStart: "2019-01-01", termEnd: null, current: true, sourceUrl: "https://www.lakevillemn.gov/428/City-Council" }],
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
    termsOfService: [{ termStart: "2023-01-17", termEnd: null, current: true, sourceUrl: "https://www.lakevillemn.gov/428/City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.lakevillemn.gov/428/City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.lakevillemn.gov/428/City-Council",
  },
  // --- Maple Grove (Hennepin County) — fully at-large, no wards -------------
  //
  // Mayor + 4 council members, all elected citywide (maplegrovemn.gov/301/
  // Mayor-and-City-Council: "City councilmembers serve at large"). Every
  // field (including each member's own stated "Elected to council"/
  // "Appointed to mayor" date) is read straight from that page. Steffenson
  // is the only one of the five with his own bio sub-page; the other four
  // fall back to the shared overview page as profileUrl.
  {
    city: "Maple Grove",
    coordinates: [-93.4420501, 45.0992572], // Maple Grove Government Center, 12800 Arbor Lakes Pkwy N
    repName: "Mark Steffenson",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.maplegrovemn.gov/ImageRepository/Document?documentId=5496",
    repEmail: "msteffenson@maplegrovemn.gov",
    repPhone: "763-416-0490",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.maplegrovemn.gov/301/Mayor-and-City-Council" }],
    committees: ["Mayor of Maple Grove"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.maplegrovemn.gov/315/Mark-Steffenson",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.maplegrovemn.gov/301/Mayor-and-City-Council",
  },
  {
    city: "Maple Grove",
    coordinates: [-93.4420501, 45.0992572],
    role: "Council Member",
    repName: "Rachelle Johnson",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.maplegrovemn.gov/ImageRepository/Document?documentId=5495",
    repEmail: "rajohnson@maplegrovemn.gov",
    repPhone: "612-203-8209",
    termsOfService: [{ termStart: "2023-01-01", termEnd: null, current: true, sourceUrl: "https://www.maplegrovemn.gov/301/Mayor-and-City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.maplegrovemn.gov/301/Mayor-and-City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.maplegrovemn.gov/301/Mayor-and-City-Council",
  },
  {
    city: "Maple Grove",
    coordinates: [-93.4420501, 45.0992572],
    role: "Council Member",
    repName: "Kristy Janigo",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.maplegrovemn.gov/ImageRepository/Document?documentId=5494",
    repEmail: "kjanigo@maplegrovemn.gov",
    repPhone: "612-708-9029",
    termsOfService: [{ termStart: "2023-01-01", termEnd: null, current: true, sourceUrl: "https://www.maplegrovemn.gov/301/Mayor-and-City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.maplegrovemn.gov/301/Mayor-and-City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.maplegrovemn.gov/301/Mayor-and-City-Council",
  },
  {
    city: "Maple Grove",
    coordinates: [-93.4420501, 45.0992572],
    role: "Council Member",
    repName: "Mike Ostaffe",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.maplegrovemn.gov/ImageRepository/Document?documentId=9435",
    repEmail: "mostaffe@maplegrovemn.gov",
    repPhone: "763-445-9643",
    termsOfService: [{ termStart: "2025-01-01", termEnd: null, current: true, sourceUrl: "https://www.maplegrovemn.gov/301/Mayor-and-City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.maplegrovemn.gov/301/Mayor-and-City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.maplegrovemn.gov/301/Mayor-and-City-Council",
  },
  {
    city: "Maple Grove",
    coordinates: [-93.4420501, 45.0992572],
    role: "Council Member",
    repName: "Jon McCullough",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.maplegrovemn.gov/ImageRepository/Document?documentId=9436",
    repEmail: "jmccullough@maplegrovemn.gov",
    repPhone: "612-405-0001",
    termsOfService: [{ termStart: "2025-01-01", termEnd: null, current: true, sourceUrl: "https://www.maplegrovemn.gov/301/Mayor-and-City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.maplegrovemn.gov/301/Mayor-and-City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.maplegrovemn.gov/301/Mayor-and-City-Council",
  },
  // --- Apple Valley (Dakota County) — fully at-large, no wards --------------
  //
  // Not to be confused with Apple Valley, California — every field below is
  // read from the Minnesota city's own site, applevalleymn.gov. Mayor + 4
  // council members, all elected citywide (confirmed via a live news
  // roundup and the city's own "Elections and Voting" page; no wards).
  // applevalleymn.gov/27/City-Council states only "Served since <year>" per
  // member (no month/day, so January 1 fills the unstated day within that
  // stated year) and publishes no individual email or phone anywhere on the
  // site — only a general municipal line (952-953-2500) and per-member web
  // contact forms — so repEmail/repPhone stay null rather than substituting
  // the shared number or a guessed address. A generic web search separately
  // surfaced a plausible-looking direct email/phone for Mayor Hooppaw that
  // does NOT appear anywhere on applevalleymn.gov itself; confirmed as
  // stale/unsourced third-party data and deliberately not used here.
  {
    city: "Apple Valley",
    coordinates: [-93.2090127, 44.7346234], // Apple Valley Municipal Center, 7100 147th St W
    repName: "Clint Hooppaw",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.applevalleymn.gov/ImageRepository/Document?documentID=16704",
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: "2011-01-01", termEnd: null, current: true, sourceUrl: "https://www.applevalleymn.gov/27/City-Council" }],
    committees: ["Mayor of Apple Valley"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.applevalleymn.gov/27/City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.applevalleymn.gov/27/City-Council",
  },
  {
    city: "Apple Valley",
    coordinates: [-93.2090127, 44.7346234],
    role: "Council Member",
    repName: "John Bergman",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.applevalleymn.gov/ImageRepository/Document?documentID=16701",
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: "2003-01-01", termEnd: null, current: true, sourceUrl: "https://www.applevalleymn.gov/27/City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.applevalleymn.gov/27/City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.applevalleymn.gov/27/City-Council",
  },
  {
    city: "Apple Valley",
    coordinates: [-93.2090127, 44.7346234],
    role: "Council Member",
    repName: "Ruth Grendahl",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.applevalleymn.gov/ImageRepository/Document?documentID=16705",
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: "1997-01-01", termEnd: null, current: true, sourceUrl: "https://www.applevalleymn.gov/27/City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.applevalleymn.gov/27/City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.applevalleymn.gov/27/City-Council",
  },
  {
    city: "Apple Valley",
    coordinates: [-93.2090127, 44.7346234],
    role: "Council Member",
    repName: "Lisa Hiebert",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.applevalleymn.gov/ImageRepository/Document?documentID=18866",
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: "2025-01-01", termEnd: null, current: true, sourceUrl: "https://www.applevalleymn.gov/27/City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.applevalleymn.gov/27/City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.applevalleymn.gov/27/City-Council",
  },
  {
    city: "Apple Valley",
    coordinates: [-93.2090127, 44.7346234],
    role: "Council Member",
    repName: "Tom Melander",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.applevalleymn.gov/ImageRepository/Document?documentID=16703",
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: "2021-01-01", termEnd: null, current: true, sourceUrl: "https://www.applevalleymn.gov/27/City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.applevalleymn.gov/27/City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.applevalleymn.gov/27/City-Council",
  },
  // --- Burnsville (Dakota County) — fully at-large, no wards ----------------
  //
  // Statutory Plan B council-manager city; mayor + 4 council members, all
  // elected citywide (confirmed via burnsvillemn.gov's own government page).
  // The city's staff-directory page (burnsvillemn.gov/2078/City-Council) is
  // JS-rendered for names/roles/phone but its per-member email column and
  // each individual directory.aspx?EID= sub-page render no usable server-
  // side content at all through a plain fetch — not routed around per
  // AGENTS.md §2.2, so repEmail stays null and profileUrl falls back to the
  // shared council page for all five. The one phone number shown,
  // 952-895-4403, is identical for all five members on that page — a shared
  // office line, not a personal extension, so it's not attributed as one
  // (kept only as officeRoom-adjacent context, not repPhone, to avoid
  // implying it reaches one person directly). No term-start date is stated
  // anywhere reachable by a plain fetch — and no term-*expiration* date is
  // either, despite the shared council page format for other cities in
  // this file sometimes carrying one — so termsOfService below carries
  // termStart: null / termEnd: null for all five, same as every other
  // genuinely-unconfirmed gap in this file.
  {
    city: "Burnsville",
    coordinates: [-93.2738283, 44.7655806], // Burnsville City Hall, 100 Civic Center Pkwy
    repName: "Elizabeth Kautz",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://burnsvillemn.gov/2078/City-Council" }],
    committees: ["Mayor of Burnsville"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://burnsvillemn.gov/2078/City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://burnsvillemn.gov/2078/City-Council",
  },
  {
    city: "Burnsville",
    coordinates: [-93.2738283, 44.7655806],
    role: "Council Member",
    repName: "Vince Workman",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://burnsvillemn.gov/2078/City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://burnsvillemn.gov/2078/City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://burnsvillemn.gov/2078/City-Council",
  },
  {
    city: "Burnsville",
    coordinates: [-93.2738283, 44.7655806],
    role: "Council Member",
    repName: "Dan Kealey",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://burnsvillemn.gov/2078/City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://burnsvillemn.gov/2078/City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://burnsvillemn.gov/2078/City-Council",
  },
  {
    city: "Burnsville",
    coordinates: [-93.2738283, 44.7655806],
    role: "Council Member",
    repName: "Dan Gustafson",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://burnsvillemn.gov/2078/City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://burnsvillemn.gov/2078/City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://burnsvillemn.gov/2078/City-Council",
  },
  {
    city: "Burnsville",
    coordinates: [-93.2738283, 44.7655806],
    role: "Council Member",
    repName: "Cara Schulz",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://burnsvillemn.gov/2078/City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://burnsvillemn.gov/2078/City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://burnsvillemn.gov/2078/City-Council",
  },
  // --- Edina (Hennepin County) — fully at-large, no wards --------------------
  //
  // Mayor + 4 council members, all elected citywide (confirmed directly on
  // edinamn.gov: "All Council Members in Edina are elected at-large... do
  // not serve a specific ward"). Phone and photo document IDs are read
  // directly off edinamn.gov/780/Council-Member-Directory. Email addresses
  // are Cloudflare email-obfuscation–protected on that page and on each
  // member's own /m/directory/employee?eid= sub-page (rendered in the
  // markup as an encoded "cdn-cgi/l/email-protection#..." fragment) —
  // decoded here via that scheme's own deterministic XOR cipher against the
  // page's own published bytes, not guessed or pattern-matched; still worth
  // a human spot-check of one or two against a real browser render before
  // fully trusting the decode. No individual "elected"/"took office" date is
  // stated distinctly from re-election on this site (clearest case: Hovland
  // is shown as "Elected 2004" despite being on his current term via
  // multiple re-elections since, not continuously since a single 2004
  // swearing-in) — termsOfService below carries termStart: null rather than
  // guessing which of the "elected" years is the real current-term start.
  // No term-*expiration* date is quoted anywhere reachable by this
  // pipeline either, so termEnd is also null for all five.
  {
    city: "Edina",
    coordinates: [-93.3473318, 44.9110930], // Edina City Hall, 4801 W 50th St
    repName: "James Hovland",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.edinamn.gov/ImageRepository/Document?documentID=10560",
    repEmail: "jhovland@EdinaMN.gov",
    repPhone: "612-874-8551",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.edinamn.gov/m/directory/employee?eid=7" }],
    committees: ["Mayor of Edina"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.edinamn.gov/m/directory/employee?eid=7",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.edinamn.gov/m/directory/employee?eid=7",
  },
  {
    city: "Edina",
    coordinates: [-93.3473318, 44.9110930],
    role: "Council Member",
    repName: "Kate Agnew",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.edinamn.gov/ImageRepository/Document?documentID=12855",
    repEmail: "KAgnew@EdinaMN.gov",
    repPhone: "952-833-9556",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.edinamn.gov/m/directory/employee?eid=655" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.edinamn.gov/m/directory/employee?eid=655",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.edinamn.gov/m/directory/employee?eid=655",
  },
  {
    city: "Edina",
    coordinates: [-93.3473318, 44.9110930],
    role: "Council Member",
    repName: "Carolyn Jackson",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.edinamn.gov/ImageRepository/Document?documentID=15559",
    repEmail: "CJackson@EdinaMN.gov",
    repPhone: "952-833-9547",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.edinamn.gov/m/directory/employee?eid=541" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.edinamn.gov/m/directory/employee?eid=541",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.edinamn.gov/m/directory/employee?eid=541",
  },
  {
    city: "Edina",
    coordinates: [-93.3473318, 44.9110930],
    role: "Council Member",
    repName: "James Pierce",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.edinamn.gov/ImageRepository/Document?documentID=14137",
    repEmail: "JPierce@EdinaMN.gov",
    repPhone: "952-833-9548",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.edinamn.gov/m/directory/employee?eid=542" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.edinamn.gov/m/directory/employee?eid=542",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.edinamn.gov/m/directory/employee?eid=542",
  },
  {
    city: "Edina",
    coordinates: [-93.3473318, 44.9110930],
    role: "Council Member",
    repName: "Julie Risser",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.edinamn.gov/ImageRepository/Document?documentID=15558",
    repEmail: "JRisser@EdinaMN.gov",
    repPhone: "952-833-9557",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.edinamn.gov/m/directory/employee?eid=656" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.edinamn.gov/m/directory/employee?eid=656",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.edinamn.gov/m/directory/employee?eid=656",
  },
  // --- Eden Prairie (Hennepin County) — fully at-large, no wards ------------
  //
  // Mayor + 4 council members, all elected citywide (Ballotpedia/GoodParty
  // corroboration, cross-checked against multiple independent search-
  // engine-indexed citations of the city's own edenprairiemn.gov page
  // titles for each name below). edenprairiemn.gov itself returns HTTP 403
  // to every path this pipeline tried — the overview page, every individual
  // council member's own bio page, and a plain top-level fetch — confirmed
  // with this script's own descriptive User-Agent, not just a third-party
  // tool's; not routed around per AGENTS.md §2.2 ("no block evasion"). Name
  // and mayor/council role are corroborated (AGENTS.md §3.3's
  // "corroborated" tier — two-plus independent sources agree) but phone,
  // email, and photo could not be confirmed against a direct render of the
  // primary source, so they ship null rather than the plausible-looking
  // contact details a generic web search surfaced (same red flag as Apple
  // Valley's Hooppaw entry above — those numbers/addresses do not appear on
  // edenprairiemn.gov itself in any fetch this pipeline could complete, so
  // they are not used). Re-attempt a direct fetch before this app's next
  // refresh; the block may be tied to a specific network path, not a
  // permanent policy.
  {
    city: "Eden Prairie",
    coordinates: [-93.4603848, 44.8568070], // Eden Prairie City Center, 8080 Mitchell Rd
    repName: "Ron Case",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.edenprairiemn.gov/city-government/city-council/ron-case" }],
    committees: ["Mayor of Eden Prairie"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.edenprairiemn.gov/city-government/city-council/ron-case",
  },
  {
    city: "Eden Prairie",
    coordinates: [-93.4603848, 44.8568070],
    role: "Council Member",
    repName: "Mark Freiberg",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.edenprairiemn.gov/city-government/city-council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.edenprairiemn.gov/city-government/city-council",
  },
  {
    city: "Eden Prairie",
    coordinates: [-93.4603848, 44.8568070],
    role: "Council Member",
    repName: "PG Narayanan",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.edenprairiemn.gov/city-government/city-council/pg-narayanan" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.edenprairiemn.gov/city-government/city-council/pg-narayanan",
  },
  {
    city: "Eden Prairie",
    coordinates: [-93.4603848, 44.8568070],
    role: "Council Member",
    repName: "Kathy Nelson",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.edenprairiemn.gov/city-government/city-council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.edenprairiemn.gov/city-government/city-council",
  },
  {
    city: "Eden Prairie",
    coordinates: [-93.4603848, 44.8568070],
    role: "Council Member",
    repName: "Lisa Toomey",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.edenprairiemn.gov/city-government/city-council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.edenprairiemn.gov/city-government/city-council",
  },
  // --- Rochester (Olmsted County) — mayor + at-large Council President -----
  //
  // Top-20-by-population batch (2026-08). Unlike every entry above,
  // Rochester is NOT fully at-large: it elects 6 ward councilmembers too
  // (see fetch-wards.mjs's own Rochester section) — only the Mayor and the
  // Council President (an at-large seat, not a second mayor) sit here, at
  // Rochester City Hall's coordinate. Both fetched 2026-08-08 directly from
  // rochestermn.gov.
  {
    city: "Rochester",
    coordinates: [-92.459679, 44.019372], // Rochester City Hall, 201 4th St SE
    repName: "Kim Norton",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.rochestermn.gov/media/lqedgesb/mayor-kim-norton-2025-headshot-2.jpg",
    // The page's own contact line is the Mayor's Office/Executive Assistant
    // inbox, not a personal address of Norton's own — still her office's
    // published contact channel, per AGENTS.md §1a.
    repEmail: "mrogers@rochestermn.gov",
    repPhone: "507-328-2700",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.rochestermn.gov/council-administration/mayor-s-office/" }],
    committees: ["Mayor of Rochester"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.rochestermn.gov/council-administration/mayor-s-office/",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.rochestermn.gov/council-administration/mayor-s-office/",
  },
  {
    city: "Rochester",
    coordinates: [-92.459679, 44.019372],
    role: "Council Member",
    repName: "Randy Schubring",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.rochestermn.gov/media/iwbfbse2/randy-schubring_full.jpg",
    repEmail: "rschubring@rochestermn.gov",
    repPhone: "507-328-2992",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.rochestermn.gov/council-administration/city-council/councilmembers/" }],
    committees: ["Council President"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.rochestermn.gov/council-administration/city-council/councilmembers/",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.rochestermn.gov/council-administration/city-council/councilmembers/",
  },
  // --- Duluth (St. Louis County) — mayor + 4 at-large councilors -----------
  //
  // Same batch as Rochester above. Duluth elects 5 district councilors
  // (fetch-wards.mjs) plus these 4 at-large seats and the Mayor, all at
  // Duluth City Hall's coordinate. Councilor contact info fetched
  // 2026-08-08 from duluthmn.gov/city-council/, which links to each
  // councilor's own individual bio page — that's where photos come from
  // (duluthmn.gov/city-council/city-councilors/<slug>/, same fetch date),
  // since the shared roster page itself carries none. Lynn Marie Nephew's
  // own bio page is the one exception with no photo at all — see her
  // entry's own comment.
  {
    city: "Duluth",
    coordinates: [-92.1052761, 46.7838565], // Duluth City Hall, 411 W 1st St
    repName: "Roger Reinert",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://duluthmn.gov/media/hp3llka2/reinert_roger_formal-headshot_-with-seal.jpg",
    repEmail: "rreinert@duluthmn.gov",
    repPhone: "218-730-5230",
    termsOfService: [{ termStart: "2024-01-01", termEnd: null, current: true, sourceUrl: "https://duluthmn.gov/mayor/" }],
    committees: ["Mayor of Duluth"],
    neighborhoods: [],
    officeRoom: "City Hall, Room 422",
    profileUrl: "https://duluthmn.gov/mayor/",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://duluthmn.gov/mayor/",
  },
  {
    city: "Duluth",
    coordinates: [-92.1052761, 46.7838565],
    role: "Council Member",
    repName: "Jordon Johnson",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://duluthmn.gov/media/4fdmblbq/jordon-johnson-at-large-city-councilor.jpg",
    repEmail: "jjohnson@duluthmn.gov",
    repPhone: "218-730-5359",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://duluthmn.gov/city-council/" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://duluthmn.gov/city-council/",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://duluthmn.gov/city-council/",
  },
  {
    city: "Duluth",
    coordinates: [-92.1052761, 46.7838565],
    role: "Council Member",
    repName: "Arik Forsman",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://duluthmn.gov/media/xsrptm2t/forsman-head-shot.jpg",
    repEmail: "aforsman@duluthmn.gov",
    repPhone: "218-730-5352",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://duluthmn.gov/city-council/" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://duluthmn.gov/city-council/",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://duluthmn.gov/city-council/",
  },
  {
    city: "Duluth",
    coordinates: [-92.1052761, 46.7838565],
    role: "Council Member",
    repName: "Lynn Marie Nephew",
    repParty: NONPARTISAN,
    // The only one of Duluth's 9 councilors whose own bio page (checked
    // 2026-08-08, same pass that found the other 8) carries no photo at
    // all — genuinely absent, not missed.
    repPhotoUrl: null,
    repEmail: "lnephew@duluthmn.gov",
    repPhone: "218-730-5354",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://duluthmn.gov/city-council/" }],
    committees: ["Council President"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://duluthmn.gov/city-council/",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://duluthmn.gov/city-council/",
  },
  {
    city: "Duluth",
    coordinates: [-92.1052761, 46.7838565],
    role: "Council Member",
    repName: "Terese Tomanek",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://duluthmn.gov/media/12005/headshot.jpg",
    repEmail: "ttomanek@duluthmn.gov",
    repPhone: "218-730-5358",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://duluthmn.gov/city-council/" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://duluthmn.gov/city-council/",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://duluthmn.gov/city-council/",
  },
  // --- St. Cloud (Stearns / Sherburne / Benton Counties) — mayor + 3 -------
  //     at-large councilors
  //
  // Same batch as Rochester/Duluth above. St. Cloud elects 4 ward
  // councilmembers (fetch-wards.mjs) plus these 3 at-large seats and the
  // Mayor, all at St. Cloud City Hall's coordinate. Emails from the council
  // page; phones and photos from each member's own directory.aspx sub-page
  // linked off it (ci.stcloud.mn.us/Directory.aspx?eid=N) — both fetched
  // 2026-08-08.
  {
    city: "St. Cloud",
    coordinates: [-94.165496, 45.553142], // St. Cloud City Hall, 1201 7th St S
    repName: "Jake Anderson",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.ci.stcloud.mn.us/ImageRepository/Document?documentID=29161",
    repEmail: "Jake.Anderson@ci.stcloud.mn.us",
    repPhone: "320-255-7201",
    termsOfService: [{ termStart: "2024-11-01", termEnd: null, current: true, sourceUrl: "https://www.ci.stcloud.mn.us/82/Mayors-Office" }],
    committees: ["Mayor of St. Cloud"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.ci.stcloud.mn.us/82/Mayors-Office",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.ci.stcloud.mn.us/82/Mayors-Office",
  },
  {
    city: "St. Cloud",
    coordinates: [-94.165496, 45.553142],
    role: "Council Member",
    repName: "Scott Brodeen",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.ci.stcloud.mn.us/ImageRepository/Document?documentID=28673",
    repEmail: "scott.brodeen@ci.stcloud.mn.us",
    repPhone: "651-246-4936",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.ci.stcloud.mn.us/81/City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.ci.stcloud.mn.us/81/City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.ci.stcloud.mn.us/Directory.aspx?DID=35",
  },
  {
    city: "St. Cloud",
    coordinates: [-94.165496, 45.553142],
    role: "Council Member",
    repName: "Tami Calhoun",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.ci.stcloud.mn.us/ImageRepository/Document?documentID=28669",
    repEmail: "tami.calhoun@ci.stcloud.mn.us",
    repPhone: "320-267-9366",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.ci.stcloud.mn.us/81/City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.ci.stcloud.mn.us/81/City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.ci.stcloud.mn.us/Directory.aspx?DID=35",
  },
  {
    city: "St. Cloud",
    coordinates: [-94.165496, 45.553142],
    role: "Council Member",
    repName: "Mark Johnson",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.ci.stcloud.mn.us/ImageRepository/Document?documentID=28675",
    repEmail: "mark.johnson@ci.stcloud.mn.us",
    repPhone: "320-420-8745",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.ci.stcloud.mn.us/81/City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.ci.stcloud.mn.us/81/City-Council",
    verifiedAt: "2026-08-08",
    verifiedAgainst: "https://www.ci.stcloud.mn.us/Directory.aspx?DID=35",
  },
  // --- 2026-08 batch: mayors for 5 cities that already had ward rosters
  // here (fetch-wards.mjs) but no mayor entry — every one of these is a
  // real elected office (MN statutory cities all have one); the gap was
  // only ever a missing roster row, never a structural absence. Coordinates
  // via OpenStreetMap/Nominatim geocoding of each City Hall address, not
  // eyeballed, same as every entry above.
  {
    city: "Champlin",
    coordinates: [-93.3956, 45.1713], // Champlin City Hall
    repName: "Ryan Sabas",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.champlinmn.gov/ImageRepository/Document?documentID=2085",
    repEmail: "rsabas@champlinmn.gov",
    // No individual phone published for the mayor — the page lists only a
    // general City Hall line and a City Clerk line, neither attributed to
    // him by name, so repPhone stays null rather than substituting either.
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.champlinmn.gov/277/Mayor-City-Council" }],
    committees: ["Mayor of Champlin"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.champlinmn.gov/277/Mayor-City-Council",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.champlinmn.gov/277/Mayor-City-Council",
  },
  {
    city: "Crystal",
    coordinates: [-93.3606391, 45.0320088], // Crystal City Hall
    repName: "Julie Deshler",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.crystalmn.gov/UserFiles/Servers/Server_10879634/Image/Government/City%20Council/Deshler-web.jpg",
    repEmail: "julie.deshler2@crystalmn.gov",
    repPhone: "612-306-5808",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.crystalmn.gov/government/city_council" }],
    committees: ["Mayor of Crystal"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.crystalmn.gov/government/city_council",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.crystalmn.gov/government/city_council",
  },
  {
    city: "Robbinsdale",
    coordinates: [-93.3353832, 45.0317151], // Robbinsdale City Hall
    repName: "Brad Sutton",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.robbinsdalemn.gov/ImageRepository/Document?documentID=1544",
    repEmail: "bsutton@robbinsdalemn.gov",
    repPhone: "763-232-0556",
    // "Brad Sutton was sworn in as Mayor on January 7, 2025" — stated
    // verbatim on his own bio page, not back-calculated.
    termsOfService: [{ termStart: "2025-01-07", termEnd: null, current: true, sourceUrl: "https://www.robbinsdalemn.gov/m/directory/employee?eid=6" }],
    committees: ["Mayor of Robbinsdale"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.robbinsdalemn.gov/m/directory/employee?eid=6",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.robbinsdalemn.gov/m/directory/employee?eid=6",
  },
  {
    city: "Fridley",
    coordinates: [-93.2632944, 45.0966451], // Fridley Municipal Center
    repName: "Dave Ostwald",
    repParty: NONPARTISAN,
    // fridleymn.gov returns HTTP 403 to every automated fetch — same block
    // fetch-wards.mjs's own Fridley comment already documents, not routed
    // around per AGENTS.md §2.2. Won the Nov 5, 2024 general election
    // (75.69% to 23.56% over Natividad Seefeld), defeating 24-year
    // incumbent Scott Lund, who did not seek re-election — per
    // hometownsource.com/ABC Newspapers, corroborated by Ballotpedia's 2024
    // candidate page (AGENTS.md §3.3 "corroborated" tier, not "confirmed").
    // Email is search-index-cached text from the city's own resident
    // welcome packet PDF (same FirstName.LastName@FridleyMN.gov pattern the
    // prior mayor's welcome packet used) rather than a direct render.
    // Phone and photo could not be confirmed against a direct render of the
    // primary source and ship null rather than a plausible-looking but
    // unverified value — a phone number surfaced attached to his name in
    // search results, but the caching may predate the election, so it's
    // not used. No term-start date is published anywhere reachable.
    repPhotoUrl: null,
    repEmail: "Dave.Ostwald@FridleyMN.gov",
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.fridleymn.gov/Your-Government/City-Council-Commissions/Meet-Your-Council/Dave-Ostwald" }],
    committees: ["Mayor of Fridley"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.fridleymn.gov/Your-Government/City-Council-Commissions/Meet-Your-Council/Dave-Ostwald",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.fridleymn.gov/Your-Government/City-Council-Commissions/Meet-Your-Council/Dave-Ostwald",
  },
  {
    city: "Ramsey",
    coordinates: [-93.4597832, 45.2327342], // Ramsey Municipal Center
    repName: "Ryan Heineman",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.cityoframseymn.gov/media/35tl2qz3/document.jpg",
    // Individual staff emails use the cityoframsey.com domain, distinct
    // from the site's own cityoframseymn.gov domain — verified in the
    // page's raw HTML, not a transcription error (same distinction
    // fetch-wards.mjs's own RAMSEY_ROSTER already carries).
    repEmail: "rheineman@cityoframsey.com",
    repPhone: "763-576-4367",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.cityoframseymn.gov/city-hall/council/elected-officials/" }],
    committees: ["Mayor of Ramsey"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.cityoframseymn.gov/city-hall/council/elected-officials/",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.cityoframseymn.gov/city-hall/council/elected-officials/",
  },
  // --- 2026-08 batch: 12 new at-large cities, sourced from links supplied
  // directly by the maintainer during this session's research pass — not a
  // population-ranked batch like the top-20 one above. All fully at-large
  // (mayor + 4 council members elected citywide, no wards), same shape as
  // Woodbury/Eagan/Lakeville/Maple Grove/Apple Valley/Burnsville/Edina/Eden
  // Prairie above — each city's own site states this directly except where
  // flagged per-city below. Coordinates via OpenStreetMap/Nominatim
  // geocoding of each City Hall address, not eyeballed. No term-start
  // dates are published for any of these officials except where explicitly
  // stated per-person below — never back-calculated from a term-expiration
  // date. A 13th city researched this same session, Rogers (Hennepin), is
  // deliberately NOT included here — see src/lib/sourcesRegistry.ts's
  // KNOWN_ROSTER_GAPS for why.
  //
  // Golden Valley (Hennepin) — "All Council members serve at large to
  // represent the entire community," goldenvalleymn.gov/180/City-Council,
  // fetched directly (HTTP 200, robots.txt permits this path).
  {
    city: "Golden Valley",
    coordinates: [-93.3794744, 44.9859974], // Golden Valley City Hall
    repName: "Roslyn Harmon",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://goldenvalleymn.gov/ImageRepository/Document?documentID=3761",
    repEmail: "rharmon@goldenvalleymn.gov",
    repPhone: "952-463-0630",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://goldenvalleymn.gov/180/City-Council" }],
    committees: ["Mayor of Golden Valley"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://goldenvalleymn.gov/180/City-Council",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://goldenvalleymn.gov/180/City-Council",
  },
  {
    city: "Golden Valley",
    coordinates: [-93.3794744, 44.9859974],
    role: "Council Member",
    repName: "Sophia Ginis",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://goldenvalleymn.gov/ImageRepository/Document?documentID=5561",
    repEmail: "sginis@goldenvalleymn.gov",
    repPhone: "763-340-1271",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://goldenvalleymn.gov/180/City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://goldenvalleymn.gov/180/City-Council",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://goldenvalleymn.gov/180/City-Council",
  },
  {
    city: "Golden Valley",
    coordinates: [-93.3794744, 44.9859974],
    role: "Council Member",
    repName: "Maurice Harris",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://goldenvalleymn.gov/ImageRepository/Document?documentID=121",
    repEmail: "mharris@goldenvalleymn.gov",
    repPhone: "612-567-2584",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://goldenvalleymn.gov/180/City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://goldenvalleymn.gov/180/City-Council",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://goldenvalleymn.gov/180/City-Council",
  },
  {
    city: "Golden Valley",
    coordinates: [-93.3794744, 44.9859974],
    role: "Council Member",
    repName: "Tracey Fussy",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://goldenvalleymn.gov/ImageRepository/Document?documentID=5560",
    repEmail: "tfussy@goldenvalleymn.gov",
    repPhone: "952-495-5562",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://goldenvalleymn.gov/180/City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://goldenvalleymn.gov/180/City-Council",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://goldenvalleymn.gov/180/City-Council",
  },
  {
    city: "Golden Valley",
    coordinates: [-93.3794744, 44.9859974],
    role: "Council Member",
    repName: "Chris Queitzsch",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://goldenvalleymn.gov/ImageRepository/Document?documentID=5562",
    repEmail: "cqueitzsch@goldenvalleymn.gov",
    repPhone: "952-428-8922",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://goldenvalleymn.gov/180/City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://goldenvalleymn.gov/180/City-Council",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://goldenvalleymn.gov/180/City-Council",
  },
  // New Hope (Hennepin) — "The mayor and four council members all serve
  // the community at large," newhopemn.gov/city_hall/city_council,
  // fetched directly (HTTP 200, robots.txt permits this path). Emails
  // decoded from the page's own Cloudflare email-obfuscation markup (same
  // documented, non-bypass decode Robbinsdale's ROBBINSDALE_ROSTER already
  // uses in fetch-wards.mjs), not a rendering workaround.
  {
    city: "New Hope",
    coordinates: [-93.3861886, 45.0346362], // New Hope City Hall
    repName: "John Elder",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://cdnsm5-hosted.civiclive.com/UserFiles/Servers/Server_9826625/Image/City%20Hall/City%20Council/Council%20Members/Elder.jpg",
    repEmail: "jelder@newhopemn.gov",
    repPhone: "763-341-1350",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.newhopemn.gov/city_hall/city_council/council_members" }],
    committees: ["Mayor of New Hope"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.newhopemn.gov/city_hall/city_council/council_members",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.newhopemn.gov/city_hall/city_council/council_members",
  },
  {
    city: "New Hope",
    coordinates: [-93.3861886, 45.0346362],
    role: "Council Member",
    repName: "Kyle Coryell",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://cdnsm5-hosted.civiclive.com/UserFiles/Servers/Server_9826625/Image/City%20Hall/City%20Council/Council%20Members/Coryell,%20Kyle.JPG",
    repEmail: "kcoryell@newhopemn.gov",
    repPhone: "763-250-1177",
    // Bio text: "appointed to the New Hope City Council in January 2025 to
    // fill a vacant seat" — month/year stated, no exact day; Jan 1 stands
    // in for the unstated day within that stated month, same convention
    // Robbinsdale's bare-year case already uses in fetch-wards.mjs.
    termsOfService: [{ termStart: "2025-01-01", termEnd: null, current: true, sourceUrl: "https://www.newhopemn.gov/city_hall/city_council/council_members" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.newhopemn.gov/city_hall/city_council/council_members",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.newhopemn.gov/city_hall/city_council/council_members",
  },
  {
    city: "New Hope",
    coordinates: [-93.3861886, 45.0346362],
    role: "Council Member",
    repName: "Michael Isenberg",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://cdnsm5-hosted.civiclive.com/UserFiles/Servers/Server_9826625/Image/City%20Hall/City%20Council/Council%20Members/MIsenberg.jpg",
    repEmail: "misenberg@newhopemn.gov",
    repPhone: "612-568-2337",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.newhopemn.gov/city_hall/city_council/council_members" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.newhopemn.gov/city_hall/city_council/council_members",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.newhopemn.gov/city_hall/city_council/council_members",
  },
  {
    city: "New Hope",
    coordinates: [-93.3861886, 45.0346362],
    role: "Council Member",
    repName: "Jonathan London",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://cdnsm5-hosted.civiclive.com/UserFiles/Servers/Server_9826625/Image/City%20Hall/City%20Council/Council%20Members/London.jpg",
    repEmail: "jlondon@newhopemn.gov",
    repPhone: "763-546-1293",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.newhopemn.gov/city_hall/city_council/council_members" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.newhopemn.gov/city_hall/city_council/council_members",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.newhopemn.gov/city_hall/city_council/council_members",
  },
  {
    city: "New Hope",
    coordinates: [-93.3861886, 45.0346362],
    role: "Council Member",
    repName: "Brock Ray",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://cdnsm5-hosted.civiclive.com/UserFiles/Servers/Server_9826625/Image/City%20Hall/City%20Council/Council%20Members/Ray,%20Brock.JPG",
    repEmail: "bray@newhopemn.gov",
    repPhone: "612-481-0566",
    // Bio text: "appointed to the New Hope City Council in August 2025 to
    // fill a vacant seat" — same month/year-only convention as Coryell above.
    termsOfService: [{ termStart: "2025-08-01", termEnd: null, current: true, sourceUrl: "https://www.newhopemn.gov/city_hall/city_council/council_members" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.newhopemn.gov/city_hall/city_council/council_members",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.newhopemn.gov/city_hall/city_council/council_members",
  },
  // Columbia Heights (Anoka) — "a five-member council, consisting of a
  // mayor and four council members who are elected at large on a
  // nonpartisan basis," columbiaheightsmn.gov/city_council_commissions/
  // city_council.php. Independently corroborated no-wards via Anoka
  // County's own precinct layer (WARD field blank for all 8 Columbia
  // Heights precincts). columbiaheightsmn.gov/robots.txt blanket-disallows
  // every crawler except five named commercial ones (Googlebot, Bingbot,
  // FacebookBot, LinkedInBot, Twitterbot) — same class of conflict as
  // cfb.mn.gov's flagged in commit e9f7f29; this data is a one-time
  // hand-transcription (this whole file's own stated model, see header
  // comment), not a target for a recurring automated fetcher, per
  // AGENTS.md §2.2's "a source that cannot be fetched politely gets a
  // knownGaps entry and a manual workflow, not a workaround."
  {
    city: "Columbia Heights",
    coordinates: [-93.2469559, 45.0405879], // Columbia Heights City Hall
    repName: "Amáda Márquez Simula",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.columbiaheightsmn.gov/Images/Government/City%20Council%20Commissions/City%20Council/Amada%20Marquez%20Simula.jpg",
    repEmail: "amarquezsimula@columbiaheightsmn.gov",
    repPhone: "763-706-3607",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.columbiaheightsmn.gov/city_council_commissions/city_council.php" }],
    committees: ["Mayor of Columbia Heights"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.columbiaheightsmn.gov/city_council_commissions/city_council.php",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.columbiaheightsmn.gov/city_council_commissions/city_council.php",
  },
  {
    city: "Columbia Heights",
    coordinates: [-93.2469559, 45.0405879],
    role: "Council Member",
    repName: "Connie Buesgens",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.columbiaheightsmn.gov/Images/Government/City%20Council%20Commissions/City%20Council/Buesgens%20-%20Copy%20(2).jpg",
    repEmail: "cbuesgens@columbiaheightsmn.gov",
    repPhone: "612-314-9776",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.columbiaheightsmn.gov/city_council_commissions/city_council.php" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.columbiaheightsmn.gov/city_council_commissions/city_council.php",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.columbiaheightsmn.gov/city_council_commissions/city_council.php",
  },
  {
    city: "Columbia Heights",
    coordinates: [-93.2469559, 45.0405879],
    role: "Council Member",
    repName: "Laurel Deneen",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.columbiaheightsmn.gov/Images/Headshots/Laurel_Deneen_Headshot.jpg",
    repEmail: "LDeneen@columbiaheightsmn.gov",
    repPhone: "763-706-3620",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.columbiaheightsmn.gov/city_council_commissions/city_council.php" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.columbiaheightsmn.gov/city_council_commissions/city_council.php",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.columbiaheightsmn.gov/city_council_commissions/city_council.php",
  },
  {
    city: "Columbia Heights",
    coordinates: [-93.2469559, 45.0405879],
    role: "Council Member",
    repName: "Rachel James",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.columbiaheightsmn.gov/Images/Headshots/Rachel_James_Headshot.jpg",
    repEmail: "rjames@columbiaheightsmn.gov",
    repPhone: "763-706-3619",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.columbiaheightsmn.gov/city_council_commissions/city_council.php" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.columbiaheightsmn.gov/city_council_commissions/city_council.php",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.columbiaheightsmn.gov/city_council_commissions/city_council.php",
  },
  {
    city: "Columbia Heights",
    coordinates: [-93.2469559, 45.0405879],
    role: "Council Member",
    repName: "Justice Spriggs",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.columbiaheightsmn.gov/Images/Government/City%20Council%20Commissions/City%20Council/Justice%20Spriggs.jpg",
    repEmail: "jspriggs@columbiaheightsmn.gov",
    repPhone: "763-706-3617",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.columbiaheightsmn.gov/city_council_commissions/city_council.php" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.columbiaheightsmn.gov/city_council_commissions/city_council.php",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.columbiaheightsmn.gov/city_council_commissions/city_council.php",
  },
  // Dayton (spans Hennepin, Wright, and Anoka Counties) — daytonmn.gov
  // itself never uses the words "at large," "ward," or "district" anywhere
  // (checked the mayor/council page, the elections page, and the sitemap);
  // at-large is corroborated, not primary-confirmed, via Minn. Stat.
  // § 412.02's opt-in ward mechanism (no such ordinance found) plus an
  // unofficial legacy city page (daytonmn.com, non-.gov, ~2004-2006-era)
  // stating the structure directly. The only photo on the roster page is
  // one shared group photo with no per-person labeling — not safely
  // attributable to any individual, so repPhotoUrl is null for all five
  // rather than guessed. No individual phone is published for anyone
  // either (only the City Administrator's general line).
  {
    city: "Dayton",
    coordinates: [-93.4372508, 45.1994127], // Dayton City Hall
    repName: "Dennis Fisher",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "dfisher@daytonmn.gov",
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.daytonmn.gov/government/mayor_council.php" }],
    committees: ["Mayor of Dayton"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.daytonmn.gov/government/mayor_council.php",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.daytonmn.gov/government/mayor_council.php",
  },
  {
    city: "Dayton",
    coordinates: [-93.4372508, 45.1994127],
    role: "Council Member",
    repName: "Scott Salonek",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "ssalonek@daytonmn.gov",
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.daytonmn.gov/government/mayor_council.php" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.daytonmn.gov/government/mayor_council.php",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.daytonmn.gov/government/mayor_council.php",
  },
  {
    city: "Dayton",
    coordinates: [-93.4372508, 45.1994127],
    role: "Council Member",
    repName: "David Fashant",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "dfashant@daytonmn.gov",
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.daytonmn.gov/government/mayor_council.php" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.daytonmn.gov/government/mayor_council.php",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.daytonmn.gov/government/mayor_council.php",
  },
  {
    city: "Dayton",
    coordinates: [-93.4372508, 45.1994127],
    role: "Council Member",
    repName: "Sara Van Asten",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "svanasten@daytonmn.gov",
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.daytonmn.gov/government/mayor_council.php" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.daytonmn.gov/government/mayor_council.php",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.daytonmn.gov/government/mayor_council.php",
  },
  {
    city: "Dayton",
    coordinates: [-93.4372508, 45.1994127],
    role: "Council Member",
    repName: "Stephanie Henderson",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "shenderson@daytonmn.gov",
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.daytonmn.gov/government/mayor_council.php" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.daytonmn.gov/government/mayor_council.php",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.daytonmn.gov/government/mayor_council.php",
  },
  // Hopkins (Hennepin) — "The City of Hopkins does not have wards or
  // districts. All members of the City Council are elected from the city
  // at-large," hopkinsmn.com/345/About-the-City-Council. Every field below
  // verified twice (WebFetch + raw curl grep on the literal <img src> and
  // mailto: markup); no discrepancies. No term-start dates are published,
  // only "Term expires" years.
  {
    city: "Hopkins",
    coordinates: [-93.413564, 44.9219727], // Hopkins City Hall
    repName: "Patrick Hanlon",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.hopkinsmn.com/ImageRepository/Document?documentId=5063",
    repEmail: "phanlon@hopkinsmn.com",
    repPhone: "612-440-9689",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.hopkinsmn.com/1105/Patrick-Hanlon" }],
    committees: ["Mayor of Hopkins"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.hopkinsmn.com/1105/Patrick-Hanlon",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.hopkinsmn.com/1105/Patrick-Hanlon",
  },
  {
    city: "Hopkins",
    coordinates: [-93.413564, 44.9219727],
    role: "Council Member",
    repName: "Heidi Garrido",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.hopkinsmn.com/ImageRepository/Document?documentId=5061",
    repEmail: "hgarrido@hopkinsmn.com",
    repPhone: "952-395-1429",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.hopkinsmn.com/1107/Heidi-Garrido" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.hopkinsmn.com/1107/Heidi-Garrido",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.hopkinsmn.com/1107/Heidi-Garrido",
  },
  {
    city: "Hopkins",
    coordinates: [-93.413564, 44.9219727],
    role: "Council Member",
    repName: "Ben Goodlund",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.hopkinsmn.com/ImageRepository/Document?documentId=5057",
    repEmail: "bgoodlund@hopkinsmn.com",
    repPhone: "651-236-0744",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.hopkinsmn.com/1166/Ben-Goodlund" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.hopkinsmn.com/1166/Ben-Goodlund",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.hopkinsmn.com/1166/Ben-Goodlund",
  },
  {
    city: "Hopkins",
    coordinates: [-93.413564, 44.9219727],
    role: "Council Member",
    repName: "Brian Hunke",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.hopkinsmn.com/ImageRepository/Document?documentId=5058",
    repEmail: "bhunke@hopkinsmn.com",
    repPhone: "612-703-3180",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.hopkinsmn.com/802/Brian-Hunke" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.hopkinsmn.com/802/Brian-Hunke",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.hopkinsmn.com/802/Brian-Hunke",
  },
  {
    city: "Hopkins",
    coordinates: [-93.413564, 44.9219727],
    role: "Council Member",
    repName: "Aaron Kuznia",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.hopkinsmn.com/ImageRepository/Document?documentId=5056",
    repEmail: "akuznia@hopkinsmn.com",
    repPhone: "952-913-6582",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.hopkinsmn.com/1190/Aaron-Kuznia" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.hopkinsmn.com/1190/Aaron-Kuznia",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.hopkinsmn.com/1190/Aaron-Kuznia",
  },
  // Deephaven (Hennepin) — no page states "at large" verbatim, but Code of
  // Ordinances Ch. 2 (200.01: "The Council will consist of a Mayor and
  // four Council Members") never mentions wards, and §225.04(a) states the
  // city operates under "a Plan A form of municipal government," which
  // elects at-large by default absent a separate ward ordinance (none
  // found) — corroborated, not a direct quote. Data-quality anomaly worth
  // flagging: the roster page's DISPLAYED email text for all five officials
  // reads FirstinitialLast@deephaven.gov, but the underlying mailto: hrefs
  // for four of five point to unrelated personal addresses (a Yahoo
  // address, a realty-firm domain, a Gmail address, a personal business
  // domain) — almost certainly a stale template bug on the city's own
  // site, not this pipeline's error. Per AGENTS.md §1b, only the displayed
  // @deephaven.gov-style text is used below; the personal-looking href
  // values are never ingested. No individual phone or photo is published
  // for anyone (only the city logo appears on the page).
  {
    city: "Deephaven",
    coordinates: [-93.536875, 44.9226019], // Deephaven City Hall
    repName: "Kent Carlson",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "KentC@deephaven.gov",
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://deephaven.gov/city-council/" }],
    committees: ["Mayor of Deephaven"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://deephaven.gov/city-council/",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://deephaven.gov/city-council/",
  },
  {
    city: "Deephaven",
    coordinates: [-93.536875, 44.9226019],
    role: "Council Member",
    repName: "Tom Erdmann",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "TomE@deephaven.gov",
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://deephaven.gov/city-council/" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://deephaven.gov/city-council/",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://deephaven.gov/city-council/",
  },
  {
    city: "Deephaven",
    coordinates: [-93.536875, 44.9226019],
    role: "Council Member",
    repName: "Tony Jewett",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "TonyJ@deephaven.gov",
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://deephaven.gov/city-council/" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://deephaven.gov/city-council/",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://deephaven.gov/city-council/",
  },
  {
    city: "Deephaven",
    coordinates: [-93.536875, 44.9226019],
    role: "Council Member",
    repName: "Emily Scherschligt",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "EmilyS@deephaven.gov",
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://deephaven.gov/city-council/" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://deephaven.gov/city-council/",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://deephaven.gov/city-council/",
  },
  {
    city: "Deephaven",
    coordinates: [-93.536875, 44.9226019],
    role: "Council Member",
    repName: "John Studer",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "JohnS@deephaven.gov",
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://deephaven.gov/city-council/" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://deephaven.gov/city-council/",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://deephaven.gov/city-council/",
  },
  // Medina (Hennepin) — "council members are elected at-large to serve
  // four-year terms," medinamn.gov/Services/Elections-Voting/Candidate-Filing.
  {
    city: "Medina",
    coordinates: [-93.574483, 45.0159359], // Medina City Hall
    repName: "Todd Albers",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.medinamn.gov/files/assets/city/v/5/admin/images/council-members/todd-albers.jpg",
    repEmail: "todd.albers@medinamn.gov",
    repPhone: "763-360-5532",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.medinamn.gov/Government/City-Council/Elected-Officials/Todd-Albers" }],
    committees: ["Mayor of Medina"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.medinamn.gov/Government/City-Council/Elected-Officials/Todd-Albers",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.medinamn.gov/Government/City-Council/Elected-Officials/Todd-Albers",
  },
  {
    city: "Medina",
    coordinates: [-93.574483, 45.0159359],
    role: "Council Member",
    repName: "Dino DesLauriers",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.medinamn.gov/files/assets/city/v/4/admin/images/council-members/dino-deslauriers.jpg",
    repEmail: "dino.deslauriers@medinamn.gov",
    repPhone: "612-812-3290",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.medinamn.gov/Government/City-Council/Elected-Officials/Dino-DesLauriers" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.medinamn.gov/Government/City-Council/Elected-Officials/Dino-DesLauriers",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.medinamn.gov/Government/City-Council/Elected-Officials/Dino-DesLauriers",
  },
  {
    city: "Medina",
    coordinates: [-93.574483, 45.0159359],
    role: "Council Member",
    repName: "Braden Rhem",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.medinamn.gov/files/assets/city/v/2/admin/images/council-members/braden-rhem.jpeg",
    repEmail: "braden.rhem@medinamn.gov",
    repPhone: "612-889-4477",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.medinamn.gov/Government/City-Council/Elected-Officials/Braden-Rhem" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.medinamn.gov/Government/City-Council/Elected-Officials/Braden-Rhem",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.medinamn.gov/Government/City-Council/Elected-Officials/Braden-Rhem",
  },
  {
    city: "Medina",
    coordinates: [-93.574483, 45.0159359],
    role: "Council Member",
    repName: "Mary Morrison",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.medinamn.gov/files/assets/city/v/1/admin/images/council-members/mary-morrison.jpg",
    repEmail: "mary.morrison@medinamn.gov",
    // Genuinely absent from the source (confirmed no phone element on her
    // roster row or her own profile page), not a scraping gap.
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.medinamn.gov/Government/City-Council/Elected-Officials/Mary-Morrison" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.medinamn.gov/Government/City-Council/Elected-Officials/Mary-Morrison",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.medinamn.gov/Government/City-Council/Elected-Officials/Mary-Morrison",
  },
  {
    city: "Medina",
    coordinates: [-93.574483, 45.0159359],
    role: "Council Member",
    repName: "John Jacob",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.medinamn.gov/files/assets/city/v/2/admin/images/council-members/john-jacob.jpeg",
    repEmail: "john.jacob@medinamn.gov",
    repPhone: "612-669-6094",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.medinamn.gov/Government/City-Council/Elected-Officials/John-Jacob" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.medinamn.gov/Government/City-Council/Elected-Officials/John-Jacob",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.medinamn.gov/Government/City-Council/Elected-Officials/John-Jacob",
  },
  // Hilltop (Anoka) — one of Minnesota's smallest cities (~950 residents,
  // an enclave inside Columbia Heights). hilltopmn.gov never states
  // "at large" (or "ward"), and its officials sub-pages are structurally
  // empty stubs (title only, no contact fields at all) — at-large is
  // corroborated via Minn. Stat. § 412.02 (mayor as a separately-elected
  // office; wards are opt-in, none found for Hilltop) and the Anoka County
  // Public Officials Guide, which lists Wiggin under his own "Mayor" row
  // distinct from the four "Council Member" rows. Every contact field
  // below is a genuine, confirmed-absent gap, not a fetch failure — the
  // only phone found anywhere is the shared City Hall line
  // (763-571-2023), not attributed to any individual.
  {
    city: "Hilltop",
    coordinates: [-93.2503342, 45.0525289], // Hilltop City Hall
    repName: "Terry Wiggin",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://hilltopmn.gov/government" }],
    committees: ["Mayor of Hilltop"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://hilltopmn.gov/government",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://hilltopmn.gov/government",
  },
  {
    city: "Hilltop",
    coordinates: [-93.2503342, 45.0525289],
    role: "Council Member",
    repName: "Linda Johnson",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://hilltopmn.gov/government" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://hilltopmn.gov/government",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://hilltopmn.gov/government",
  },
  {
    city: "Hilltop",
    coordinates: [-93.2503342, 45.0525289],
    role: "Council Member",
    repName: "James E. Shear",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://hilltopmn.gov/government" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://hilltopmn.gov/government",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://hilltopmn.gov/government",
  },
  {
    city: "Hilltop",
    coordinates: [-93.2503342, 45.0525289],
    role: "Council Member",
    repName: "Casey Gunter",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://hilltopmn.gov/government" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://hilltopmn.gov/government",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://hilltopmn.gov/government",
  },
  {
    city: "Hilltop",
    coordinates: [-93.2503342, 45.0525289],
    role: "Council Member",
    repName: "Betty Risdahl",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: null,
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://hilltopmn.gov/government" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://hilltopmn.gov/government",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://hilltopmn.gov/government",
  },
  // Wayzata (Hennepin) — "the Council members are elected at-large,"
  // wayzata.org/485/Wayzata-City-Council-Elections. Also the one city this
  // batch where "elected on a non-partisan basis" appears as a direct
  // quote on the city's own site, not just the statutory default.
  {
    city: "Wayzata",
    coordinates: [-93.5122185, 44.970839], // Wayzata City Hall
    repName: "Andrew Mullin",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.wayzata.org/ImageRepository/Document?documentID=6428",
    repEmail: "AMullin@wayzata.org",
    repPhone: "952-404-5327",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.wayzata.org/153/City-Council" }],
    committees: ["Mayor of Wayzata"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.wayzata.org/153/City-Council",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.wayzata.org/153/City-Council",
  },
  {
    city: "Wayzata",
    coordinates: [-93.5122185, 44.970839],
    role: "Council Member",
    repName: "Dan Koch",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.wayzata.org/ImageRepository/Document?documentID=6430",
    repEmail: "dkoch@wayzata.org",
    repPhone: "612-499-3145",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.wayzata.org/153/City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.wayzata.org/153/City-Council",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.wayzata.org/153/City-Council",
  },
  {
    city: "Wayzata",
    coordinates: [-93.5122185, 44.970839],
    role: "Council Member",
    repName: "Molly MacDonald",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.wayzata.org/ImageRepository/Document?documentID=6432",
    repEmail: "mmacdonald@wayzata.org",
    repPhone: "612-384-0990",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.wayzata.org/153/City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.wayzata.org/153/City-Council",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.wayzata.org/153/City-Council",
  },
  {
    city: "Wayzata",
    coordinates: [-93.5122185, 44.970839],
    role: "Council Member",
    repName: "Alex Plechash",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.wayzata.org/ImageRepository/Document?documentID=6429",
    repEmail: "AlexPlechash@wayzata.org",
    repPhone: "612-801-8222",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.wayzata.org/153/City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.wayzata.org/153/City-Council",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.wayzata.org/153/City-Council",
  },
  {
    city: "Wayzata",
    coordinates: [-93.5122185, 44.970839],
    role: "Council Member",
    repName: "Ken Sorensen",
    repParty: NONPARTISAN,
    repPhotoUrl: "https://www.wayzata.org/ImageRepository/Document?documentID=6431",
    repEmail: "ksorensen@wayzata.org",
    repPhone: "612-270-5258",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.wayzata.org/153/City-Council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.wayzata.org/153/City-Council",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.wayzata.org/153/City-Council",
  },
  // Corcoran (Hennepin) — "City council members serve at large,"
  // corcoranmn.gov/our_government/council. Emails decoded from the page's
  // own Cloudflare email-obfuscation markup (same non-bypass decode as New
  // Hope above). Photo filenames below carry literal duplicate/extra
  // closing parentheses (e.g. "(final edit))).png") — verified live,
  // 200 OK; a server-side authoring artifact, not a transcription error.
  {
    city: "Corcoran",
    coordinates: [-93.5427607, 45.1021846], // Corcoran City Hall
    repName: "Tom McKee",
    repParty: NONPARTISAN,
    repPhotoUrl:
      "https://www.corcoranmn.gov/UserFiles/Servers/Server_15543680/Image/Our%20Community/Council/Mayor%20Tom%20McKee%20(final%20edit)).png",
    repEmail: "tmckee@corcoranmn.gov",
    repPhone: "612-803-8101",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.corcoranmn.gov/our_government/council" }],
    committees: ["Mayor of Corcoran"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.corcoranmn.gov/our_government/council",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.corcoranmn.gov/our_government/council",
  },
  {
    city: "Corcoran",
    coordinates: [-93.5427607, 45.1021846],
    role: "Council Member",
    repName: "Michelle Friedrich",
    repParty: NONPARTISAN,
    repPhotoUrl:
      "https://www.corcoranmn.gov/UserFiles/Servers/Server_15543680/Image/Our%20Community/Council/Councilmember%20Michelle%20Friedrich%20(final%20edit).png",
    repEmail: "michelle.friedrich@corcoranmn.gov",
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.corcoranmn.gov/our_government/council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.corcoranmn.gov/our_government/council",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.corcoranmn.gov/our_government/council",
  },
  {
    city: "Corcoran",
    coordinates: [-93.5427607, 45.1021846],
    role: "Council Member",
    repName: "Mark Lanterman",
    repParty: NONPARTISAN,
    repPhotoUrl:
      "https://www.corcoranmn.gov/UserFiles/Servers/Server_15543680/Image/Our%20Community/Council/Councilmember%20Mark%20Lanterman%20(final%20edit)).png",
    repEmail: "mlanterman@corcoranmn.gov",
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.corcoranmn.gov/our_government/council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.corcoranmn.gov/our_government/council",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.corcoranmn.gov/our_government/council",
  },
  {
    city: "Corcoran",
    coordinates: [-93.5427607, 45.1021846],
    role: "Council Member",
    repName: "Jeremy Nichols",
    repParty: NONPARTISAN,
    repPhotoUrl:
      "https://www.corcoranmn.gov/UserFiles/Servers/Server_15543680/Image/Our%20Community/Council/Councilmember%20Jeremy%20Nichols%20(final%20edit).png",
    repEmail: "jnichols@corcoranmn.gov",
    repPhone: null,
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.corcoranmn.gov/our_government/council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.corcoranmn.gov/our_government/council",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.corcoranmn.gov/our_government/council",
  },
  {
    city: "Corcoran",
    coordinates: [-93.5427607, 45.1021846],
    role: "Council Member",
    repName: "Dean Vehrenkamp",
    repParty: NONPARTISAN,
    repPhotoUrl:
      "https://www.corcoranmn.gov/UserFiles/Servers/Server_15543680/Image/Our%20Community/Council/Councilmember%20Dean%20Vehrenkamp%20(final%20edit)))).png",
    repEmail: "dvehrenkamp@corcoranmn.gov",
    repPhone: "612-309-1885",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://www.corcoranmn.gov/our_government/council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.corcoranmn.gov/our_government/council",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://www.corcoranmn.gov/our_government/council",
  },
  // Brooklyn Center (Hennepin) — council-manager government, charter-
  // established 1966: "mayor, elected to a four-year term, and four
  // councilmembers, elected at large to four-year terms." Ballotpedia
  // independently labels every seat "At-large" across 2022/2024/2026
  // cycles. brooklyncentermn.gov returns HTTP 403 to every automated fetch
  // (confirmed domain-wide: /, /government/city-charter, and a staff
  // directory URL all 403); per AGENTS.md §2.2 this pipeline did not route
  // around it. Sourced instead via the Internet Archive's own prior crawl
  // of the same public pages (Wayback Machine, capture dated 2025-06-01 —
  // the most recent 200-status capture the CDX index has) — a Tier 3
  // republication of the city's own Tier 1 page per this project's
  // sourcing standard, cited alongside the (currently unreachable)
  // original. Every value cross-matched a second, independent retrieval
  // (search-engine-indexed snippets of the live page) with zero
  // discrepancies, and the current roster is independently corroborated as
  // still accurate by 2026 election reporting (two of these five are
  // sitting councilmembers now running for mayor). verifiedAt below
  // reflects the archive capture date actually read, not today's date, per
  // AGENTS.md §3.2 — this record should be re-verified against a live
  // fetch once the site is reachable again. No photo exists in the
  // archived markup for any of the five (only nav/social icons).
  {
    city: "Brooklyn Center",
    coordinates: [-93.309613, 45.0683729], // Brooklyn Center City Hall
    repName: "April Graves",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "mayorgraves@brooklyncentermn.gov",
    repPhone: "763-910-1783",
    termsOfService: [{ termStart: "2023-01-01", termEnd: null, current: true, sourceUrl: "https://www.brooklyncentermn.gov/government/city-council" }],
    committees: ["Mayor of Brooklyn Center"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.brooklyncentermn.gov/government/city-council",
    verifiedAt: "2025-06-01",
    verifiedAgainst: "http://web.archive.org/web/20250601101528/https://www.brooklyncentermn.gov/government/city-council",
  },
  {
    city: "Brooklyn Center",
    coordinates: [-93.309613, 45.0683729],
    role: "Council Member",
    repName: "Dan Jerzak",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "councilmemberjerzak@brooklyncentermn.gov",
    repPhone: "763-336-0817",
    termsOfService: [{ termStart: "2023-01-01", termEnd: null, current: true, sourceUrl: "https://www.brooklyncentermn.gov/government/city-council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.brooklyncentermn.gov/government/city-council",
    verifiedAt: "2025-06-01",
    verifiedAgainst: "http://web.archive.org/web/20250601101528/https://www.brooklyncentermn.gov/government/city-council",
  },
  {
    city: "Brooklyn Center",
    coordinates: [-93.309613, 45.0683729],
    role: "Council Member",
    repName: "Teneshia Kragness",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "councilmemberkragness@brooklyncentermn.gov",
    repPhone: "763-910-1784",
    termsOfService: [{ termStart: "2023-01-01", termEnd: null, current: true, sourceUrl: "https://www.brooklyncentermn.gov/government/city-council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.brooklyncentermn.gov/government/city-council",
    verifiedAt: "2025-06-01",
    verifiedAgainst: "http://web.archive.org/web/20250601101528/https://www.brooklyncentermn.gov/government/city-council",
  },
  {
    city: "Brooklyn Center",
    coordinates: [-93.309613, 45.0683729],
    role: "Council Member",
    repName: "Kris Lawrence-Anderson",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "councilmemberlawrence-anderson@brooklyncentermn.gov",
    repPhone: "763-452-5215",
    // Page states both a current-term-start (1/1/21) and "Held office
    // since 1/1/13" — using the latter (continuous tenure start, not her
    // latest re-election date), same convention Minneapolis's Frey entry
    // above uses (termStart = when the officeholder's continuous run in
    // this office began).
    termsOfService: [{ termStart: "2013-01-01", termEnd: null, current: true, sourceUrl: "https://www.brooklyncentermn.gov/government/city-council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.brooklyncentermn.gov/government/city-council",
    verifiedAt: "2025-06-01",
    verifiedAgainst: "http://web.archive.org/web/20250601101528/https://www.brooklyncentermn.gov/government/city-council",
  },
  {
    city: "Brooklyn Center",
    coordinates: [-93.309613, 45.0683729],
    role: "Council Member",
    repName: "Laurie Ann Moore",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "councilmembermoore@brooklyncentermn.gov",
    repPhone: "763-910-1788",
    termsOfService: [{ termStart: "2025-01-01", termEnd: null, current: true, sourceUrl: "https://www.brooklyncentermn.gov/government/city-council" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://www.brooklyncentermn.gov/government/city-council",
    verifiedAt: "2025-06-01",
    verifiedAgainst: "http://web.archive.org/web/20250601101528/https://www.brooklyncentermn.gov/government/city-council",
  },
  // Loretto (Hennepin) — one of Minnesota's smallest cities (population
  // under 500). lorettomn.gov/robots.txt blanket-disallows every crawler
  // except six named exceptions (Googlebot, bingbot, ia_archiver,
  // archive.org_bot, W3C-checklink, CCBot) via a trailing "User-agent: * /
  // Disallow: /" — same class of conflict as cfb.mn.gov's flagged in
  // commit e9f7f29 and Columbia Heights's above. This data is a one-time
  // hand-transcription (this file's own stated model), not a target for a
  // recurring automated fetcher, per AGENTS.md §2.2. No governing-
  // structure statement ("at large"/"ward") was found on the one page
  // read; MN's statutory-city default (Minn. Stat. § 412.02) is at-large
  // absent a ward ordinance, none found for Loretto — corroborated, not
  // confirmed. No photo, phone (beyond the numbers below, which the page
  // does publish individually), or term-start date is published beyond
  // what's listed.
  {
    city: "Loretto",
    coordinates: [-93.6348163, 45.0550815], // Loretto City Hall
    repName: "Kent Koch",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "kkoch@ci.loretto.mn.us",
    repPhone: "763-286-7138",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://lorettomn.gov/officials" }],
    committees: ["Mayor of Loretto"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://lorettomn.gov/officials",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://lorettomn.gov/officials",
  },
  {
    city: "Loretto",
    coordinates: [-93.6348163, 45.0550815],
    role: "Council Member",
    repName: "Brenda Daniels",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "bdaniels@ci.loretto.mn.us",
    repPhone: "763-479-6341",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://lorettomn.gov/officials" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://lorettomn.gov/officials",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://lorettomn.gov/officials",
  },
  {
    city: "Loretto",
    coordinates: [-93.6348163, 45.0550815],
    role: "Council Member",
    repName: "Jeff Leuer",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "jleuer@ci.loretto.mn.us",
    repPhone: "612-221-4963",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://lorettomn.gov/officials" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://lorettomn.gov/officials",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://lorettomn.gov/officials",
  },
  {
    city: "Loretto",
    coordinates: [-93.6348163, 45.0550815],
    role: "Council Member",
    repName: "Melissa Markham",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "mmarkham@ci.loretto.mn.us",
    repPhone: "612-968-7361",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://lorettomn.gov/officials" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://lorettomn.gov/officials",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://lorettomn.gov/officials",
  },
  {
    city: "Loretto",
    coordinates: [-93.6348163, 45.0550815],
    role: "Council Member",
    repName: "Ben Scanlon",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "bscanlon@ci.loretto.mn.us",
    repPhone: "612-325-0776",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://lorettomn.gov/officials" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://lorettomn.gov/officials",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://lorettomn.gov/officials",
  },
  // Woodland (Hennepin) — one of Minnesota's smallest cities (~386
  // residents, on Lake Minnetonka). Code of Ordinances Ch. 2, §200.01
  // ("The Council will consist of a Mayor and four additional
  // Councilmembers") never mentions wards; corroborated at-large via the
  // same Minn. Stat. § 412.02 default as Loretto/Deephaven above — the
  // literal phrase "at large" does not appear on the city's own site.
  // Coordinates are the city's population centroid, not a dedicated City
  // Hall building — this pipeline found no such building; Woodland
  // contracts its administrator/clerk/finance/police/fire functions out to
  // Deephaven and the Wayzata Fire Department. The roster page also
  // publishes what read as officials' home street addresses; per AGENTS.md
  // §1b those are deliberately never ingested here, even though present on
  // the source page. Vince Suerth's email is transcribed exactly as
  // published, including a stray period before the @ that is almost
  // certainly the city's own publishing typo — not "corrected" without
  // confirming with the city.
  {
    city: "Woodland",
    coordinates: [-93.5105087, 44.9484736],
    repName: "Vince Suerth",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "vsuerth.@cityofwoodlandmn.gov",
    repPhone: "612-600-3346",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://cityofwoodlandmn.gov/city-council-and-staff/" }],
    committees: ["Mayor of Woodland"],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://cityofwoodlandmn.gov/city-council-and-staff/",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://cityofwoodlandmn.gov/city-council-and-staff/",
  },
  {
    city: "Woodland",
    coordinates: [-93.5105087, 44.9484736],
    role: "Council Member",
    repName: "Tom Newberry",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "tnewberry@cityofwoodlandmn.gov",
    repPhone: "651-642-4242",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://cityofwoodlandmn.gov/city-council-and-staff/" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://cityofwoodlandmn.gov/city-council-and-staff/",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://cityofwoodlandmn.gov/city-council-and-staff/",
  },
  {
    city: "Woodland",
    coordinates: [-93.5105087, 44.9484736],
    role: "Council Member",
    repName: "Dave Daniels",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "ddaniels@cityofwoodlandmn.gov",
    repPhone: "952-484-5357",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://cityofwoodlandmn.gov/city-council-and-staff/" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://cityofwoodlandmn.gov/city-council-and-staff/",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://cityofwoodlandmn.gov/city-council-and-staff/",
  },
  {
    city: "Woodland",
    coordinates: [-93.5105087, 44.9484736],
    role: "Council Member",
    repName: "Juan Vazquez",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "jvazquez@cityofwoodlandmn.gov",
    repPhone: "612-295-6392",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://cityofwoodlandmn.gov/city-council-and-staff/" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://cityofwoodlandmn.gov/city-council-and-staff/",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://cityofwoodlandmn.gov/city-council-and-staff/",
  },
  {
    city: "Woodland",
    coordinates: [-93.5105087, 44.9484736],
    role: "Council Member",
    repName: "Hank Zucker",
    repParty: NONPARTISAN,
    repPhotoUrl: null,
    repEmail: "hzucker@cityofwoodlandmn.gov",
    repPhone: "952-300-8833",
    termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: "https://cityofwoodlandmn.gov/city-council-and-staff/" }],
    committees: [],
    neighborhoods: [],
    officeRoom: null,
    profileUrl: "https://cityofwoodlandmn.gov/city-council-and-staff/",
    verifiedAt: "2026-08-09",
    verifiedAgainst: "https://cityofwoodlandmn.gov/city-council-and-staff/",
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
