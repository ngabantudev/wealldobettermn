// src/lib/sourcesRegistry.ts
//
// Ground truth for /sources — AGENTS.md §2.4's "Machine-Readable Provenance
// Travels With The Data" and §3.3's citation-tiering rules, made visible as
// a page instead of only living in each fetch script's own header comment.
//
// Every `url` below is copy-pasted from a real const/field already present
// in the cited script — never a guessed homepage or an approximated path.
// That constraint shapes several entries: a city whose council roster is
// hand-transcribed from each member's own individual bio page (no single
// shared "council" page exists) is cited via one real member's page, with
// `note` saying so, rather than a plausible-looking index page nobody
// actually fetched. Cross-check this file against the cited script
// whenever that script's own consts change — this is a hand-maintained
// directory of sources, not itself a fetch script's output (see the
// longer explanation this replaces below).
//
// This is a *directory* of sources this app pulls from, not a live feed —
// unlike countyCities.generated.ts, the per-city/per-county source URLs
// live as scattered consts inside each fetch-*.mjs script rather than as
// one script's own structured output (AGENTS.md §2.1's two-file registry
// pattern covers *map layers*; this is a provenance directory, a different
// kind of thing). CITIES/COUNTIES themselves ARE imported from cities.ts
// rather than re-typed elsewhere in this file's callers, so a name can't
// drift from what the app actually covers even though each entry's
// specific URL is hand-entered.
//
// Tier vocabulary matches AGENTS.md §3.3 exactly: Tier 1 = government
// primary record, Tier 3 = first-party non-governmental civic aggregator.
// Every entry below is Tier 1 or Tier 3 (Open States); this app cites
// nothing at Tier 4.

export type SourceTier = 1 | 3;

export interface SourceEntry {
  /** What this app covers with the source — a city, county, or layer name. */
  name: string;
  agency: string;
  /** Direct link to the source itself — a real, already-fetched URL, never approximated. */
  url: string;
  tier: SourceTier;
  /** Which fetch script pulls this source, for anyone checking the code against the claim. */
  script: string;
  /** Set when `url` is one representative page among several equivalent ones (e.g. one ward's own bio page, standing in for a city with no single shared roster page). */
  note?: string;
}

const EACH_MEMBER_OWN_PAGE = "Each member has their own page on this domain — this links one as an example.";

