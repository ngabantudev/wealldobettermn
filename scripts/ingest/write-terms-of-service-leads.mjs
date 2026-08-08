#!/usr/bin/env node
// scripts/ingest/write-terms-of-service-leads.mjs
//
// Maintainer research tool for issue #98 (itself a scope-downgrade of
// #96's original ask): a manual county-canvass/charter workflow replaced
// the automated MN SoS ingest that #98 originally proposed, because MN
// SoS's results portal is bot-protected (three separate confirmed
// challenges — see #98's revised body) and AGENTS.md §2.2 forbids
// routing around that. This script does NOT replace that manual
// workflow. It narrows the maintainer's search: for every official whose
// termsOfService[0].termStart or .termEnd currently ships `null`, it
// checks Wikipedia's own public REST API for a candidate first-elected/
// term-start *year* and surfaces it as a prioritized lead, alongside
// whether MN Stat. § 412.02 Subd. 2's "first Monday in January following
// the election" shortcut can turn a confirmed election date into a
// confirmed seating date for that specific city.
//
// This is Tier 4 per AGENTS.md §3.3 ("lead lists only, never the sole
// basis of a published feature") — a checklist for a human to go verify
// against a real Tier 1/2 source (county canvass, MN Stat § 412.02 Subd.
// 2, or the city's own charter), not data to ship. Nothing this script
// produces is read by src/ or written under public/ — see the two
// read-only imports below and OUTPUT_JSON/OUTPUT_MD's paths. Do not wire
// this into npm run data:all: it's an on-demand maintainer tool, not
// part of the standard ingest pipeline, and it makes an external network
// call this repo's build must never depend on (AGENTS.md §0.8).
//
// Wikipedia's public API requires no key (AGENTS.md §2.2 "good-citizen
// fetcher" standard applied here same as everywhere else in this repo):
// a descriptive User-Agent naming this project + a contact method, and
// requests paced ~400ms apart rather than fired concurrently.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read-only inputs — this script never writes back to either file, and
// never writes anything under public/ at all. See the module comment.
const MAYORS_PATH = path.join(__dirname, "../../public/mayors.geojson");
const WARDS_PATH = path.join(__dirname, "../../public/wards.geojson");

// Deliberately outside public/ — a maintainer-only research artifact,
// not part of the site's published data contract. Nothing under src/
// reads from scripts/research/.
const OUTPUT_DIR = path.join(__dirname, "../research");
const OUTPUT_JSON = path.join(OUTPUT_DIR, "terms-of-service-leads.json");
const OUTPUT_MD = path.join(OUTPUT_DIR, "terms-of-service-leads.md");

const USER_AGENT =
  "wealldobettermn-research-tool/1.0 (+https://github.com/ngabantudev/wealldobettermn; maintainer research lead-gen, low volume, contact via repo issues)";

// Spacing between every outbound Wikipedia request (not just per-lead —
// each lead makes up to two calls, search + summary, both paced) per
// AGENTS.md §2.2's "reasonable rate limiting" standard.
const REQUEST_DELAY_MS = 400;

const STATUTE_URL = "https://www.revisor.mn.gov/statutes/cite/412.02";

const NOTE =
  "Tier 4 (AGENTS.md §3.3) leads only — never published as fact. Each entry needs " +
  "human verification against a Tier 1/2 source (county canvass, MN Stat 412.02 " +
  "Subd. 2 for statutory cities, or the city's own charter for charter cities) " +
  "before any date here is entered into scripts/fetch-mayors.mjs or scripts/fetch-wards.mjs.";

// Whether each city's own seating-date rule was established in the
// existing per-city header comments already in fetch-mayors.mjs /
// fetch-wards.mjs — read directly, not inferred from general knowledge
// about Minnesota municipal law. "unknown" is the honest default: most
// of this repo's per-city comments document sourcing gaps for contact
// info and term dates, not the city's statutory/charter classification
// itself, so absence of a comment is a real gap, not an oversight to
// paper over here.
//
//   - Burnsville: fetch-mayors.mjs's own comment states directly
//     "Statutory Plan B council-manager city."
//   - Minneapolis and St. Paul: fetch-wards.mjs's top-of-file comment
//     states "Minnesota municipal elections are nonpartisan by charter"
//     specifically about these two cities (the only two covered by that
//     comment block) — both are chartered (home rule) cities.
//   - Every other city in this registry: no per-city comment states
//     this either way. Flagged "unknown" rather than guessed.
const CITY_SEATING_RULES = {
  Minneapolis: "charter",
  "St. Paul": "charter",
  Burnsville: "statutory",
};

