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
import { union } from "@turf/union";
import { featureCollection } from "@turf/helpers";
import { recentVotesFromLegistar } from "./lib/legistarRecentVotes.mjs";
import { recentVotesFromLims } from "./lib/limsRecentVotes.mjs";
import { simplifyAndRound, SIMPLIFY_TOLERANCE } from "./lib/geoSimplify.mjs";
import { updateDataManifest } from "./lib/dataManifest.mjs";
import { fetchJson } from "./lib/fetchJson.mjs";

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

// Current term runs Jan 2024-Dec 2027 for all 7 seats (citywide cycle) —
// this is the one city in this file where both a termStart and a termEnd
// are confirmed facts, not a guess.
const ST_PAUL_TERM_START = "2024-01-01";
const ST_PAUL_TERM_END = "2027-12-31";
// Ward 6 is the one exception found on the bio pages: Nelsie Yang has
// served continuously since her original swearing-in, not just the term
// that began with everyone else's in 2024. Her *current* term still ends
// with everyone else's per the citywide cycle above — only termStart
// differs for her seat.
const ST_PAUL_TERM_START_OVERRIDES = {
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
// election). Wards 6 and 12 are deliberately absent from this table even
// though a plausible-looking date was once attached to each: both are
// special-election seats where the exact date is explicitly unconfirmed
// (Osman's 2020 special election, Chowdhury's 2023 off-cycle/special) —
// carrying either forward as a real termStart would be a guess, not a
// sourced fact, per issue #96. Wards not listed here either started with
// the current term (elected 2025) or didn't state a date on their page —
// which of those two is genuinely true per-ward isn't confirmed either, so
// termStart is null for them too rather than defaulting to a "term began
// January 2026" stand-in for a real per-member date. No term-end date is
// stated anywhere for any Minneapolis ward.
const MINNEAPOLIS_TERM_START_OVERRIDES = {
  1: "2022-01-01", // Payne, first elected 2021
  3: "2022-01-01", // Rainville, first elected 2021
  9: "2022-01-01", // Chavez, first elected 2021
  10: "2022-01-01", // Chughtai, first elected 2021
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
  1: { name: "Dwayne Lowman", email: "dlowman@BloomingtonMN.gov", phone: "952-270-2377", photo: "https://www.bloomingtonmn.gov/sites/default/files/styles/240x336/public/2026-02/Lowman-Dwayne-2026.jpg?h=59969086&itok=PB1EelDt" },
  2: { name: "Shawn Nelson", email: "snelson@BloomingtonMN.gov", phone: "952-479-0471", photo: "https://www.bloomingtonmn.gov/sites/default/files/styles/240x336/public/2026-02/Nelson-Shawn-2026.jpg?h=59969086&itok=c44_JY5w" },
  3: { name: "Lona Dallessandro", email: "LDallessandro@BloomingtonMN.gov", phone: "612-231-6824", photo: "https://www.bloomingtonmn.gov/sites/default/files/styles/240x336/public/2026-02/Dallessandro-Lona-2026.jpg?h=59969086&itok=YmLq0W4U" },
  4: { name: "Victor Rivas", email: "vrivas@bloomingtonmn.gov", phone: "651-247-5199", photo: "https://www.bloomingtonmn.gov/sites/default/files/styles/240x336/public/2026-02/Rivas-Victor-2026.jpg?h=59969086&itok=tEn3ybvl" },
};

const PLYMOUTH_PROFILE_URL = "https://www.plymouthmn.gov/departments/city-council/city-council-members";
const PLYMOUTH_ROSTER = {
  1: { name: "Kimberly Nelson", email: "knelson@plymouthmn.gov", phone: "763-509-5001", photo: "https://www.plymouthmn.gov/home/showpublishedimage/12998/638775647365700000" },
  2: { name: "Julie Peterson", email: "jpeterson@plymouthmn.gov", phone: "763-509-5002", photo: "https://www.plymouthmn.gov/home/showpublishedimage/12996/638775647645630000" },
  3: { name: "Scott Aldrich", email: "saldrich@plymouthmn.gov", phone: "763-509-5003", photo: "https://www.plymouthmn.gov/home/showpublishedimage/13000/638775647154170000" },
  // The city's own <img alt> text spells this "Julie Pointer," but the page
  // heading and her official email both use "Pointner" — used here as the
  // correct spelling.
  4: { name: "Julie Pointner", email: "jpointner@plymouthmn.gov", phone: "763-509-5004", photo: "https://www.plymouthmn.gov/home/showpublishedimage/11569/638134355229800000" },
};

// Unlike Bloomington/Plymouth, each of these three cities' wards has its
// own individual profile page rather than one shared directory page.
const MINNETONKA_ROSTER = {
  1: { name: "Patsy Foster-Bolton", email: "pbolton@minnetonkamn.gov", phone: "952-314-8638", photo: "https://www.minnetonkamn.gov/home/showpublishedimage/4029/638436736809070000", profileUrl: "https://www.minnetonkamn.gov/government/city-council-mayor/ward-1" },
  // Appointed (not elected) in March 2026 to fill the vacancy left when
  // Rebecca Schack moved from Ward 2 to mayor.
  2: { name: "Amanda Maxwell", email: "amaxwell@minnetonkamn.gov", phone: "612-466-0729", photo: "https://www.minnetonkamn.gov/home/showpublishedimage/5566/639087423947130000", profileUrl: "https://www.minnetonkamn.gov/government/city-council-mayor/ward-2" },
  3: { name: "Paula Ramaley", email: "pramaley@minnetonkamn.gov", phone: "952-222-0105", photo: "https://www.minnetonkamn.gov/home/showpublishedimage/4031/638436738102070000", profileUrl: "https://www.minnetonkamn.gov/government/city-council-mayor/ward-3" },
  4: { name: "Kissy Coakley", email: "kcoakley@minnetonkamn.gov", phone: "952-486-9670", photo: "https://www.minnetonkamn.gov/home/showpublishedimage/1687/638436738813470000", profileUrl: "https://www.minnetonkamn.gov/government/city-council-mayor/ward-4" },
};

const ST_LOUIS_PARK_ROSTER = {
  1: { name: "Daniel Bashore", email: "dbashore@stlouisparkmn.gov", phone: "612-523-5702", photo: "https://www.stlouisparkmn.gov/home/showpublishedimage/6958/639046881787430000", profileUrl: "https://www.stlouisparkmn.gov/government/city-council/mayor-council-members/ward-1" },
  2: { name: "Jim Engelking", email: "jengelking@stlouisparkmn.gov", phone: "612-449-0989", photo: "https://www.stlouisparkmn.gov/home/showpublishedimage/6960/639046881792530000", profileUrl: "https://www.stlouisparkmn.gov/government/city-council/mayor-council-members/ward-2" },
  3: { name: "Sue Budd", email: "sbudd@stlouisparkmn.gov", phone: "612-523-5834", photo: "https://www.stlouisparkmn.gov/home/showpublishedimage/6966/639046881809400000", profileUrl: "https://www.stlouisparkmn.gov/government/city-council/mayor-council-members/ward-3" },
  4: { name: "Tim Brausen", email: "tbrausen@stlouisparkmn.gov", phone: "612-523-5678", photo: "https://www.stlouisparkmn.gov/home/showpublishedimage/6968/639046881814570000", profileUrl: "https://www.stlouisparkmn.gov/government/city-council/mayor-council-members/ward-4" },
};

const RICHFIELD_ROSTER = {
  1: { name: "Walter Burk", email: "WBurk@RichfieldMN.gov", phone: "651-236-0563", photo: "https://www.richfieldmn.gov/ImageRepository/Document?documentID=910", profileUrl: "https://www.richfieldmn.gov/directory.aspx?eid=62" },
  2: { name: "Sean Hayford Oleary", email: "SHayfordoleary@RichfieldMN.gov", phone: "612-605-8837", photo: "https://www.richfieldmn.gov/ImageRepository/Document?documentID=906", profileUrl: "https://www.richfieldmn.gov/directory.aspx?eid=63" },
  3: { name: "Rori A. Coleman-Woods", email: "RColeman-Woods@RichfieldMN.gov", phone: "612-490-2776", photo: "https://www.richfieldmn.gov/ImageRepository/Document?documentID=904", profileUrl: "https://www.richfieldmn.gov/directory.aspx?eid=64" },
};

// Added Aug 2026 alongside Crystal/Robbinsdale/Fridley/Ramsey — this
// county layer already carried boundaries for all three (see fetch-
// commissioners.mjs-style coverage-expansion research) even before this
// app queried them; the shortfall was only ever a missing roster/city
// entry, never a missing GIS source. Champlin's own directory pages state
// "Term Expires" but never a start date, except where noted per-seat below
// — unstated seats get termStart: null (fetchHennepinSuburbWards()'s own
// default when a roster entry has no termStart field), not a guessed date.
const CHAMPLIN_ROSTER = {
  1: { name: "Jessica Tesdall", email: "jtesdall@champlinmn.gov", phone: "763-421-8100 ext. 237", photo: "https://www.champlinmn.gov/ImageRepository/Document?documentID=2082", profileUrl: "https://www.champlinmn.gov/directory.aspx?EID=34" },
  2: { name: "Tom Moe", email: "tmoe@champlinmn.gov", phone: "763-421-8100 ext. 228", photo: "https://www.champlinmn.gov/ImageRepository/Document?documentID=2084", profileUrl: "https://www.champlinmn.gov/directory.aspx?EID=35" },
  // No phone published on her own bio page (unlike the other three
  // members, who each list a personal extension) — not substituting the
  // general council line, same as Coon Rapids's missing-email convention
  // above. Won a May 12, 2026 special election (canvassed May 18) per the
  // city's own Special Election page; no oath date is stated on her bio,
  // so May 18 (the canvass date, a real dated event on a primary source)
  // is used rather than the generic fallback, which would understate how
  // recently she took office.
  3: { name: "Rachel Wales", email: "RWales@champlinmn.gov", phone: null, photo: "https://www.champlinmn.gov/ImageRepository/Document?documentID=5657", profileUrl: "https://www.champlinmn.gov/directory.aspx?EID=36", termStart: "2026-05-18" },
  // Interim appointee — sworn in April 27, 2026 (explicitly stated on her
  // bio page) to serve through the Nov 3, 2026 special election for the
  // remainder of this term.
  4: { name: "Lorraine Coan", email: "lcoan@champlinmn.gov", phone: "763-421-8100 ext. 239", photo: "https://www.champlinmn.gov/ImageRepository/Document?documentID=5543", profileUrl: "https://www.champlinmn.gov/directory.aspx?EID=90", termStart: "2026-04-27" },
};

// One shared council-roster page, no individual bio URLs per member
// (verified: no per-member anchor or sub-page exists) — CRYSTAL_PROFILE_URL
// is used for every ward via fetchHennepinSuburbWards's shared-profileUrl
// fallback. All four emails are direct/individually-addressed, confirmed
// against the city's own page (not a shared inbox).
const CRYSTAL_PROFILE_URL = "https://www.crystalmn.gov/how_do_i____/contact/city_council_members";
// No term-start date stated on the city's page for any of the four —
// termStart is null for all four (fetchHennepinSuburbWards()'s own default
// when a roster entry has no termStart field).
const CRYSTAL_ROSTER = {
  1: { name: "Therese Kiser", email: "therese.kiser@crystalmn.gov", phone: "763-458-0030", photo: "https://www.crystalmn.gov/UserFiles/Servers/Server_10879634/Image/Government/City%20Council/Kiser%20web.jpg" },
  2: { name: "Traci Kamish", email: "traci.kamish@crystalmn.gov", phone: "763-220-0670", photo: "https://www.crystalmn.gov/UserFiles/Servers/Server_10879634/Image/Government/City%20Council/Kamish-web.jpg" },
  3: { name: "John Budziszewski", email: "john.budziszewski@crystalmn.gov", phone: "612-207-3704", photo: "https://www.crystalmn.gov/UserFiles/Servers/Server_10879634/Image/Government/City%20Council/Budziszewski,-John-web.jpg" },
  4: { name: "David Cummings", email: "david.cummings@crystalmn.gov", phone: "952-479-0816", photo: "https://www.crystalmn.gov/UserFiles/Servers/Server_10879634/Image/Government/City%20Council/Cummingsweb.jpg" },
};

// Unlike Bloomington/Plymouth, each ward has its own profile page — same
// shape as Minnetonka above. Emails are published via client-side JS
// concatenation on each bio page rather than plain HTML (reconstructed
// from the page's own script variables, cross-checked against the
// City-Council overview page's independent plaintext listing of the same
// addresses) — a rendering-technique quirk, not a sourcing gap.
const ROBBINSDALE_ROSTER = {
  1: { name: "Raymond Blackledge", email: "rblackledge@robbinsdalemn.gov", phone: "612-501-0201", photo: "https://www.robbinsdalemn.gov/ImageRepository/Document?documentID=1547", termStart: "2025-01-07", profileUrl: "https://www.robbinsdalemn.gov/directory.aspx?eid=7" },
  2: { name: "Jason Greenberg", email: "jgreenberg@robbinsdalemn.gov", phone: "612-567-3905", photo: "https://www.robbinsdalemn.gov/ImageRepository/Document?documentID=1545", termStart: "2024-08-20", profileUrl: "https://www.robbinsdalemn.gov/directory.aspx?eid=8" },
  // Bio page states "has represented Ward 3 since 2023" with no month/day
  // — Jan 1 stands in for the unstated day within that stated year, not a
  // guess at the year itself.
  3: { name: "Mia Parisian", email: "mparisian@robbinsdalemn.gov", phone: "612-501-9499", photo: "https://www.robbinsdalemn.gov/ImageRepository/Document?documentID=1546", termStart: "2023-01-01", profileUrl: "https://www.robbinsdalemn.gov/directory.aspx?eid=9" },
  // Sworn in to fill a vacated seat, per his bio page.
  4: { name: "Alejandro Caceres Aranda", email: "acaceresaranda@robbinsdalemn.gov", phone: "612-701-2250", photo: "https://www.robbinsdalemn.gov/ImageRepository/Document?documentID=1968", termStart: "2026-02-04", profileUrl: "https://www.robbinsdalemn.gov/directory.aspx?eid=10" },
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
// dates are shown there, and no actual expiration date is quoted anywhere
// reachable by this pipeline either) — termStart/termEnd are both null
// for every Blaine seat below, per issue #96, rather than the old
// "2025-01-01" placeholder this file used to fall back to.

// --- Brooklyn Park (Hennepin County) ---------------------------------------
//
// On the same Hennepin ward layer as the five cities above (MUNIC_NAME=
// 'Brooklyn Park'), but its WARD field is null — this city names its three
// districts (Central/East/West) instead of numbering them, and NAME_TXT
// carries that name ("W-Central" etc.) instead. Like Blaine, each district
// seats two members, so this emits two features per polygon; unlike
// Blaine, the roster isn't embedded on the layer, so it's hand-transcribed
// below, same as the numbered-ward cities. `ward` still gets a synthetic,
// stable number (fill-color cycling and click-identity matching both key
// off it) — `wardName` carries the real name the UI actually displays; see
// the field's comment in types.ts.
const BROOKLYN_PARK_DISTRICT_TO_WARD_NUM = { Central: 1, East: 2, West: 3 };
const BROOKLYN_PARK_ROSTER = {
  Central: [
    { name: "Nichole Klonowski", email: "nichole.klonowski@brooklynpark.org", phone: "763-493-8372", photo: "https://www.brooklynpark.org/wp-content/uploads/2023/01/Nichole-Klonowski-e1673535427571.jpg", termStart: "2022-01-01", profileUrl: "https://www.brooklynpark.org/contact/nichole-klonowski/" },
    { name: "Shelle Page", email: "shelle.page@brooklynpark.org", phone: "763-493-8040", photo: "https://www.brooklynpark.org/wp-content/uploads/2025/01/shelle-page-copy.jpg", termStart: "2025-01-06", profileUrl: "https://www.brooklynpark.org/contact/shelle-page/" },
  ],
  East: [
    { name: "Christian Eriksen", email: "christian.eriksen@brooklynpark.org", phone: "763-493-8097", photo: "https://www.brooklynpark.org/wp-content/uploads/2023/01/Christian-Eriksen-e1673535748609.jpg", termStart: "2022-01-01", profileUrl: "https://www.brooklynpark.org/contact/christian-eriksen/" },
    { name: "Amanda Cheng Xiong", email: "amanda.xiong@brooklynpark.org", phone: "763-493-8010", photo: "https://www.brooklynpark.org/wp-content/uploads/2025/01/amanda-cheng-xiong-copy.jpg", termStart: "2025-01-06", profileUrl: "https://www.brooklynpark.org/contact/amanda-cheng-xiong/" },
  ],
  West: [
    { name: "Maria Tran", email: "maria.tran@brooklynpark.org", phone: "763-315-8442", photo: "https://www.brooklynpark.org/wp-content/uploads/2019/06/Maria-Tran-Image-scaled-e1709677467466.jpg", termStart: "2022-01-01", profileUrl: "https://www.brooklynpark.org/contact/maria-tran/" },
    { name: "Tony McGarvey", email: "tony.mcgarvey@brooklynpark.org", phone: "763-315-8496", photo: "https://www.brooklynpark.org/wp-content/uploads/2026/04/Tony-McGarvey.jpg", termStart: "2023-01-01", profileUrl: "https://www.brooklynpark.org/contact/tony-mcgarvey/" },
  ],
};

// --- Rochester (Olmsted County) ---------------------------------------------
//
// Top-20-by-population batch (2026-08) — see the CITIES comment in
// src/lib/cities.ts. Rochester elects 6 ward councilmembers plus a
// Council President elected at-large (lives in fetch-mayors.mjs, city-
// name-matched, no ward polygon of its own — same join Woodbury's at-large
// council already uses). Olmsted County's own GIS publishes wards only as
// a *precinct* layer (WARD attribute, several precincts per ward, same
// shape as Anoka County's suburbs above) — confirmed live 2026-08-08 via
// the ArcGIS Online item "Olmsted County - Wards - City of Rochester"
// (id 93ec06e0d8c14250b77bd1160eabfb35), whose catalog listing is flagged
// "deprecated" but whose underlying service responds live and current, per
// a direct query the same day. Roster hand-transcribed from
// ROCHESTER_PROFILE_URL (fetched 2026-08-08); the page states no term
// start/end date for any member.
const ROCHESTER_WARDS_URL = "https://public.gis.olmstedcounty.gov/arcgis/rest/services/Political_Administrative/MapServer/2/query";
const ROCHESTER_PROFILE_URL = "https://www.rochestermn.gov/council-administration/city-council/councilmembers/";
const ROCHESTER_ROSTER = {
  1: { name: "Patrick Keane", email: "pkeane@rochestermn.gov", phone: "507-259-2870", photo: "https://www.rochestermn.gov/media/ycihkz1l/keane.jpg" },
  2: { name: "Nick Miller", email: "nmiller@rochestermn.gov", phone: "507-850-2131", photo: "https://www.rochestermn.gov/media/3iwn0na3/miller.png" },
  3: { name: "Norman Wahl", email: "nwahl@rochestermn.gov", phone: "507-421-8969", photo: "https://www.rochestermn.gov/media/lpohg5ew/norman-wahl.png" },
  4: { name: "Andy Friederichs", email: "afriederichs@rochestermn.gov", phone: "507-993-6830", photo: "https://www.rochestermn.gov/media/ojifp3j1/friederichs.png" },
  // Shaun Palmer's own published contact is a personal Gmail address, not a
  // rochestermn.gov one — that's what the city's own councilmembers page
  // states directly, not a substitution; citable as official contact info
  // per AGENTS.md §1a regardless of domain.
  5: { name: "Shaun C. Palmer", email: "palmerward5@gmail.com", phone: "507-254-9484", photo: "https://www.rochestermn.gov/media/12bj5wvb/palmer.jpg" },
  6: { name: "Dan Doering", email: "ddoering@rochestermn.gov", phone: "714-309-0314", photo: "https://www.rochestermn.gov/media/eqbn0nfa/doering.png" },
};

async function fetchRochesterWards() {
  console.log("[wards] fetching Rochester...");
  const url = new URL(ROCHESTER_WARDS_URL);
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "WARD");
  url.searchParams.set("f", "geojson");
  const geojson = await fetchJson(url.toString(), { logLabel: "wards" });

  const precinctsByWard = new Map();
  for (const feature of geojson.features ?? []) {
    const wardNum = Number(feature.properties?.WARD);
    if (!precinctsByWard.has(wardNum)) precinctsByWard.set(wardNum, []);
    precinctsByWard.get(wardNum).push(feature);
  }

  const features = [];
  for (const [wardNum, precincts] of precinctsByWard) {
    const dissolved = precincts.length === 1 ? precincts[0] : union(featureCollection(precincts));
    if (!dissolved) {
      console.warn(`[wards] Rochester ward ${wardNum}: union() returned null, skipping`);
      continue;
    }
    const info = ROCHESTER_ROSTER[wardNum];
    features.push({
      type: "Feature",
      geometry: dissolved.geometry,
      properties: {
        role: "Council Member",
        city: "Rochester",
        county: null,
        ward: wardNum,
        wardName: null,
        district: null,
        stateDistrict: null,
        chamber: null,
        repName: info?.name ?? null,
        repParty: NONPARTISAN,
        repPhotoUrl: info?.photo ?? null,
        repEmail: info?.email ?? null,
        repPhone: info?.phone ?? null,
        termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: ROCHESTER_PROFILE_URL }],
        committees: [],
        neighborhoods: [],
        officeRoom: null,
        profileUrl: ROCHESTER_PROFILE_URL,
        candidates: [],
        isContested: false,
        partyUnityPercent: null,
        recentVotes: [],
      },
    });
  }
  console.log(`[wards] Rochester: ${features.length} ward(s)`);
  return features;
}