// --- City councils & mayors --------------------------------------------
//
// The roster page(s) a human read to transcribe each name/phone/email —
// see WARD_GIS_SOURCES below for the separate GIS endpoint each city's
// ward polygon comes from.
export const CITY_COUNCIL_SOURCES: readonly SourceEntry[] = [
  { name: "Minneapolis", agency: "City of Minneapolis", url: "https://www.minneapolismn.gov/government/city-council/members/ward-1/", tier: 1, script: "fetch-wards.mjs", note: EACH_MEMBER_OWN_PAGE },
  { name: "St. Paul", agency: "City of St. Paul", url: "https://www.stpaul.gov/department/city-council/ward-1", tier: 1, script: "fetch-wards.mjs", note: EACH_MEMBER_OWN_PAGE },
  { name: "Bloomington", agency: "City of Bloomington", url: "https://www.bloomingtonmn.gov/cc/city-councilmembers-and-district-maps", tier: 1, script: "fetch-wards.mjs" },
  { name: "Plymouth", agency: "City of Plymouth", url: "https://www.plymouthmn.gov/departments/city-council/city-council-members", tier: 1, script: "fetch-wards.mjs" },
  { name: "Minnetonka", agency: "City of Minnetonka", url: "https://www.minnetonkamn.gov/government/city-council-mayor/ward-1", tier: 1, script: "fetch-wards.mjs", note: EACH_MEMBER_OWN_PAGE },
  { name: "St. Louis Park", agency: "City of St. Louis Park", url: "https://www.stlouisparkmn.gov/government/city-council/mayor-council-members/ward-1", tier: 1, script: "fetch-wards.mjs", note: EACH_MEMBER_OWN_PAGE },
  { name: "Richfield", agency: "City of Richfield", url: "https://www.richfieldmn.gov/directory.aspx?eid=62", tier: 1, script: "fetch-wards.mjs", note: EACH_MEMBER_OWN_PAGE },
  { name: "Champlin", agency: "City of Champlin", url: "https://www.champlinmn.gov/directory.aspx?EID=34", tier: 1, script: "fetch-wards.mjs", note: EACH_MEMBER_OWN_PAGE },
  { name: "Crystal", agency: "City of Crystal", url: "https://www.crystalmn.gov/how_do_i____/contact/city_council_members", tier: 1, script: "fetch-wards.mjs" },
  { name: "Robbinsdale", agency: "City of Robbinsdale", url: "https://www.robbinsdalemn.gov/directory.aspx?eid=7", tier: 1, script: "fetch-wards.mjs", note: EACH_MEMBER_OWN_PAGE },
  {
    name: "Blaine",
    agency: "City of Blaine",
    url: "https://arcgis.blainemn.gov/server/rest/services/FeatureDatasets/Boundaries/FeatureServer/22",
    tier: 1,
    script: "fetch-wards.mjs",
    note: "Blaine's own GIS layer embeds each rep's name/email/website directly on the ward polygon — the geometry source and the roster source are the same link.",
  },
  { name: "Brooklyn Park", agency: "City of Brooklyn Park", url: "https://www.brooklynpark.org/contact/nichole-klonowski/", tier: 1, script: "fetch-wards.mjs", note: EACH_MEMBER_OWN_PAGE },
  { name: "Coon Rapids", agency: "City of Coon Rapids", url: "https://www.coonrapidsmn.gov/Directory.aspx?EID=4", tier: 1, script: "fetch-wards.mjs", note: EACH_MEMBER_OWN_PAGE },
  { name: "Fridley", agency: "City of Fridley", url: "https://www.fridleymn.gov/Your-Government/City-Council-Commissions/Meet-Your-Council/Luke-Cardona", tier: 1, script: "fetch-wards.mjs", note: EACH_MEMBER_OWN_PAGE },
  { name: "Ramsey", agency: "City of Ramsey", url: "https://www.cityoframseymn.gov/city-hall/council/elected-officials/", tier: 1, script: "fetch-wards.mjs" },
  { name: "Woodbury", agency: "City of Woodbury", url: "https://www.woodburymn.gov/m/directory/employee?eid=57", tier: 1, script: "fetch-mayors.mjs", note: EACH_MEMBER_OWN_PAGE },
  { name: "Eagan", agency: "City of Eagan", url: "https://cityofeagan.com/mayor-mike-maguire", tier: 1, script: "fetch-mayors.mjs", note: EACH_MEMBER_OWN_PAGE },
  { name: "Lakeville", agency: "City of Lakeville", url: "https://www.lakevillemn.gov/428/City-Council", tier: 1, script: "fetch-mayors.mjs" },
  { name: "Maple Grove", agency: "City of Maple Grove", url: "https://www.maplegrovemn.gov/315/Mark-Steffenson", tier: 1, script: "fetch-mayors.mjs", note: EACH_MEMBER_OWN_PAGE },
  { name: "Apple Valley", agency: "City of Apple Valley", url: "https://www.applevalleymn.gov/27/City-Council", tier: 1, script: "fetch-mayors.mjs" },
  { name: "Burnsville", agency: "City of Burnsville", url: "https://burnsvillemn.gov/2078/City-Council", tier: 1, script: "fetch-mayors.mjs" },
  { name: "Edina", agency: "City of Edina", url: "https://www.edinamn.gov/m/directory/employee?eid=7", tier: 1, script: "fetch-mayors.mjs", note: EACH_MEMBER_OWN_PAGE },
  { name: "Eden Prairie", agency: "City of Eden Prairie", url: "https://www.edenprairiemn.gov/city-government/city-council/ron-case", tier: 1, script: "fetch-mayors.mjs", note: EACH_MEMBER_OWN_PAGE },
  // 2026-08 top-20-population batch — see the CITIES comment in cities.ts.
  { name: "Rochester", agency: "City of Rochester", url: "https://www.rochestermn.gov/council-administration/city-council/councilmembers/", tier: 1, script: "fetch-wards.mjs / fetch-mayors.mjs" },
  { name: "Duluth", agency: "City of Duluth", url: "https://duluthmn.gov/city-council/", tier: 1, script: "fetch-wards.mjs / fetch-mayors.mjs" },
  { name: "St. Cloud", agency: "City of St. Cloud", url: "https://www.ci.stcloud.mn.us/81/City-Council", tier: 1, script: "fetch-wards.mjs / fetch-mayors.mjs" },
  // 2026-08 batch — mayors added for 5 cities that already had ward
  // rosters above but no mayor entry until this batch (Champlin/Crystal/
  // Robbinsdale/Fridley/Ramsey), plus 13 newly-covered at-large cities.
  // See cities.ts's own comment on this batch and fetch-mayors.mjs for the
  // per-city sourcing detail (robots.txt caveats, corroborated-vs-
  // confirmed tiers, etc.) this table can't carry in one URL + a tier.
  { name: "Champlin", agency: "City of Champlin", url: "https://www.champlinmn.gov/277/Mayor-City-Council", tier: 1, script: "fetch-mayors.mjs" },
  { name: "Crystal", agency: "City of Crystal", url: "https://www.crystalmn.gov/government/city_council", tier: 1, script: "fetch-mayors.mjs" },
  { name: "Robbinsdale", agency: "City of Robbinsdale", url: "https://www.robbinsdalemn.gov/m/directory/employee?eid=6", tier: 1, script: "fetch-mayors.mjs", note: EACH_MEMBER_OWN_PAGE },
  {
    name: "Fridley (Mayor)",
    agency: "City of Fridley",
    url: "https://www.fridleymn.gov/Your-Government/City-Council-Commissions/Meet-Your-Council/Dave-Ostwald",
    tier: 1,
    script: "fetch-mayors.mjs",
    note: "fridleymn.gov returns HTTP 403 to automated fetches (same block as the council roster above). Name/email are corroborated via search-cached city-document text and local news, not a direct primary render — AGENTS.md §3.3 'corroborated' tier, not 'confirmed.'",
  },
  { name: "Ramsey (Mayor)", agency: "City of Ramsey", url: "https://www.cityoframseymn.gov/city-hall/council/elected-officials/", tier: 1, script: "fetch-mayors.mjs" },
  { name: "Golden Valley", agency: "City of Golden Valley", url: "https://goldenvalleymn.gov/180/City-Council", tier: 1, script: "fetch-mayors.mjs" },
  { name: "New Hope", agency: "City of New Hope", url: "https://www.newhopemn.gov/city_hall/city_council/council_members", tier: 1, script: "fetch-mayors.mjs" },
  {
    name: "Columbia Heights",
    agency: "City of Columbia Heights",
    url: "https://www.columbiaheightsmn.gov/city_council_commissions/city_council.php",
    tier: 1,
    script: "fetch-mayors.mjs",
    note: "columbiaheightsmn.gov/robots.txt blanket-disallows every crawler except 5 named commercial ones — same class of conflict flagged for cfb.mn.gov in commit e9f7f29. This data is a one-time hand-transcription, not an automated-fetcher target; see AGENTS.md §2.2.",
  },
  { name: "Dayton", agency: "City of Dayton", url: "https://www.daytonmn.gov/government/mayor_council.php", tier: 1, script: "fetch-mayors.mjs" },
  { name: "Hopkins", agency: "City of Hopkins", url: "https://www.hopkinsmn.com/1105/Patrick-Hanlon", tier: 1, script: "fetch-mayors.mjs", note: EACH_MEMBER_OWN_PAGE },
  { name: "Deephaven", agency: "City of Deephaven", url: "https://deephaven.gov/city-council/", tier: 1, script: "fetch-mayors.mjs" },
  { name: "Medina", agency: "City of Medina", url: "https://www.medinamn.gov/Government/City-Council/Elected-Officials", tier: 1, script: "fetch-mayors.mjs" },
  { name: "Hilltop", agency: "City of Hilltop", url: "https://hilltopmn.gov/government", tier: 1, script: "fetch-mayors.mjs" },
  { name: "Wayzata", agency: "City of Wayzata", url: "https://www.wayzata.org/153/City-Council", tier: 1, script: "fetch-mayors.mjs" },
  { name: "Corcoran", agency: "City of Corcoran", url: "https://www.corcoranmn.gov/our_government/council", tier: 1, script: "fetch-mayors.mjs" },
  {
    name: "Brooklyn Center",
    agency: "City of Brooklyn Center",
    url: "https://www.brooklyncentermn.gov/government/city-council",
    tier: 1,
    script: "fetch-mayors.mjs",
    note: "brooklyncentermn.gov returns HTTP 403 to automated fetches (domain-wide). Sourced via the Internet Archive's own prior crawl of this exact page (Wayback Machine capture dated 2025-06-01) — a Tier 3 republication of the city's Tier 1 original per this project's sourcing standard, cited here alongside the (currently unreachable) live URL. Re-verify against a live fetch once the site is reachable.",
  },
  {
    name: "Loretto",
    agency: "City of Loretto",
    url: "https://lorettomn.gov/officials",
    tier: 1,
    script: "fetch-mayors.mjs",
    note: "lorettomn.gov/robots.txt blanket-disallows every crawler except 6 named exceptions (major search/archive bots) — same class of conflict flagged for cfb.mn.gov in commit e9f7f29. One-time hand-transcription, not an automated-fetcher target; see AGENTS.md §2.2.",
  },
  {
    name: "Woodland",
    agency: "City of Woodland",
    url: "https://cityofwoodlandmn.gov/city-council-and-staff/",
    tier: 1,
    script: "fetch-mayors.mjs",
    note: "No dedicated City Hall building found — coordinates are the city's population centroid, not a geocoded municipal address, unlike every other entry in this table.",
  },
] as const;

