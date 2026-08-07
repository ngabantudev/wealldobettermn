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
import { recentVotesFromLegistar } from "./lib/legistarRecentVotes.mjs";

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
  1: { photo: "https://assets.ramseycountymn.gov/files/2025-08/Tara%20Jebens-Singh%20200x250.jpg", officeSince: "2025-01-01", committees: [] },
  2: { photo: "https://assets.ramseycountymn.gov/files/2026-02/Mary-Jo-McGuire-2026-200x250_0.jpg", officeSince: "2012-01-01", committees: ["Chair, Legislative Committee", "Vice Chair, Budget and Audit Committee"] },
  3: { photo: "https://assets.ramseycountymn.gov/files/2025-08/Garrison-McMurtrey-200x250.jpg", officeSince: "2025-02-01", committees: [] },
  4: { photo: "https://assets.ramseycountymn.gov/files/2025-08/Rena-Moran-200x250.jpg", officeSince: "2022-01-01", committees: ["Chair, Economic Growth and Community Investment Committee", "Vice Chair, Budget Committee"] },
  5: { photo: "https://assets.ramseycountymn.gov/files/2025-08/Rafael-Ortega-200x250.jpg", officeSince: "1994-01-01", committees: ["Chair, Ramsey County Board", "Chair, Regional Rail Authority"] },
  6: { photo: "https://assets.ramseycountymn.gov/files/migrated-files/Mai-Chong-Xiong-200x250.jpg", officeSince: "2023-01-01", committees: ["Vice Chair, Ramsey County Board"] },
  7: { photo: "https://assets.ramseycountymn.gov/files/2025-08/Kelly-Miller-200x250.jpg", officeSince: "2025-01-01", committees: [] },
};

// --- Hennepin County (~ Minneapolis) --------------------------------------
//
// Hennepin's layer carries only a district number (NAME_TXT) — everything
// else is hand-transcribed from each commissioner's page at
// hennepincounty.gov/government/leadership/board-of-commissioners/district-N.
// Unlike the city councils this app covers, Hennepin's board has staggered
// terms (districts 2/3/4 elect together, 1/5/6/7 elect together on the
// opposite 4-year cadence) confirmed by cross-checking each member's stated
// term info — so officeSince is genuinely per-member, not one shared date.
// Districts 4 and 6 didn't state an exact first-elected date on their own
// page; those two are the cycle-implied best estimate, not confirmed.
const HENNEPIN_DISTRICTS_URL =
  "https://gis.hennepin.us/arcgis/rest/services/HennepinData/BOUNDARIES/MapServer/0/query?where=1%3D1&outFields=*&f=geojson";
const HENNEPIN_PHOTO_BASE = "https://www.hennepincounty.gov/-/media/Hennepin-Headless/Hennepin-Gov/government/leadership/board/";

const HENNEPIN_COMMISSIONERS = {
  1: {
    name: "Jeffrey Lunde",
    photo: "dist-1/jeffrey-lunde-620x465.jpg",
    officeSince: "2020-01-01",
    committees: ["Chair, Law, Safety and Justice Committee", "Chair, Hennepin Healthcare System Board"],
  },
  2: {
    name: "Irene Fernando",
    photo: "dist-2/irene-fernando-620x465.jpg",
    officeSince: "2019-01-01", // elected Nov 2018
    committees: ["Chair, Hennepin County Board", "Chair, Municipal Building Commission"],
  },
  3: {
    name: "Marion Greene",
    photo: "dist-3/marion-greene-620x465.jpg",
    officeSince: "2014-01-01", // 3rd term began 2022 at 4-year cadence
    committees: ["Chair, Regional Railroad Authority"],
  },
  4: {
    name: "Angela Conley",
    photo: "dist-4/angela-conley-620x465.jpg",
    officeSince: "2019-01-01", // best estimate: same election cycle as districts 2/3
    committees: ["Chair, Health Committee", "Chair, Housing and Redevelopment Authority"],
  },
  5: {
    name: "Debbie Goettel",
    photo: "dist-5/debbie-goettel-620x465.jpg",
    officeSince: "2017-01-01", // elected Nov 2016
    committees: ["Vice Chair, Hennepin County Board", "Chair, Administration, Operations and Budget Committee"],
  },
  6: {
    name: "Heather Edelson",
    photo: "dist-6/heather-edelson-620x465.jpg",
    officeSince: "2025-01-01", // best estimate: opposite cycle from districts 2/3/4, next point after district 1/5's 2020/2024
    committees: ["Chair, Human Services Committee", "Chair, Resident Services Committee"],
  },
  7: {
    name: "Kevin Anderson",
    photo: "dist-7/kevin-anderson-620x465.jpg",
    officeSince: "2021-01-01", // took office 2021, off the regular even-year cycle (likely a special election)
    committees: ["Chair, Hennepin Health", "Chair, Public Works Committee"],
  },
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "mn-civic-map-etl/0.1" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function fetchRamseyDistricts() {
  console.log("[commissioners] fetching Ramsey County...");
  const geojson = await fetchJson(RAMSEY_DISTRICTS_URL);
  const features = (geojson.features ?? []).map((feature) => {
    const props = feature.properties ?? {};
    const districtNum = Number(props.District);
    const extra = RAMSEY_EXTRAS[districtNum] ?? { photo: null, officeSince: "2025-01-01", committees: [] };
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
        officeSince: extra.officeSince,
        committees: extra.committees,
        neighborhoods: [],
        officeRoom: null,
        profileUrl: props.Web ?? null,
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
  const geojson = await fetchJson(HENNEPIN_DISTRICTS_URL);
  const features = (geojson.features ?? []).map((feature) => {
    const props = feature.properties ?? {};
    const districtNum = Number(props.NAME_TXT);
    const info = HENNEPIN_COMMISSIONERS[districtNum];
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
        officeSince: info?.officeSince ?? "2023-01-01",
        committees: info?.committees ?? [],
        neighborhoods: [],
        officeRoom: null,
        profileUrl: `https://www.hennepincounty.gov/government/leadership/board-of-commissioners/district-${districtNum}`,
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

async function main() {
  const [ramsey, hennepin] = await Promise.all([fetchRamseyDistricts(), fetchHennepinDistricts()]);
  const featureCollection = {
    type: "FeatureCollection",
    features: [...hennepin, ...ramsey],
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(featureCollection));
  console.log(`[done] wrote ${featureCollection.features.length} commissioner district feature(s) to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
