// Canonical list of cities this app maps. Lives here (not in WardMap.tsx,
// where it originated) because src/lib/addressSearch.ts also needs it —
// a "use client" component file shouldn't be the thing a framework-free
// lib module imports from.
export const CITIES = [
  "Minneapolis",
  "St. Paul",
  "Bloomington",
  "Plymouth",
  "Minnetonka",
  "St. Louis Park",
  "Richfield",
  "Champlin",
  "Crystal",
  "Robbinsdale",
  "Blaine",
  "Brooklyn Park",
  "Coon Rapids",
  "Fridley",
  "Ramsey",
  // Woodbury elects its mayor and all 4 council seats entirely at-large
  // (citywide) — no wards, confirmed against the city's own site. It
  // carries no entry in wards.geojson at all; its officials live in
  // mayors.geojson instead (role "Mayor"/"Council Member", Point geometry
  // at City Hall) — see that script's own comment for why they share a
  // file/source rather than needing a new one.
  "Woodbury",
  // Issue #65's "8 more cities" batch (Woodbury above was the 8th, shipped
  // separately in #66) — Eagan turned out to be fully at-large too once
  // checked against its own site, same as Woodbury: mayor + 4 council
  // members, no wards, no polygon to source. Confirmed on cityofeagan.com
  // (fetch-mayors.mjs carries the per-member citations); no GIS ward-
  // boundary search was needed at all, since Eagan has no wards.
  "Eagan",
  // Same batch — Lakeville is also fully at-large, confirmed on its own
  // site (lakevillemn.gov/428/City-Council: "elected at-large to represent
  // the entire community"). That page also states each member's own
  // "First elected/appointed to Council" date directly, so termStart
  // below isn't a null fallback for this city.
  "Lakeville",
  // Same batch — Maple Grove is also fully at-large (5 seats: mayor + 4
  // council members, confirmed on maplegrovemn.gov/301/Mayor-and-City-
  // Council: "City councilmembers serve at large"), Hennepin County.
  "Maple Grove",
  // Same batch — Apple Valley (Dakota County; not to be confused with
  // Apple Valley, California) is also fully at-large, confirmed against
  // its own site. No individual email/phone is published anywhere on
  // applevalleymn.gov — only a general municipal line and per-member web
  // contact forms — so those fields ship null rather than a shared inbox
  // number or a guessed address.
  "Apple Valley",
  // Same batch — Burnsville (Dakota County), statutory Plan B council-
  // manager, is also fully at-large. burnsvillemn.gov's own staff
  // directory is JS-rendered for the per-member email column and every
  // individual directory.aspx?EID= sub-page returns no usable server-side
  // content through a plain fetch — not routed around per AGENTS.md §2.2 —
  // so repEmail/repPhoto ship null and the one phone number the directory
  // page does render server-side (952-895-4403) is identical across all
  // five members, a shared office line rather than a personal extension,
  // so it's not attributed as repPhone either.
  "Burnsville",
  // Same batch — Edina (Hennepin County) is also fully at-large, confirmed
  // directly on edinamn.gov: "All Council Members in Edina are elected
  // at-large... do not serve a specific ward." Email addresses are
  // Cloudflare email-obfuscation-protected on the city's own page; decoded
  // here via that scheme's own deterministic cipher against the page's own
  // published bytes (see fetch-mayors.mjs's comment on this entry) rather
  // than guessed.
  "Edina",
  // Same batch, lowest confidence of the seven — Eden Prairie (Hennepin
  // County) is also fully at-large (Ballotpedia/GoodParty corroboration,
  // cross-checked against independent search-indexed citations of the
  // city's own page titles), but edenprairiemn.gov itself returns HTTP 403
  // to every path this pipeline tried (overview page, every member's own
  // bio page, a plain top-level fetch) — not routed around per AGENTS.md
  // §2.2. Name and mayor/council role ship at AGENTS.md §3.3's
  // "corroborated" tier; phone, email, and photo could not be confirmed
  // against a direct render of the primary source and ship null rather
  // than a plausible-looking third-party contact this pipeline separately
  // flagged as unsourced (see fetch-mayors.mjs's own comment on this
  // entry). Re-attempt a direct fetch before this app's next refresh.
  "Eden Prairie",
] as const;
export type City = (typeof CITIES)[number];

// Covered cities with no ward polygon at all — every seat (mayor + council)
// is elected citywide. This is the client-visible single source of truth
// for "which cities need their boundary derived from city-boundaries.geojson
// instead of wards.geojson" — WardMap.tsx filters the statewide
// city-boundaries feed against this list to build the at-large-boundary
// layer (previously a separate fetch of its own, per-city GIS URL; see
// git history for scripts/fetch-at-large-boundaries.mjs, now removed).
export const AT_LARGE_CITIES: readonly City[] = [
  "Woodbury", "Eagan", "Lakeville", "Maple Grove", "Apple Valley", "Burnsville", "Edina", "Eden Prairie",
];

// Dakota added alongside issue #65's batch — Eagan and Lakeville are this
// app's first Dakota County cities. No collision with any existing city
// name here (see the Ramsey city/county collision note below for what that
// class of bug looks like) — checked against every entry in COUNTIES and
// CITIES before adding.
export const COUNTIES = ["Hennepin", "Ramsey", "Anoka", "Washington", "Dakota"] as const;
export type County = (typeof COUNTIES)[number];

// NOTE: the city "Ramsey" (Anoka County) and the county "Ramsey" (St.
// Paul's county) are two different, unrelated things that happen to share
// a name — Ramsey County is not this Ramsey's county; see COUNTY_CITIES
// below, which correctly files city-Ramsey under Anoka. A bare search for
// "Ramsey" is genuinely ambiguous between the two; addressSearch.ts's
// "ambiguous-name" ParsedQuery/SearchOutcome kind exists specifically to
// surface that choice instead of silently picking one (AGENTS.md §2.5 —
// same "never silently resolve ambiguity" rule ward lookups already
// follow, applied one level up to place names).

// wards.geojson carries no county field at all (every feature's `county`
// is null — county only ever shows up on the separate commissioners
// layer), so "search by county" has no source data to look up against.
// COUNTY_CITIES used to be a small hand-maintained table here (see git
// history) — it's now generated by scripts/build-county-cities.mjs from
// public/city-boundaries.geojson (MnDOT/MnGeo's CTU FeatureServer), joined
// against CITIES above, so a city that actually straddles a county line
// (Blaine — Anoka and a Ramsey County sliver) is listed under every county
// it touches instead of being filed under just one by hand. Re-export
// only, never edited here — run `npm run data:county-cities` to refresh.
export { COUNTY_CITIES } from "./countyCities.generated.ts";
