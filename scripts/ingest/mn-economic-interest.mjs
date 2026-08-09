#!/usr/bin/env node
// scripts/ingest/mn-economic-interest.mjs
//
// MN Campaign Finance Board Statements of Economic Interest (SEI) —
// answers AGENTS.md question 3's stock/outside-income case, which
// mn-campaign-finance.mjs (contributions only) does not cover. See
// AGENTS.md §3.2's "Economic interest" source row, added 2026-08-09.
//
// --- Confirmed live, 2026-08-09 ----------------------------------------
//
// Per-official pages at https://cfb.mn.gov/reports-and-data/officials-
// financial-disclosure/official/<id>/ are real, structured HTML (not
// scanned PDFs) — confirmed by directly fetching id 14965 (Billy Menz) and
// id 12529 (Wayne Skoe), which returned occupation/employer, income-source
// relationships, real property (county + acreage, never a street address),
// and a securities-holdings field ("None reported" when empty, meaning the
// field is populated when an official does hold stock).
//
// --- The unsolved half: bulk ID enumeration -----------------------------
//
// There is no confirmed public bulk/name-search endpoint for "give me every
// official's id." The board's own "list of all public officials with their
// agencies" page (linked from the official-disclosure landing page) is a
// client-rendered SPA (https://cfb.mn.gov/reports-and-data/searches-and-
// lists/other-reports-and-lists/current-lists/#/officials-with-their-
// agencies/all/) whose data-loading call could not be located by static
// inspection of its shipped JS bundles (checked 2026-08-09: no
// /api/*officials* or *.json endpoint referenced in app.js/default.js/
// site.js). Sequentially guessing numeric ids (14965, 12529, ...) would
// violate AGENTS.md §2.2 ("no unbounded requests... a source that cannot be
// fetched politely gets a knownGaps entry and a manual workflow, not a
// workaround").
//
// Per AGENTS.md §3.1 ("default resolution for any missing feed: render an
// honest empty state"), this script does NOT guess ids. It ships as a real,
// working single-official fetcher (fetchOfficialRecord below — reusable
// once enumeration is solved, and independently useful for a manual
// spot-check workflow) driven by an explicit id/name allowlist. With no
// allowlist populated, it writes the honest empty index below and exits 0
// — same shape as scripts/ingest/lims-minneapolis.mjs exiting cleanly with
// an empty state when LIMS_API_KEY is absent.
//
// To resolve a specific official's id today: open
// https://cfb.mn.gov/reports-and-data/officials-financial-disclosure/official/
// in a browser (renders client-side), search by name, and copy the id from
// the resulting URL into KNOWN_OFFICIAL_IDS below. This is the manual
// workflow §2.2 asks for in place of a scraping workaround.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OUTPUT_DIR = path.join(__dirname, "../../public/economic-interest");
const INDEX_PATH = path.join(OUTPUT_DIR, "index.json");
const OFFICIALS_DIR = path.join(OUTPUT_DIR, "officials");

const USER_AGENT =
  "wealldobettermn-etl/0.1 (+https://github.com/ngabantudev/wealldobettermn; civic transparency data pipeline)";
const SOURCE_AGENCY = "Minnesota Campaign Finance and Public Disclosure Board";
const SOURCE_LICENCE =
  "Public record under Minn. Stat. ch. 10A — verify current redistribution terms on cfb.mn.gov before publishing.";

// Manual allowlist per the header comment above — no id-guessing. Each
// entry is a human-verified {id, name} pair, e.g. found by browsing the
// board's own site and copying the URL. Empty until a maintainer populates
// it; the "all candidates" version of this layer is blocked on solving bulk
// enumeration (AGENTS.md §3.3 knownGaps), not on this fetch/parse logic.
const KNOWN_OFFICIAL_IDS = [
  // { id: "12345", name: "Jane Doe" },
];

const KNOWN_GAPS = [
  "No public bulk or name-search endpoint has been found for the CFB's official roster — this importer ingests only the manually-verified ids in KNOWN_OFFICIAL_IDS, not 'all officials.' See this file's header comment for what was checked and why id-guessing was rejected (AGENTS.md §2.2).",
  "Dollar values for securities holdings are never published: the SEI form itself does not require the official to disclose a value, only the issuer's name.",
  "Real property street addresses are redacted at ingest (see redactIfStreetAddress() above) pending a maintainer policy call on the §1a/§1b tension: §1a lists SEIs as fully publishable, §1b bans household-resolution data. Section/township/range and platted-lot descriptions are not redacted.",
  "The 'Securities' section's positive-case (an official who does hold stock) markup is unverified — neither official checked while building this held any. extractFirstColumnList()'s first-<td>-per-row shape is inferred from the Sources-of-income table, not confirmed against a populated Securities table.",
];

// Extracts the inner HTML of the <div> whose <h2> text matches `heading`
// (case-insensitive, trailing whitespace in the source markup tolerated —
// the live "Government agency interests " heading has a trailing space).
// Two distinct sections share div class="sources" (Sources of income vs.
// Government agency interests), so the h2 text, not the class, is what
// disambiguates them — confirmed against real markup on cfb.mn.gov,
// 2026-08-09 (see this file's header comment for the ids checked).
function extractSection(html, heading) {
  const re = new RegExp(`<h2>\\s*${heading}\\s*</h2>([\\s\\S]*?)</div>\\s*(?:<div class=|</section>)`, "i");
  const m = html.match(re);
  return m ? m[1] : null;
}