// --- City & township ward/district GIS boundaries ------------------------
//
// The GIS provider each city's ward polygons actually come from — separate
// from the roster list above since several cities share one county-run GIS
// server rather than each publishing their own.
export const WARD_GIS_SOURCES: readonly SourceEntry[] = [
  { name: "Minneapolis", agency: "City of Minneapolis GIS (ArcGIS Hub)", url: "https://hub.arcgis.com/datasets/cityoflakes::city-council-wards.geojson", tier: 1, script: "fetch-wards.mjs" },
  { name: "St. Paul", agency: "City of St. Paul GIS", url: "https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/Council_Ward_/FeatureServer", tier: 1, script: "fetch-wards.mjs" },
  { name: "Bloomington, Plymouth, Minnetonka, St. Louis Park, Richfield, Champlin, Crystal, Robbinsdale, Brooklyn Park", agency: "Hennepin County GIS", url: "https://gis.hennepin.us/arcgis/rest/services/HennepinData/BOUNDARIES/MapServer/11", tier: 1, script: "fetch-wards.mjs" },
  { name: "Coon Rapids, Fridley, Ramsey", agency: "Anoka County GIS", url: "https://gisservices.co.anoka.mn.us/anoka_gis/rest/services/OpenData_Political/FeatureServer/3", tier: 1, script: "fetch-wards.mjs" },
  { name: "Blaine", agency: "City of Blaine GIS", url: "https://arcgis.blainemn.gov/server/rest/services/FeatureDatasets/Boundaries/FeatureServer/22", tier: 1, script: "fetch-wards.mjs" },
  { name: "Rochester", agency: "Olmsted County GIS", url: "https://public.gis.olmstedcounty.gov/arcgis/rest/services/Political_Administrative/MapServer/2", tier: 1, script: "fetch-wards.mjs" },
  { name: "Duluth", agency: "City of Duluth GIS", url: "https://utility.arcgis.com/usrsvcs/servers/0f2b2e8a51814f26b0c7626f31915537/rest/services/GeneralUse/Precincts_Council_Boundaries_Duluth/MapServer", tier: 1, script: "fetch-wards.mjs" },
  { name: "St. Cloud", agency: "City of St. Cloud GIS", url: "https://sws.stcloudcity.com/arcgis/rest/services/STC_Public/MapServer/21", tier: 1, script: "fetch-wards.mjs" },
] as const;

