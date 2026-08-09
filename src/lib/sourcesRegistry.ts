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