// --- Duluth (St. Louis County) -----------------------------------------------
//
// Same batch as Rochester above. Duluth elects 5 district councilors plus
// 4 at-large councilors (fetch-mayors.mjs, same city-name join). Unlike
// every ward-based city above, Duluth's own charter calls these "Council
// Districts," not wards — `ward` still carries the real district number
// (fill-color cycling/click-identity key off it same as everywhere else),
// but `wardName` overrides the *display* string to "District N" instead of
// "Ward N" (see roleLabel()'s comment in WardModal.tsx and the field's own
// comment in types.ts). GIS is the city's own open-data layer
// (ArcGIS Online item "Precincts_Council_Boundaries_Duluth", already
// dissolved to one polygon per district, layer 1 "Council_Districts_Duluth"
// — confirmed live 2026-08-08). Roster hand-transcribed from
// DULUTH_PROFILE_URL (fetched 2026-08-08); no term dates are published on
// that page for any member. Photos come from each councilor's own
// individual bio page (duluthmn.gov/city-council/city-councilors/<slug>/,
// fetched 2026-08-08) — the shared roster page above links to each but
// carries no photo itself.
const DULUTH_DISTRICTS_URL =
  "https://utility.arcgis.com/usrsvcs/servers/0f2b2e8a51814f26b0c7626f31915537/rest/services/GeneralUse/Precincts_Council_Boundaries_Duluth/MapServer/1/query";