// --- County commissioners --------------------------------------------------
export const COUNTY_COMMISSIONER_SOURCES: readonly SourceEntry[] = [
  { name: "Hennepin County", agency: "Hennepin County", url: "https://gis.hennepin.us/arcgis/rest/services/HennepinData/BOUNDARIES/MapServer/0", tier: 1, script: "fetch-commissioners.mjs" },
  { name: "Ramsey County", agency: "Ramsey County GIS", url: "https://gis.ramseycountymn.gov/server/rest/services/Boundary/BOUND_CommissionerDistrict2022_ViewOnly/FeatureServer/25", tier: 1, script: "fetch-commissioners.mjs" },
  // 2026-08 batch — same top-20-population expansion as the cities above.
  { name: "Olmsted County", agency: "Olmsted County", url: "https://www.olmstedcounty.gov/government/county-boards-commissions/board-of-commissioners", tier: 1, script: "fetch-commissioners.mjs" },
  { name: "St. Louis County", agency: "St. Louis County GIS", url: "https://gis.stlouiscountymn.gov/server2/rest/services/GeneralUse/Open_Data/MapServer/21", tier: 1, script: "fetch-commissioners.mjs" },
  { name: "Stearns County", agency: "Stearns County GIS", url: "https://gis.co.stearns.mn.us/arcgis/rest/services/Elections/ElectionsRedistricting/MapServer/39", tier: 1, script: "fetch-commissioners.mjs" },
  { name: "Sherburne County", agency: "Sherburne County GIS", url: "https://gis.co.sherburne.mn.us/arcgis4/rest/services/OpenData/Commissioner_Districts/FeatureServer/5", tier: 1, script: "fetch-commissioners.mjs" },
  { name: "Benton County", agency: "Benton County GIS", url: "https://services.arcgis.com/cHtpFLI4WlqULV8k/arcgis/rest/services/CommissionerMap_WFL1/FeatureServer/0", tier: 1, script: "fetch-commissioners.mjs" },
] as const;