// County, where an existing per-city header comment in fetch-mayors.mjs
// or fetch-wards.mjs states it directly (e.g. "--- Eagan (Dakota
// County) ---"). Both public geojson files carry `county: null` for
// every feature (confirmed against the live data before writing this
// map), so this is the only source available without guessing. Cities
// not listed here had no such comment found — county stays null rather
// than filled from outside general knowledge.
const CITY_COUNTY = {
  Blaine: "Anoka County",
  "Brooklyn Park": "Hennepin County",
  "Coon Rapids": "Anoka County",
  Fridley: "Anoka County",
  Ramsey: "Anoka County",
  Woodbury: "Washington County",
  Eagan: "Dakota County",
  Lakeville: "Dakota County",
  "Apple Valley": "Dakota County",
  Burnsville: "Dakota County",
  "Maple Grove": "Hennepin County",
  Edina: "Hennepin County",
  "Eden Prairie": "Hennepin County",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read a GeoJSON FeatureCollection. No fallback/mock on failure — if
 * either input is missing, this is a real problem the maintainer needs
 * to see, not something to paper over with an empty result.
 *
 * @param {string} filePath
 * @returns {Promise<{ type: string, features: Array<Record<string, unknown>> }>}
 */
async function readGeojson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

/**
 * @param {Record<string, unknown>} properties
 * @returns {string[]}
 */
function missingTermFields(properties) {
  const terms = /** @type {Array<{termStart: string | null, termEnd: string | null}>} */ (
    properties.termsOfService
  );
  const first = Array.isArray(terms) ? terms[0] : null;
  if (!first) return [];
  const missing = [];
  if (first.termStart === null) missing.push("termStart");
  if (first.termEnd === null) missing.push("termEnd");
  return missing;
}

/**
 * Build the Wikipedia search query per the design's step 4: repName +
 * city + "Minnesota", plus a role hint when known.
 *
 * @param {string} repName
 * @param {string} city
 * @param {string | undefined} role
 * @returns {string}
 */
function buildSearchQuery(repName, city, role) {
  const base = `${repName} ${city} Minnesota`;
  if (role === "Mayor") return `${base} mayor`;
  if (role === "Council Member") return `${base} city council`;
  return base;
}

/**
 * Candidate first-elected/term-start *year* extraction — a year only,
 * never a full date. Wikipedia summaries essentially never state an
 * exact day, and this project's own convention (see fetch-mayors.mjs's
 * Eagan/Robbinsdale comments) is to never invent a day-of-month, so this
 * function doesn't either: it stops at the year.
 *
 * @param {string} extract
 * @returns {number | null}
 */
function extractCandidateYear(extract) {
  const patterns = [
    /\bsince\s+(\d{4})\b/i,
    /\belected\b[^.]{0,60}?\b(\d{4})\b/i,
    /\btook office\b[^.]{0,40}?\b(\d{4})\b/i,
    /\bsworn in\b[^.]{0,40}?\b(\d{4})\b/i,
    /\bappointed\b[^.]{0,40}?\b(\d{4})\b/i,
    /\bincumbent since\s+(\d{4})\b/i,
  ];
  const currentYear = new Date().getUTCFullYear();
  for (const pattern of patterns) {
    const match = extract.match(pattern);
    if (!match) continue;
    const year = Number(match[1]);
    if (year >= 1950 && year <= currentYear) return year;
  }
  return null;
}

/**
 * Search Wikipedia and pick the best of the top few hits — not blindly
 * the #1 result. A query like "Elizabeth Kautz Burnsville Minnesota
 * mayor" frequently ranks the *city's* own article (which repeats
 * "Burnsville" and "Minnesota" heavily) above the actual person's
 * biography, confirmed live against this exact case during verification
 * (search returned "Burnsville, Minnesota" as hit #1, "Elizabeth Kautz"
 * as hit #2). Requesting a few more results and skipping any title that
 * is exactly `"<city>, Minnesota"` (the geographic-article naming
 * convention) fixes that specific, common collision cheaply, without
 * attempting any fuzzier relevance judgment this tool has no business
 * making — it's still "the top result," just after excluding the one
 * title pattern already known to be the wrong entity.
 *
 * @param {string} query
 * @param {string} city
 * @returns {Promise<string | null>} the best-guess page title, or null
 */
async function searchWikipediaTitle(query, city) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srlimit", "3");
  url.searchParams.set("format", "json");

  await sleep(REQUEST_DELAY_MS);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) {
    console.warn(`[terms-of-service-leads] search failed (${res.status}) for query: ${query}`);
    return null;
  }
  const body = await res.json();
  const hits = body?.query?.search;
  if (!Array.isArray(hits) || hits.length === 0) return null;

  const cityArticleTitle = `${city}, Minnesota`;
  const best = hits.find((hit) => hit.title !== cityArticleTitle) ?? hits[0];
  return best.title ?? null;
}