// A section renders `<p>None reported</p>` when empty, or a `<table>` when
// populated. Returns [] for the empty case; for the populated case, returns
// the first `<td>` of each body row (the item name — source name, security
// issuer, agency name) as a plain string list. Untested against a
// populated "Securities" section specifically (neither of the two officials
// checked while building this held any) — flagged in knownGaps until a
// maintainer confirms a real positive example matches this shape.
// AGENTS.md tension, not yet resolved by policy: §1a lists Statements of
// Economic Interest as publishable, full stop; §1b bans "anything at
// household resolution." The CFB's real-property table's "Address or
// section information" column mixes both — rural parcels described by
// section/township/range (fine, not household-resolution) and, confirmed
// live (official id 14965), a literal street address for urban property.
// Per §1d "when in doubt, leave it out," this redacts anything matching a
// street-address shape (leading house number + word, e.g. "5 E White
// Street") rather than deciding the §1a/§1b tension unilaterally — see
// knownGaps. Section/township/range and platted-lot descriptions (Skoe,
// id 12529: "Sec 16 TWP 159 RG 28...", "Auditors plat 21 Lot 20") pass
// through unredacted; they don't resolve to a single household.
function redactIfStreetAddress(description) {
  if (/^\d+\s+[A-Za-z]/.test(description) && !/^\d+\s+(Sec|Section|TWP|Township|RG|Range|Lot)\b/i.test(description)) {
    return "[redacted — street-level address; see AGENTS.md §1a/§1b tension in this file's header]";
  }
  return description;
}

function extractFirstColumnList(sectionHtml) {
  if (sectionHtml === null) return [];
  if (/none reported/i.test(sectionHtml)) return [];
  const rows = [...sectionHtml.matchAll(/<tr>\s*<td>([^<]*)<\/td>/gi)];
  return rows.map((r) => r[1].trim()).filter(Boolean);
}

/**
 * Fetches and parses one official's SEI page. Verified against the two live
 * pages named in the header comment (ids 14965, 12529) for occupation,
 * employer, income sources, real property, and the "None reported"
 * securities/government-interest case. Every extractor fails to null/[]
 * rather than throwing, so one changed label degrades a single field
 * instead of the whole record (AGENTS.md §3.3: leave a field null over
 * guessing it).
 * @param {string} id
 * @param {string} officialName
 * @returns {Promise<import("../../src/lib/economicInterestTypes.js").EconomicInterestRecord>}
 */
async function fetchOfficialRecord(id, officialName) {
  const sourceUrl = `https://cfb.mn.gov/reports-and-data/officials-financial-disclosure/official/${id}/`;
  const res = await fetch(sourceUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${sourceUrl}`);
  const html = await res.text();

  const occupationMatch = html.match(/<span class="occupation">Occupation:\s*([^<]*)<\/span>/i);
  const employerMatch = html.match(/<span class="employer">Employer:\s*([^<]*)<\/span>/i);

  const realPropertySection = extractSection(html, "Real property");
  const realProperty =
    realPropertySection && !/none reported/i.test(realPropertySection)
      ? [...realPropertySection.matchAll(/class="col-County">([^<]*)<\/td><td class="col-Address">([^<]*)</gi)].map(
          ([, county, description]) => ({ county: county.trim(), description: redactIfStreetAddress(description.trim()) }),
        )
      : [];

  return {
    schemaVersion: 1,
    officialCfbId: id,
    officialName,
    sourceUrl,
    lastUpdated: null, // no "Last updated" label found in the live markup checked — left null rather than guessed; see knownGaps
    occupation: occupationMatch ? occupationMatch[1].trim() || null : null,
    employer: employerMatch ? employerMatch[1].trim() || null : null,
    securitiesHoldings: extractFirstColumnList(extractSection(html, "Securities")),
    realProperty,
    incomeSources: extractFirstColumnList(extractSection(html, "Sources of income")),
    governmentAgencyInterests: extractFirstColumnList(extractSection(html, "Government agency interests")),
    provenance: {
      primarySourceUrl: sourceUrl,
      sourceAgency: SOURCE_AGENCY,
      documentType: "Statement of Economic Interest",
      fetchedAt: new Date().toISOString(),
      licence: SOURCE_LICENCE,
    },
  };
}

async function main() {
  const generatedAt = new Date().toISOString();
  await mkdir(OFFICIALS_DIR, { recursive: true });

  const officials = [];
  for (const { id, name } of KNOWN_OFFICIAL_IDS) {
    const record = await fetchOfficialRecord(id, name);
    const dataPath = `/economic-interest/officials/${id}.json`;
    await writeFile(path.join(OFFICIALS_DIR, `${id}.json`), JSON.stringify(record));
    officials.push({ officialCfbId: id, officialName: name, dataPath });
  }

  /** @type {import("../../src/lib/economicInterestTypes.js").EconomicInterestIndex} */
  const index = {
    schemaVersion: 1,
    generatedAt,
    provenance: {
      primarySourceUrl: "https://cfb.mn.gov/reports-and-data/officials-financial-disclosure/official/",
      sourceAgency: SOURCE_AGENCY,
      documentType: "Statement of Economic Interest index",
      fetchedAt: generatedAt,
      licence: SOURCE_LICENCE,
    },
    officials,
    knownGaps: KNOWN_GAPS,
  };

  await writeFile(INDEX_PATH, JSON.stringify(index));
  console.log(
    `[done] wrote ${officials.length} official record(s) — KNOWN_OFFICIAL_IDS is empty until bulk enumeration is solved or entries are added manually; see KNOWN_GAPS.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[fatal]", err.message);
    process.exit(1);
  });
}