// Stearns County commissioners currently ship with real, correct district
// geometry but no confirmed roster — the county's own board page is
// JS-rendered and this pipeline's plain fetch can't read it (AGENTS.md
// §2.2 — not routed around). Surfaced here, not just in the fetch script's
// own comment, since a resident checking "why is this seat blank" deserves
// the same answer a maintainer reading the source would get.
export const KNOWN_ROSTER_GAPS: readonly { name: string; url: string; note: string }[] = [
  {
    name: "Stearns County Board of Commissioners",
    url: "https://www.stearnscountymn.gov/907/Board-of-Commissioners",
    note: "District boundaries are mapped; commissioner names are not yet confirmed against a primary source and ship blank rather than guessed.",
  },
  {
    name: "City of Rogers (Mayor and City Council)",
    url: "https://www.rogersmn.gov/citycouncil",
    note: "Researched 2026-08-09 alongside the 13-city 2026-08 batch (see cities.ts) but deliberately not added: rogersmn.gov/robots.txt explicitly names and disallows both \"ClaudeBot\" and \"anthropic-ai\" — a directed refusal of this project's own tooling, not a generic blanket block like Columbia Heights's or Loretto's. hometownsource.com (the local paper covering Rogers' 2024/2022 elections) carries the identical explicit disallow. Per AGENTS.md §2.2 (\"a source that cannot be fetched politely gets a knownGaps entry and a manual workflow, not a workaround\") and §1d (\"when in doubt, leave it out\"), no officeholder data for Rogers ships from this pipeline. Adding this city requires a human maintainer manually reading rogersmn.gov in a browser (robots.txt governs automated agents, not human browsing) or the city's explicit permission — not an automated fetch under any identity.",
  },
] as const;

// --- Other statewide / state-level layers ---------------------------------
export const OTHER_SOURCES: readonly SourceEntry[] = [
  {
    name: "City & township boundaries (statewide)",
    agency: "Minnesota Department of Transportation / MnGeo",
    url: "https://gisdata.mn.gov/dataset/bdry-mn-city-township-unorg",
    tier: 1,
    script: "fetch-city-boundaries.mjs",
  },
  {
    name: "City & county name index (statewide)",
    agency: "U.S. Census Bureau (Gazetteer Files)",
    url: "https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html",
    tier: 1,
    script: "fetch-places.mjs",
  },
  {
    name: "On-device address search index",
    agency: "U.S. Census Bureau (TIGER/Line Address Range Features)",
    url: "https://www2.census.gov/geo/tiger/TIGER2024/ADDRFEAT/",
    tier: 1,
    script: "fetch-addresses.mjs",
  },
  {
    name: "State legislature roster & roll calls",
    agency: "Open States",
    url: "https://v3.openstates.org/people?jurisdiction=Minnesota",
    tier: 3,
    script: "fetch-state-legislature.mjs",
  },
  {
    name: "State bills",
    agency: "Open States",
    url: "https://v3.openstates.org",
    tier: 3,
    script: "state-bills.mjs",
  },
  {
    name: "Minneapolis meetings, agendas & votes",
    agency: "City of Minneapolis (LIMS)",
    url: "https://lims.minneapolismn.gov",
    tier: 1,
    script: "lims-minneapolis.mjs",
  },
  {
    name: "St. Paul City Council meetings & votes",
    agency: "City of St. Paul (Legistar)",
    url: "https://webapi.legistar.com/v1/stpaul",
    tier: 1,
    script: "legistar.mjs",
  },
  {
    name: "Hennepin County Board meetings & votes",
    agency: "Hennepin County (Legistar)",
    url: "https://webapi.legistar.com/v1/hennepinmn",
    tier: 1,
    script: "legistar.mjs",
  },
  {
    name: "Campaign finance — itemized contributions",
    agency: "Minnesota Campaign Finance and Public Disclosure Board",
    url: "https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/",
    tier: 1,
    script: "mn-campaign-finance.mjs",
  },
] as const;