const DULUTH_PROFILE_URL = "https://duluthmn.gov/city-council/";
const DULUTH_PHOTO_BASE = "https://duluthmn.gov";
const DULUTH_ROSTER = {
  1: { name: "Wendy Durrwachter", email: "wdurrwachter@duluthmn.gov", phone: "218-730-5351", photo: "/media/23afjqmb/i-8wdhrjc-x2.jpg" },
  2: { name: "Diane Desotelle", email: "ddesotelle@duluthmn.gov", phone: "218-730-5355", photo: "/media/unahu1iq/diane-desotelle-district-2-councilor.jpg" },
  3: { name: "Roz Randorf", email: "rrandorf@duluthmn.gov", phone: "218-730-5353", photo: "/media/9117/rozrandorf0018.jpg" },
  4: { name: "David Clanaugh", email: "dclanaugh@duluthmn.gov", phone: "218-730-5356", photo: "/media/ndaddmij/david-clanaugh-district-4-city-councilor.jpg" },
  5: { name: "Janet Kennedy", email: "jkennedy@duluthmn.gov", phone: "218-730-5357", photo: "/media/9116/janet-kennedy-press.jpg" }, // Council Vice President
};

async function fetchDuluthWards() {
  console.log("[wards] fetching Duluth...");
  const url = new URL(DULUTH_DISTRICTS_URL);
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "Cncl_Dist");
  url.searchParams.set("f", "geojson");
  const geojson = await fetchJson(url.toString(), { logLabel: "wards" });

  const features = [];
  for (const feature of geojson.features ?? []) {
    const districtNum = Number(feature.properties?.Cncl_Dist);
    const info = DULUTH_ROSTER[districtNum];
    features.push({
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        role: "Council Member",
        city: "Duluth",
        county: null,
        ward: districtNum,
        wardName: Number.isFinite(districtNum) ? `District ${districtNum}` : null,
        district: null,
        stateDistrict: null,
        chamber: null,
        repName: info?.name ?? null,
        repParty: NONPARTISAN,
        repPhotoUrl: info?.photo ? `${DULUTH_PHOTO_BASE}${info.photo}` : null,
        repEmail: info?.email ?? null,
        repPhone: info?.phone ?? null,
        termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: DULUTH_PROFILE_URL }],
        committees: [],
        neighborhoods: [],
        officeRoom: null,
        profileUrl: DULUTH_PROFILE_URL,
        candidates: [],
        isContested: false,
        partyUnityPercent: null,
        recentVotes: [],
      },
    });
  }
  console.log(`[wards] Duluth: ${features.length} district(s)`);
  return features;
}