/**
 * Minnesota municipal names collide with unrelated Wikipedia content far
 * more than expected — confirmed live during verification of this exact
 * script: "Sue Budd" (a real St. Louis Park council member) top-matched
 * "List of suicides (2000–present)"; other repName+city queries in this
 * registry matched "List of council camps (Boy Scouts of America),"
 * "Deaths in November 2023," and similar wholly unrelated list/aggregate
 * articles. None of those pages mention Minnesota or the relevant city
 * anywhere in their summary extract. Requiring the extract to actually
 * name the state or the specific city catches essentially all of these
 * without needing any fuzzier judgment call this tool has no business
 * making.
 *
 * @param {string} extract
 * @param {string} city
 * @returns {boolean}
 */
function extractMentionsCity(extract, city) {
  const lower = extract.toLowerCase();
  if (lower.includes("minnesota")) return true;
  const variants = [city];
  if (city.startsWith("St. ")) variants.push(`Saint ${city.slice(4)}`);
  return variants.some((variant) => lower.includes(variant.toLowerCase()));
}

/**
 * @param {string} title
 * @param {string} city
 * @returns {Promise<{ url: string, extract: string } | null>}
 */
async function fetchWikipediaSummary(title, city) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;

  await sleep(REQUEST_DELAY_MS);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) {
    console.warn(`[terms-of-service-leads] summary fetch failed (${res.status}) for title: ${title}`);
    return null;
  }
  const body = await res.json();

  // A disambiguation hit means the search matched the wrong page (a
  // common name collision) rather than the actual official — treat as
  // no match, per the design's "leave candidate fields null rather than
  // guessing from a weaker match" rule, instead of extracting a year
  // from unrelated disambiguation-page text.
  if (body?.type === "disambiguation") return null;
  if (typeof body?.extract !== "string" || body.extract.length === 0) return null;

  // See extractMentionsCity's comment — a summary that never names
  // Minnesota or the city is almost certainly the wrong page (a name
  // collision with an unrelated person/list/article), not a weak-but-
  // real match. Discard it entirely rather than surface a plausible-
  // looking link and extract that has nothing to do with this official.
  if (!extractMentionsCity(body.extract, city)) return null;

  const pageUrl = body?.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
  return { url: pageUrl, extract: body.extract };
}

/**
 * @param {string} repName
 * @param {string} city
 * @param {string | undefined} role
 * @returns {Promise<{ wikipediaUrl: string | null, wikipediaExtractSnippet: string | null, candidateElectionYear: number | null }>}
 */
async function lookUpWikipedia(repName, city, role) {
  try {
    const title = await searchWikipediaTitle(buildSearchQuery(repName, city, role), city);
    if (!title) return { wikipediaUrl: null, wikipediaExtractSnippet: null, candidateElectionYear: null };

    const summary = await fetchWikipediaSummary(title, city);
    if (!summary) return { wikipediaUrl: null, wikipediaExtractSnippet: null, candidateElectionYear: null };

    return {
      wikipediaUrl: summary.url,
      wikipediaExtractSnippet: summary.extract,
      candidateElectionYear: extractCandidateYear(summary.extract),
    };
  } catch (err) {
    console.warn(`[terms-of-service-leads] Wikipedia lookup errored for ${repName} (${city}):`, err.message);
    return { wikipediaUrl: null, wikipediaExtractSnippet: null, candidateElectionYear: null };
  }
}

/**
 * @param {string} city
 * @returns {string}
 */
function verificationGuidanceFor(city) {
  const rule = CITY_SEATING_RULES[city] ?? "unknown";
  const commonSuffix =
    "This is a Tier 4 lead (AGENTS.md §3.3) — verify against a Tier 1/2 primary source " +
    "before entering any date into scripts/fetch-mayors.mjs or scripts/fetch-wards.mjs.";

  if (rule === "statutory") {
    return (
      `${city} is a statutory city (per the existing header comment in fetch-mayors.mjs/` +
      `fetch-wards.mjs). Confirm the certified election date via a county canvass, then apply ` +
      `MN Stat. § 412.02 Subd. 2 (${STATUTE_URL}) — terms commence the first Monday in January ` +
      `following the election — to derive the seating date. ${commonSuffix}`
    );
  }
  if (rule === "charter") {
    return (
      `${city} is a home rule charter city (per the existing header comment in fetch-mayors.mjs/` +
      `fetch-wards.mjs). The MN Stat. § 412.02 Subd. 2 shortcut does NOT apply — research ${city}'s ` +
      `own charter for its seating-date provision. ${commonSuffix}`
    );
  }
  return (
    `${city}'s statutory-vs-charter status is not stated in fetch-mayors.mjs/fetch-wards.mjs's ` +
    `existing header comments — confirm this first (a Minnesota city-classification lookup or the ` +
    `city's own charter page) before deciding whether the MN Stat. § 412.02 Subd. 2 shortcut ` +
    `(${STATUTE_URL}) applies. ${commonSuffix}`
  );
}

