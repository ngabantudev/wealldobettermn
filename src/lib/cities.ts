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
  // Top-20-by-population batch (2026-08) — the three non-metro cities that
  // round out MN's top 20 (population from MnDOT/MnGeo's CTU FeatureServer,
  // fetch-city-boundaries.mjs's own `population` field, verified 2026-08-08):
  // Rochester (125,055, Olmsted County), Duluth (86,924, St. Louis County),
  // St. Cloud (71,122, split Stearns/Sherburne/Benton). Unlike every city
  // above, all three elect a mix of ward AND at-large seats — the shape
  // fetch-wards.mjs's own Hennepin-suburb comment flagged as "a possible
  // follow-up, not this pilot." No new data-model field was needed for it:
  // resolveOfficialsAtPoint (src/lib/officials.ts) already unions ward-
  // polygon hits with city-name-matched mayors.geojson hits, so an at-large
  // seat living in mayors.geojson resolves correctly alongside a ward seat
  // from wards.geojson for any point inside the city. See WardModal.tsx's
  // roleLabel() fix (same batch) for the one real bug this surfaced: at-
  // large Council Members with no ward/district locator used to badge as
  // "Mayor".
  "Rochester",
  "Duluth",
  "St. Cloud",
  // 2026-08 batch — 13 cities added from links the maintainer supplied
  // directly during this session (not a population-ranked batch like the
  // one above). All 13 are fully at-large (mayor + 4 council members
  // elected citywide, no wards) — see fetch-mayors.mjs's own per-city
  // comments for each one's sourcing, and AT_LARGE_CITIES below. A 14th
  // city researched the same session, Rogers (Hennepin), is deliberately
  // NOT added here: rogersmn.gov/robots.txt explicitly names and
  // disallows both "ClaudeBot" and "anthropic-ai" — not a generic
  // blanket block like Loretto's or Columbia Heights's below, but a
  // directed refusal of this project's own tooling. Per AGENTS.md §2.2
  // ("a source that cannot be fetched politely gets a knownGaps entry and
  // a manual workflow, not a workaround") and §1d ("when in doubt, leave
  // it out"), Rogers ships no officeholder data from this pipeline at
  // all — see sourcesRegistry.ts's KNOWN_ROSTER_GAPS.
  "Golden Valley",
  "New Hope",
  // Columbia Heights and Loretto (further below) both have a robots.txt
  // that blanket-disallows every crawler except a short named allow-list
  // (Columbia Heights: five commercial crawlers; Loretto: six, including
  // archive bots) — unlike Rogers above, neither names Claude or
  // Anthropic specifically. Flagged the same way commit e9f7f29 flagged
  // cfb.mn.gov's contradictory robots.txt: this data is a one-time hand-
  // transcription (this whole file's stated model), not a target for a
  // recurring automated fetcher.
  "Columbia Heights",
  "Dayton",
  "Hopkins",
  "Deephaven",
  "Medina",
  "Hilltop",
  "Wayzata",
  "Corcoran",
  "Brooklyn Center",
  "Loretto",
  "Woodland",
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
  "Golden Valley", "New Hope", "Columbia Heights", "Dayton", "Hopkins", "Deephaven", "Medina", "Hilltop",
  "Wayzata", "Corcoran", "Brooklyn Center", "Loretto", "Woodland",
];

// Dakota added alongside issue #65's batch — Eagan and Lakeville are this
// app's first Dakota County cities. No collision with any existing city
// name here (see the Ramsey city/county collision note below for what that
// class of bug looks like) — checked against every entry in COUNTIES and
// CITIES before adding.
//
// Olmsted/Saint Louis/Stearns/Sherburne/Benton added alongside the
// Rochester/Duluth/St. Cloud batch above — the first non-metro counties
// this app covers. St. Cloud is genuinely split across three of them with
// real population in each (56,691 Stearns / 7,546 Sherburne / 6,885 Benton
// per the same CTU source), not a near-zero sliver like Blaine's Ramsey
// crossing — see countyCities.generated.ts, which lists it under all
// three. "Saint Louis," not "St. Louis" — build-county-cities.mjs's own
// fold() only expands SAINT->ST for *city* names (CITIES uses the
// abbreviated form residents type); county names are matched against the
// CTU dataset's own spelling as-is, and Minnesota's own CTU/MCD source
// spells this one out in full. Duluth's own display label elsewhere
// ("St. Louis County," in WardMap.tsx's COMMISSIONER_LABEL_OVERRIDES) is a
// free-text UI string, unrelated to this exact-match county key.
// Wright added alongside the 2026-08 13-city batch above — Dayton's own
// boundary carries a real (if small, 50-person per the CTU source) Wright
// County sliver alongside its much larger Hennepin portion, the same
// "real-but-empty, confirmed genuine before being kept" standard Blaine's
// Ramsey County crossing already set (that one carries 0 population and
// was still kept). Every other city in the 2026-08 batch is Hennepin or
// Anoka, both already listed below.
export const COUNTIES = [
  "Hennepin", "Ramsey", "Anoka", "Washington", "Dakota",
  "Olmsted", "Saint Louis", "Stearns", "Sherburne", "Benton", "Wright",
] as const;
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