// --- St. Cloud (Stearns / Sherburne / Benton Counties) -----------------------
//
// Same batch as Rochester/Duluth above. St. Cloud elects 4 ward
// councilmembers plus 3 at-large councilors (fetch-mayors.mjs, same
// city-name join) — genuinely the most complex of the three: the city's
// own boundary crosses Stearns/Sherburne/Benton county lines with real
// population in all three (see the COUNTIES comment in src/lib/cities.ts),
// unlike Blaine's near-zero county sliver. GIS is the city's own hosted
// server (sws.stcloudcity.com, discovered via the "St. Cloud Link"
// Experience Builder app's embedded config, ArcGIS item
// 8e82426a27794b5aae357b6d7df290aa) — its "Wards" layer (STC_Public
// MapServer id 21) is already dissolved to one polygon per ward and
// already spans all three counties on its own, so no county-by-county
// stitching was needed. `where=DIST_ID>0` drops several zero-population,
// zero-length, duplicate-OBJECTID-0 rows the layer also carries — confirmed
//2026-08-08 as degenerate export artifacts (not real geography: every
// numeric field on them is exactly 0) rather than real small parcels, the
// same way Blaine's real-but-empty Ramsey sliver was confirmed genuine
// before being kept. Roster: ward emails from ST_CLOUD_PROFILE_URL, phones
// AND photos from each member's own directory.aspx sub-page linked off it
// (ci.stcloud.mn.us/Directory.aspx?eid=N — cited directly in
// fetch-mayors.mjs's St. Cloud section for the at-large seats' phones
// too) — both fetched 2026-08-08; neither page states individual term
// start/end dates (only "each serves a four-year term").
const ST_CLOUD_WARDS_URL = "https://sws.stcloudcity.com/arcgis/rest/services/STC_Public/MapServer/21/query";
const ST_CLOUD_PROFILE_URL = "https://www.ci.stcloud.mn.us/81/City-Council";
const ST_CLOUD_PHOTO_BASE = "https://www.ci.stcloud.mn.us";
const ST_CLOUD_ROSTER = {
  1: { name: "Dave Masters", email: "dave.masters@ci.stcloud.mn.us", phone: "320-266-0075", photo: "/ImageRepository/Document?documentID=24197" }, // Council Vice-President
  2: { name: "Karen Larson", email: "Karen.Larson@ci.stcloud.mn.us", phone: "712-330-1098", photo: "/ImageRepository/Document?documentId=24201" },
  3: { name: "Hudda Ibrahim", email: "hudda.ibrahim@ci.stcloud.mn.us", phone: "612-987-7323", photo: "/ImageRepository/Document?documentID=28665" },
  4: { name: "Mike Conway", email: "mike.conway@ci.stcloud.mn.us", phone: "320-493-3659", photo: "/ImageRepository/Document?documentID=28672" }, // Council President
};