/**
 * @param {Array<{ type: string, properties: Record<string, unknown> }>} features
 * @returns {Array<Record<string, unknown>>}
 */
function collectGaps(features) {
  const gaps = [];
  for (const feature of features) {
    const properties = feature.properties ?? {};
    const missingFields = missingTermFields(properties);
    if (missingFields.length === 0) continue;
    gaps.push({
      repName: properties.repName ?? null,
      city: properties.city ?? null,
      county: (properties.city && CITY_COUNTY[properties.city]) ?? properties.county ?? null,
      role: properties.role ?? null,
      missingFields,
    });
  }
  return gaps;
}

/**
 * @param {Array<Record<string, unknown>>} leads
 * @returns {string}
 */
function renderMarkdown(leads) {
  const lines = [
    "# Terms-of-service leads",
    "",
    "Generated by `scripts/ingest/write-terms-of-service-leads.mjs`. Do not hand-edit — re-run the",
    "script instead, this file is derived from `terms-of-service-leads.json`.",
    "",
    NOTE,
    "",
    `Total leads: ${leads.length}. Wikipedia candidate year found: ` +
      `${leads.filter((l) => l.candidateElectionYear !== null).length}. No usable match: ` +
      `${leads.filter((l) => l.candidateElectionYear === null).length}.`,
    "",
    "| Rep | City | County | Role | Missing | Seating rule | Candidate year | Wikipedia |",
    "|---|---|---|---|---|---|---|---|",
  ];

  for (const lead of leads) {
    const wiki = lead.wikipediaUrl ? `[link](${lead.wikipediaUrl})` : "—";
    lines.push(
      `| ${lead.repName ?? "—"} | ${lead.city ?? "—"} | ${lead.county ?? "—"} | ${lead.role ?? "—"} | ` +
        `${lead.missingFields.join(", ")} | ${lead.citySeatingRule} | ${lead.candidateElectionYear ?? "—"} | ${wiki} |`,
    );
  }

  if (leads.length === 0) {
    lines.push("| _no gaps found — every termsOfService entry currently has both dates_ | | | | | | | |");
  }

  lines.push("", "## Per-lead verification guidance", "");
  for (const lead of leads) {
    lines.push(`### ${lead.repName ?? "(unknown name)"} — ${lead.city ?? "(unknown city)"}`, "");
    if (lead.wikipediaExtractSnippet) {
      lines.push(`> ${lead.wikipediaExtractSnippet.replace(/\n+/g, " ")}`, "");
    }
    lines.push(lead.verificationGuidance, "");
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const [mayors, wards] = await Promise.all([readGeojson(MAYORS_PATH), readGeojson(WARDS_PATH)]);

  const gaps = [...collectGaps(mayors.features ?? []), ...collectGaps(wards.features ?? [])];

  console.log(`[terms-of-service-leads] found ${gaps.length} record(s) with a null termStart/termEnd.`);

  const leads = [];
  let matched = 0;
  for (const gap of gaps) {
    const city = /** @type {string} */ (gap.city);
    const repName = /** @type {string} */ (gap.repName);
    const role = /** @type {string | undefined} */ (gap.role);

    const wiki = repName && city ? await lookUpWikipedia(repName, city, role) : {
      wikipediaUrl: null,
      wikipediaExtractSnippet: null,
      candidateElectionYear: null,
    };

    if (wiki.candidateElectionYear !== null) matched += 1;

    leads.push({
      repName: gap.repName,
      city: gap.city,
      county: gap.county,
      role: gap.role,
      missingFields: gap.missingFields,
      citySeatingRule: CITY_SEATING_RULES[city] ?? "unknown",
      wikipediaUrl: wiki.wikipediaUrl,
      wikipediaExtractSnippet: wiki.wikipediaExtractSnippet,
      candidateElectionYear: wiki.candidateElectionYear,
      verificationGuidance: verificationGuidanceFor(city),
    });
  }

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    note: NOTE,
    leads,
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_JSON, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await writeFile(OUTPUT_MD, renderMarkdown(leads), "utf8");

  console.log(
    `[terms-of-service-leads] wrote ${leads.length} lead(s) to ${OUTPUT_JSON} and ${OUTPUT_MD} ` +
      `(${matched} with a Wikipedia candidate year, ${leads.length - matched} with no usable match).`,
  );
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
