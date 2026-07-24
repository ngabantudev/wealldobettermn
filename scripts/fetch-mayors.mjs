#!/usr/bin/env node
// scripts/fetch-mayors.mjs
//
// Writes public/mayors.geojson — a two-point FeatureCollection (one per
// city, at its City Hall) that WardMap renders as photo pins. Neither
// city publishes a mayor API, so this is hand-transcribed from each city's
// own mayor page (linked per-entry below) — re-check after a mayoral
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

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(featureCollection));
  console.log(`[done] wrote ${featureCollection.features.length} mayor feature(s) to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