async function fetchStCloudWards() {
  console.log("[wards] fetching St. Cloud...");
  const url = new URL(ST_CLOUD_WARDS_URL);
  url.searchParams.set("where", "DIST_ID>0");
  url.searchParams.set("outFields", "DIST_ID");
  url.searchParams.set("f", "geojson");
  const geojson = await fetchJson(url.toString(), { logLabel: "wards" });

  const features = [];
  for (const feature of geojson.features ?? []) {
    const wardNum = Number(feature.properties?.DIST_ID);
    const info = ST_CLOUD_ROSTER[wardNum];
    features.push({
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        role: "Council Member",
        city: "St. Cloud",
        county: null,
        ward: wardNum,
        wardName: null,
        district: null,
        stateDistrict: null,
        chamber: null,
        repName: info?.name ?? null,
        repParty: NONPARTISAN,
        repPhotoUrl: info?.photo ? `${ST_CLOUD_PHOTO_BASE}${info.photo}` : null,
        repEmail: info?.email ?? null,
        repPhone: info?.phone ?? null,
        termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: ST_CLOUD_PROFILE_URL }],
        committees: [],
        neighborhoods: [],
        officeRoom: null,
        profileUrl: ST_CLOUD_PROFILE_URL,
        candidates: [],
        isContested: false,
        partyUnityPercent: null,
        recentVotes: [],
      },
    });
  }
  console.log(`[wards] St. Cloud: ${features.length} ward(s)`);
  return features;
}

async function fetchMinneapolisWards() {
  console.log("[wards] fetching Minneapolis...");
  const geojson = await fetchJson(MINNEAPOLIS_WARDS_URL, { logLabel: "wards" });
  const features = (geojson.features ?? []).map((feature) => {
    const wardNum = Number(feature.properties?.BDNUM);
    const photo = MINNEAPOLIS_PHOTOS[wardNum];
    const profileUrl = `https://www.minneapolismn.gov/government/city-council/members/ward-${wardNum}/`;
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        role: "Council Member",
        city: "Minneapolis",
        county: null,
        ward: wardNum,
        wardName: null,
        district: null,
        stateDistrict: null,
        chamber: null,
        repName: MINNEAPOLIS_ROSTER[wardNum] ?? null,
        repParty: NONPARTISAN,
        repPhotoUrl: photo ? `${MINNEAPOLIS_PHOTO_BASE}${photo}` : null,
        repEmail: null,
        repPhone: null,
        termsOfService: [{
          termStart: MINNEAPOLIS_TERM_START_OVERRIDES[wardNum] ?? null,
          termEnd: null,
          current: true,
          sourceUrl: profileUrl,
        }],
        committees: MINNEAPOLIS_COMMITTEES[wardNum] ?? [],
        neighborhoods: MINNEAPOLIS_NEIGHBORHOODS[wardNum] ?? [],
        officeRoom: MINNEAPOLIS_OFFICE_ROOM,
        profileUrl,
        // No source for candidate filings is wired up yet — empty rather
        // than guessed, since a civic-transparency app is the last place
        // that should show made-up election data. isContested mirrors
        // candidates.length >= 2 and must be kept in sync with it here.
        candidates: [],
        isContested: false,
        partyUnityPercent: null,
        recentVotes: MINNEAPOLIS_ROSTER[wardNum] ? recentVotesFromLims(MINNEAPOLIS_ROSTER[wardNum]) : [],
      },
    };
  });
  console.log(`[wards] Minneapolis: ${features.length} ward(s)`);
  return features;
}

async function fetchStPaulWards() {
  console.log("[wards] fetching St. Paul...");
  const geojson = await fetchJson(ST_PAUL_WARDS_URL, { logLabel: "wards" });
  const features = (geojson.features ?? []).map((feature) => {
    const props = feature.properties ?? {};
    const wardNum = Number(String(props.ward ?? "").replace(/\D/g, ""));
    const profileUrl = `https://www.stpaul.gov/department/city-council/${ST_PAUL_PROFILE_SLUG[wardNum] ?? `ward-${wardNum}`}`;
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        role: "Council Member",
        city: "St. Paul",
        county: null,
        ward: wardNum,
        wardName: null,
        district: null,
        stateDistrict: null,
        chamber: null,
        repName: props.name ?? null,
        repParty: NONPARTISAN,
        repPhotoUrl: props.imgpath ?? null,
        repEmail: props.email ?? null,
        repPhone: props.phone ?? null,
        termsOfService: [{
          termStart: ST_PAUL_TERM_START_OVERRIDES[wardNum] ?? ST_PAUL_TERM_START,
          termEnd: ST_PAUL_TERM_END,
          current: true,
          sourceUrl: profileUrl,
        }],
        committees: ST_PAUL_COMMITTEES[wardNum] ?? [],
        neighborhoods: ST_PAUL_NEIGHBORHOODS[wardNum] ?? [],
        officeRoom: ST_PAUL_OFFICE_ROOM[wardNum] ?? null,
        profileUrl,
        // No source for candidate filings is wired up yet — empty rather
        // than guessed, since a civic-transparency app is the last place
        // that should show made-up election data. isContested mirrors
        // candidates.length >= 2 and must be kept in sync with it here.
        candidates: [],
        isContested: false,
        partyUnityPercent: null,
        // St. Paul is a known Legistar client (webapi.legistar.com/v1/
        // stpaul) — see #57. Surname-matched against public/legistar/
        // stpaul.json's own already-resolved holding→vote records; []
        // (the honest gap note, not an error) for a name that doesn't
        // resolve.
        recentVotes: recentVotesFromLegistar("stpaul", props.name),
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
  const geojson = await fetchJson(url.toString(), { logLabel: "wards" });
  const features = (geojson.features ?? []).map((feature) => {
    const wardNum = Number(feature.properties?.WARD);
    const info = roster[wardNum];
    const resolvedProfileUrl = info?.profileUrl ?? profileUrl ?? null;
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        role: "Council Member",
        city: cityName,
        county: null,
        ward: wardNum,
        wardName: null,
        district: null,
        stateDistrict: null,
        chamber: null,
        repName: info?.name ?? null,
        repParty: NONPARTISAN,
        repPhotoUrl: info?.photo ?? null,
        repEmail: info?.email ?? null,
        repPhone: info?.phone ?? null,
        // termStart/termEnd come straight from the roster entry, per
        // issue #96 — null unless that specific city/seat has a real
        // citation (see the per-city comments above each roster). Never a
        // "2025-01-01"-style sentinel; a seat with no confirmed date gets
        // null, not a guess that renders identically to a real one.
        termsOfService: [{
          termStart: info?.termStart ?? null,
          termEnd: info?.termEnd ?? null,
          current: true,
          sourceUrl: resolvedProfileUrl,
        }],
        committees: [],
        neighborhoods: [],
        officeRoom: null,
        profileUrl: resolvedProfileUrl,
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
  const geojson = await fetchJson(BLAINE_WARDS_URL, { logLabel: "wards" });
  const features = [];
  for (const feature of geojson.features ?? []) {
    const props = feature.properties ?? {};
    const wardNum = Number(props.ward);
    for (const slot of ["1", "2"]) {
      const name = props[`rep${slot}`];
      if (!name) continue;
      const email = props[`rep${slot}email`] ?? null;
      const repProfileUrl = props[`rep${slot}website`] ?? null;
      features.push({
        type: "Feature",
        geometry: feature.geometry,
        properties: {
          role: "Council Member",
          city: "Blaine",
          county: null,
          ward: wardNum,
          wardName: null,
          district: null,
          stateDistrict: null,
          chamber: null,
          repName: name,
          repParty: NONPARTISAN,
          repPhotoUrl: (email && BLAINE_PHOTOS[email]) ?? null,
          repEmail: email,
          repPhone: props[`rep${slot}phone`] ?? null,
          termsOfService: [{ termStart: null, termEnd: null, current: true, sourceUrl: repProfileUrl }],
          committees: [],
          neighborhoods: [],
          officeRoom: null,
          profileUrl: repProfileUrl,
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

async function fetchBrooklynParkWards() {
  console.log("[wards] fetching Brooklyn Park...");
  const url = new URL(HENNEPIN_WARDS_URL);
  url.searchParams.set("where", "MUNIC_NAME='Brooklyn Park'");
  url.searchParams.set("outFields", "NAME_TXT,MUNIC_NAME");
  url.searchParams.set("f", "geojson");
  const geojson = await fetchJson(url.toString(), { logLabel: "wards" });
  const features = [];
  for (const feature of geojson.features ?? []) {
    const districtName = String(feature.properties?.NAME_TXT ?? "").replace(/^W-/, "");
    const wardNum = BROOKLYN_PARK_DISTRICT_TO_WARD_NUM[districtName] ?? null;
    const reps = BROOKLYN_PARK_ROSTER[districtName] ?? [];
    for (const info of reps) {
      features.push({
        type: "Feature",
        geometry: feature.geometry,
        properties: {
          role: "Council Member",
          city: "Brooklyn Park",
          county: null,
          ward: wardNum,
          // Full override label, not just the bare name — see WardModal.tsx's
          // roleLabel() comment (2026-08 Duluth batch): wardName used to be
          // just "Central" with the modal appending " District" itself, but
          // that word-order assumption doesn't fit every city (Duluth calls
          // its numbered areas "District 1", not "1 District"). wardName now
          // carries the complete label as-is everywhere it's read.
          wardName: districtName ? `${districtName} District` : null,
          district: null,
          stateDistrict: null,
          chamber: null,
          repName: info.name,
          repParty: NONPARTISAN,
          repPhotoUrl: info.photo ?? null,
          repEmail: info.email ?? null,
          repPhone: info.phone ?? null,
          termsOfService: [{ termStart: info.termStart ?? null, termEnd: null, current: true, sourceUrl: info.profileUrl ?? null }],
          committees: [],
          neighborhoods: [],
          officeRoom: null,
          profileUrl: info.profileUrl ?? null,
          candidates: [],
          isContested: false,
          partyUnityPercent: null,
          recentVotes: [],
        },
      });
    }
  }
  console.log(`[wards] Brooklyn Park: ${features.length} district seat(s)`);
  return features;
}

// --- Anoka County suburbs (Coon Rapids, Fridley, Ramsey) --------------------
//
// None of these cities has a dedicated ward-boundary GIS layer of its own
// (Coon Rapids's own GIS server's redistricting endpoints are token-walled
// and its public "Ward Map" is a static PDF; Fridley and Ramsey don't
// publish one either, per a check of each city's own open-data listings).
// What Anoka County does publish is a countywide *precinct* layer with a
// WARD attribute — several precincts per ward, not one polygon per ward —
// so each ward here is assembled by dissolving (geometrically unioning) its
// precincts into a single polygon, rather than queried as one feature like
// the Hennepin suburbs' shared layer above. Originally written for just
// Coon Rapids; generalized by city name the same way
// fetchHennepinSuburbWards() already is, once Fridley and Ramsey turned out
// to share the exact same county source (see coverage-expansion research,
// Aug 2026).
const ANOKA_PRECINCTS_URL = "https://gisservices.co.anoka.mn.us/anoka_gis/rest/services/OpenData_Political/FeatureServer/3/query";

const COON_RAPIDS_ROSTER = {
  1: { name: "Brad Greskowiak", phone: "763-757-6944", photo: "https://www.coonrapidsmn.gov/ImageRepository/Document?documentID=13431", profileUrl: "https://www.coonrapidsmn.gov/Directory.aspx?EID=4" },
  2: { name: "Peter Butler", phone: "612-481-1061", photo: "https://www.coonrapidsmn.gov/ImageRepository/Document?documentID=18433", profileUrl: "https://www.coonrapidsmn.gov/Directory.aspx?EID=295" },
  3: { name: "Sean Novack", phone: "612-391-1284", photo: "https://www.coonrapidsmn.gov/ImageRepository/Document?documentID=14794", profileUrl: "https://www.coonrapidsmn.gov/Directory.aspx?EID=283" },
  4: { name: "Christopher Geisler", phone: "763-458-1928", photo: "https://www.coonrapidsmn.gov/ImageRepository/Document?documentID=18432", profileUrl: "https://www.coonrapidsmn.gov/Directory.aspx?EID=296" },
  5: { name: "Brian Armstrong", phone: "612-868-1455", photo: "https://www.coonrapidsmn.gov/ImageRepository/Document?documentID=14795", profileUrl: "https://www.coonrapidsmn.gov/Directory.aspx?EID=282" },
};
// No email is published for any of these 5 — the city's directory pages
// carry only a shared general inbox, which isn't any one member's contact,
// so repEmail stays null rather than substituting it. "Since" isn't stated
// anywhere either (checked both the directory and each member's own
// profile page), same gap as Blaine's — termStart/termEnd are both null
// for all 5 (fetchAnokaSuburbWards's own default), not a guessed date.

// fridleymn.gov returns HTTP 403 to every automated fetch (Cloudflare/Akamai
// bot protection) — confirmed both via WebFetch and curl with a browser
// User-Agent, not routed around per AGENTS.md §2.2 ("no block evasion").
// Phone/email below come from search-engine-indexed citations of the city's
// own resident welcome packet PDF and Meet-Your-Council pages (corroborated
// across multiple independent snippets, internally consistent), not a
// direct render of the live page — same "corroborated, not primary-read"
// tier as the Hennepin suburbs' termStart dates above. Photos are
// genuinely unconfirmed (left null, not guessed) since there's no way to
// extract an <img> src without rendering the blocked page. Re-verify
// against fridleymn.gov directly (a real browser, not this pipeline) before
// this data ages past AGENTS.md §3.2's staleness window.
const FRIDLEY_PROFILE_URLS = {
  1: "https://www.fridleymn.gov/Your-Government/City-Council-Commissions/Meet-Your-Council/Luke-Cardona",
  2: "https://www.fridleymn.gov/Your-Government/City-Council-Commissions/Meet-Your-Council/Ryan-Evanson",
  3: "https://www.fridleymn.gov/Your-Government/City-Council-Commissions/Meet-Your-Council/Ann-Bolkcom",
};
const FRIDLEY_ROSTER = {
  // Appointed to fill Tom Tillberry's vacancy, sworn in March 4, 2025, per
  // Anoka County ABC Newspapers/hometownsource.com — third-party sourced
  // (the city's own site doesn't state a term-start date for him), flagged
  // the same as every other "reported, not confirmed" date in this file.
  1: { name: "Luke Cardona", phone: "763-334-2810", email: "Luke.Cardona@FridleyMN.gov", termStart: "2025-03-04" },
  2: { name: "Ryan Evanson", phone: "612-325-1329", email: "Ryan.Evanson@FridleyMN.gov" },
  3: { name: "Ann Bolkcom", phone: "612-308-2096", email: "Ann.Bolkcom@FridleyMN.gov" },
};

// cityoframseymn.gov's "Elected Officials" page lists all 7 members (Mayor +
// 2 at-large + 4 ward) on one shared page with no individual profile URLs —
// same shared-page shape as Crystal below. Per-member phone/email ARE
// direct (not a shared inbox), confirmed in the page's raw HTML. No
// term-start date is published anywhere (only "Term Expires"); back-
// calculating one from a 4-year-term assumption would be a guess, not a
// sourced fact, so every seat uses the same documented fallback instead.
const RAMSEY_PROFILE_URL = "https://www.cityoframseymn.gov/city-hall/council/elected-officials/";
const RAMSEY_ROSTER = {
  1: { name: "Michael Olson", phone: "763-576-4363", email: "molson@cityoframsey.com", photo: "https://www.cityoframseymn.gov/media/lgummcou/document.jpg" },
  2: { name: "Eric Peters", phone: "763-576-4366", email: "epeters@cityoframsey.com", photo: "https://www.cityoframseymn.gov/media/555abt5i/document.jpg" },
  3: { name: "Dan Specht", phone: "763-576-4361", email: "dspecht@cityoframsey.com", photo: "https://www.cityoframseymn.gov/media/nsad02sm/document.jpg" },
  4: { name: "Shanna Stewart", phone: "763-576-4360", email: "sstewart@cityoframsey.com", photo: "https://www.cityoframseymn.gov/media/twijfk1e/document.jpg" },
};

async function fetchAnokaSuburbWards(cityName, roster, profileUrls) {
  console.log(`[wards] fetching ${cityName}...`);
  const url = new URL(ANOKA_PRECINCTS_URL);
  url.searchParams.set("where", `CITY='${cityName}'`);
  url.searchParams.set("outFields", "WARD,CITY");
  url.searchParams.set("f", "geojson");
  const geojson = await fetchJson(url.toString(), { logLabel: "wards" });

  const precinctsByWard = new Map();
  for (const feature of geojson.features ?? []) {
    const wardNum = Number(feature.properties?.WARD);
    if (!precinctsByWard.has(wardNum)) precinctsByWard.set(wardNum, []);
    precinctsByWard.get(wardNum).push(feature);
  }

  const features = [];
  for (const [wardNum, precincts] of precinctsByWard) {
    const dissolved = precincts.length === 1 ? precincts[0] : union(featureCollection(precincts));
    if (!dissolved) {
      console.warn(`[wards] ${cityName} ward ${wardNum}: union() returned null, skipping`);
      continue;
    }
    const info = roster[wardNum];
    // Three shapes in use: embedded per-ward on the roster entry itself
    // (Coon Rapids), a separate per-ward map (Fridley), or one shared
    // page for the whole council (Ramsey) — checked in that order.
    const resolvedProfileUrl = info?.profileUrl ?? profileUrls?.[wardNum] ?? profileUrls ?? null;
    features.push({
      type: "Feature",
      geometry: dissolved.geometry,
      properties: {
        role: "Council Member",
        city: cityName,
        county: null,
        ward: wardNum,
        wardName: null,
        district: null,
        stateDistrict: null,
        chamber: null,
        repName: info?.name ?? null,
        repParty: NONPARTISAN,
        repPhotoUrl: info?.photo ?? null,
        repEmail: info?.email ?? null,
        repPhone: info?.phone ?? null,
        termsOfService: [{
          termStart: info?.termStart ?? null,
          termEnd: null,
          current: true,
          sourceUrl: resolvedProfileUrl,
        }],
        committees: [],
        neighborhoods: [],
        officeRoom: null,
        profileUrl: resolvedProfileUrl,
        candidates: [],
        isContested: false,
        partyUnityPercent: null,
        recentVotes: [],
      },
    });
  }
  console.log(`[wards] ${cityName}: ${features.length} ward(s)`);
  return features;
}

async function main() {
  const [
    mpls, stPaul, bloomington, plymouth, minnetonka, stLouisPark, richfield, champlin, crystal, robbinsdale,
    blaine, brooklynPark, coonRapids, fridley, ramsey, rochester, duluth, stCloud,
  ] = await Promise.all([
    fetchMinneapolisWards(),
    fetchStPaulWards(),
    fetchHennepinSuburbWards("Bloomington", BLOOMINGTON_ROSTER, BLOOMINGTON_PROFILE_URL),
    fetchHennepinSuburbWards("Plymouth", PLYMOUTH_ROSTER, PLYMOUTH_PROFILE_URL),
    fetchHennepinSuburbWards("Minnetonka", MINNETONKA_ROSTER),
    fetchHennepinSuburbWards("St. Louis Park", ST_LOUIS_PARK_ROSTER),
    fetchHennepinSuburbWards("Richfield", RICHFIELD_ROSTER),
    fetchHennepinSuburbWards("Champlin", CHAMPLIN_ROSTER),
    fetchHennepinSuburbWards("Crystal", CRYSTAL_ROSTER, CRYSTAL_PROFILE_URL),
    fetchHennepinSuburbWards("Robbinsdale", ROBBINSDALE_ROSTER),
    fetchBlaineWards(),
    fetchBrooklynParkWards(),
    fetchAnokaSuburbWards("Coon Rapids", COON_RAPIDS_ROSTER),
    fetchAnokaSuburbWards("Fridley", FRIDLEY_ROSTER, FRIDLEY_PROFILE_URLS),
    fetchAnokaSuburbWards("Ramsey", RAMSEY_ROSTER, RAMSEY_PROFILE_URL),
    fetchRochesterWards(),
    fetchDuluthWards(),
    fetchStCloudWards(),
  ]);
  // Named outputCollection, not featureCollection — shadowing the
  // @turf/helpers import of the same name would still work correctly here
  // (this is a different function's scope), but reads as if it might be
  // calling the imported function when it's really just a local object.
  const outputCollection = {
    type: "FeatureCollection",
    features: [
      ...mpls, ...stPaul, ...bloomington, ...plymouth, ...minnetonka, ...stLouisPark, ...richfield, ...champlin,
      ...crystal, ...robbinsdale, ...blaine, ...brooklynPark, ...coonRapids, ...fridley, ...ramsey,
      ...rochester, ...duluth, ...stCloud,
    ],
  };

  // Ingest-time geometry simplification — see scripts/lib/geoSimplify.mjs
  // and issue #67 Finding 1. Runs after union() above, not before: a
  // precinct-dissolve needs its full input precision to merge cleanly at
  // shared edges, and simplifying each precinct separately first would
  // just leave harder-to-dissolve seams.
  const simplified = simplifyAndRound(outputCollection, { tolerance: SIMPLIFY_TOLERANCE.wards, label: "wards" });
  const output = JSON.stringify(simplified);

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, output);
  await updateDataManifest(path.basename(OUTPUT_PATH), output);
  console.log(`[done] wrote ${simplified.features.length} ward feature(s) to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
