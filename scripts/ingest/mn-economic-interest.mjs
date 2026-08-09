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
// scanned PDFs) — confirmed by directly fetching id 14965 (Billy Menz), id
// 12529 (Wayne Skoe), and id 13408 (Thom Petersen, whose page has a
// populated Government agency interests table — "Professional consulting"
// — unlike the first two officials, who both had "None reported" there).
// Occupation/employer, income-source relationships, real property (a mix
// of legal section/township/range descriptions AND, confirmed live for id
// 14965, literal street addresses — see redactIfStreetAddress() below),
// government agency interests, and a securities-holdings field ("None
// reported" when empty, meaning the field is populated when an official
// does hold stock — the populated case itself remains unverified, see
// knownGaps) were all confirmed against real markup.
//
// --- A multi-dimension review (2026-08-09) found this shipped with real
// privacy bugs, fixed in this same commit ------------------------------
//
// Live re-verification against ~100 additional real official pages found
// two confirmed leaks in the version of this script first committed:
// (1) redactIfStreetAddress()'s regex missed ordinal-numbered street names
// ("1st", "18th", "73rd", "120th" — extremely common in Minneapolis/St.
// Paul), no-space entries ("999East Bay Rd"), letter-suffixed house
// numbers ("5A..."), and hyphenated ranges ("123-125 Main St") — all fixed
// below. (2) incomeSources and governmentAgencyInterests published private
// family members' names verbatim when CFB's own data annotated a row with
// a relationship marker (confirmed live: official 14898's government-
// agency-interests entry read "Licensed Professional Clinical Counselor MN
// - Beth McNally (spouse)"; several officials' income sources read "Wells
// Fargo (Spouse)", "Allina Health (Spouse)") — see redactIfFamilyMember()
// below. Neither bug had shipped to public/ (KNOWN_OFFICIAL_IDS was still
// empty when found), but both are fixed at the extraction layer plus a
// runtime backstop assertion (assertNoHouseholdOrFamilyLeak, mirroring
// mn-campaign-finance.mjs's assertNoIndividualDonorLeak) that refuses to
// write a record where either check would fail, so a future regression is
// caught at ingest, not discovered live again. Both fixes were re-verified
// end-to-end against the exact live records that leaked before the fix —
// official 12537 (Rick Hogenson, ordinal-street real property, now
// redacted) and official 14898 (Adam Arnold, spousal government-agency
// interest, now dropped) — not just against synthetic regex test cases.
// Arnold's page also happened to have a real, populated Securities table
// ("OAANX"), independently confirming extractFirstColumnList()'s row shape
// for that section too — previously an open gap.
//
// Not fully solved: a private individual's name with NO explicit
// relationship marker (e.g. official 12529's income-source row lists
// "Carol Skoe" — likely a family member sharing the official's surname,
// flagged via a "Partner" relationship checkbox this script doesn't parse,
// but with no "(spouse)"-style text marker to pattern-match against) is
// not caught by either fix. See knownGaps — this remains an open risk
// requiring human review before publishing incomeSources/
// governmentAgencyInterests for any newly-added official.
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
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OUTPUT_DIR = path.join(__dirname, "../../public/economic-interest");
const INDEX_PATH = path.join(OUTPUT_DIR, "index.json");
const OFFICIALS_DIR = path.join(OUTPUT_DIR, "officials");

const USER_AGENT =
  "wealldobettermn-etl/0.1 (+https://github.com/ngabantudev/wealldobettermn; civic transparency data pipeline)";
const SOURCE_AGENCY = "Minnesota Campaign Finance and Public Disclosure Board";
// Redistribution posture verified 2026-08-09 against revisor.mn.gov directly
// (Tier 1 primary source per AGENTS.md §3.3) — see AGENTS.md §3.2. The
// operative rule is Minn. Stat. § 10A.35 ("Commercial Use of Information
// Prohibited"), not a CFB-issued licence — cfb.mn.gov has no Terms of Use
// page at all. § 10A.35 bars selling or using copied report/statement data
// "for a commercial purpose," but states explicitly that "purposes related
// to elections, political activities, or law enforcement are not commercial
// purposes" — this project's nonpartisan, ad-free, non-commercial civic-
// transparency use reads as within that carve-out on a plain reading. No
// attribution is legally required (none found in the statute or the
// Board's own data-access policy PDF). Separately, and independent of this
// licence question: the same research surfaced that the Board's own policy
// classifies most street addresses in filed reports/statements as nonpublic
// — but carves out real-property addresses disclosed on a Statement of
// Economic Interest specifically (Minn. Stat. § 10A.09, subd. 5(b)/5b(d))
// as potentially public unless the filer designated them private. That
// nuance is not yet reconciled with redactIfStreetAddress()'s blanket
// redaction below — left as the conservative default per §1d "when in
// doubt, leave it out" until a maintainer reviews it (see knownGaps).
// This reading is a well-sourced working answer, not a substitute for
// attorney sign-off before publishing a definitive compliance claim (e.g.
// on /privacy or /sources) — see AGENTS.md §3.4.
//
// Also unresolved (see mn-campaign-finance.mjs's identical note): cfb.mn.gov
// /robots.txt has two contradictory back-to-back `User-agent: *` blocks —
// the first a blanket `Disallow: /`. Flagged as a question for the same CFB
// outreach contact as the bulk-ID-enumeration question above; no message
// has actually been sent yet.
const SOURCE_LICENCE =
  "Public record under Minn. Stat. ch. 10A; commercial use/sale is barred by § 10A.35, " +
  "but purposes related to elections, political activities, or law enforcement are not " +
  "commercial purposes under that section — this project's non-commercial civic-transparency " +
  "use reads as within that carve-out (verified against revisor.mn.gov, 2026-08-09; not a " +
  "substitute for attorney review before publishing a compliance claim).";

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
  "Real property street addresses are redacted at ingest (see redactIfStreetAddress() below) pending a maintainer policy call on the §1a/§1b tension: §1a lists SEIs as fully publishable, §1b bans household-resolution data. Section/township/range and platted-lot descriptions are not redacted. A street address built from a word also used in a legal-description keyword (e.g. \"5 Township Road 116\") is a known remaining edge case in the exclusion check.",
  "The 'Securities' section's positive-case is now confirmed against a real populated table: official 14898 (Adam Arnold) discloses one holding, \"OAANX\" — a single-column row, matching extractFirstColumnList()'s existing assumption exactly. No further gap here.",
  "incomeSources, governmentAgencyInterests, and securitiesHoldings are redacted for explicit family-relationship markers (see redactIfFamilyMember() below — catches '(spouse)', '(domestic partner)', etc., confirmed live against real leaked examples) but NOT for a private individual's bare name with no marker — e.g. official 12529's income-source row lists 'Carol Skoe' with only a 'Partner' relationship checkbox, unparsed by this script, and no way to distinguish that from a business partner's company name using free text alone. Human review is required before adding any official to KNOWN_OFFICIAL_IDS whose income sources or agency interests might name a private individual.",
  "EconomicInterestRecord carries no officeHeld/jurisdiction/termStart/termEnd and no foreign key into src/lib/models.ts's Person/Holding — AGENTS.md §1d requires those four fields on every person record. The only gate on what gets ingested today is a human manually curating KNOWN_OFFICIAL_IDS; nothing here structurally rejects a filer outside §1a's enumerated office categories (MN's SEI filing requirement reaches some non-elected officials beyond that list).",
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
// street-address shape rather than deciding the §1a/§1b tension
// unilaterally — see knownGaps.
//
// A multi-dimension live-verified review (2026-08-09) found the first
// version of this regex — `/^\d+\s+[A-Za-z]/` — missed most of Minneapolis
// and St. Paul's own street-naming convention: numbered/ordinal streets
// ("1st", "18th", "73rd", "120th") start with a DIGIT, not a letter, so
// "328 3rd Ave" (a real official's real address, id 12537) passed straight
// through unredacted. Also missed: no-space entries ("999East Bay Rd"),
// letter-suffixed house numbers ("5A..."), and hyphenated ranges ("123-125
// Main St"). LEGAL_DESCRIPTION_RE below requires the section/township/
// range keyword to be followed by another digit (as real legal
// descriptions always are — "TWP 159 RG 28") rather than matching the bare
// keyword alone, so a real street name that happens to contain one of
// these words ("5 Township Road 116") is still redacted rather than
// wrongly excluded — the previous version's exclusion list couldn't tell
// the two apart.
const LEGAL_DESCRIPTION_RE = /^\d+[\d,\s]*\s*(Sec\.?|Section|TWP|Township|RG|Range|Lot)\.?\s*\d/i;
// The street-name token after the house number is one of three shapes:
// (1) a letter, zero or more spaces away — a named street ("White") or the
//     no-space CFB entry shape ("999East"); (2) a bare number with a
//     mandatory ordinal suffix ("73rd", "120th"); (3) a bare number with
//     NO suffix, but only when separated from the house number by real
//     whitespace and followed by another whitespace + letter word ("21191
//     53 St NW", confirmed live, official id 12525) — the mandatory
//     leading \s+ in this branch (not \s*) matters: without it, the regex
//     engine can backtrack the house-number match itself down to a single
//     digit and misread a legal description's digit list (e.g.
//     "10,15,16,28 -154n-46w") as "house number 1, street 0".
const STREET_ADDRESS_RE = /^\d+[A-Za-z]?(?:-\d+)?(?:\s*[A-Za-z]|\s*\d+(?:st|nd|rd|th)\b|\s+\d+\s+[A-Za-z])/i;

function redactIfStreetAddress(description) {
  if (STREET_ADDRESS_RE.test(description) && !LEGAL_DESCRIPTION_RE.test(description)) {
    return "[redacted — street-level address; see AGENTS.md §1a/§1b tension in this file's header]";
  }
  return description;
}

// AGENTS.md §1b: "Private life of officials... family members... Never
// named, never mapped, never counted." Confirmed live, 2026-08-09: CFB's
// free-text income-source and government-agency-interest tables sometimes
// annotate a row with the filer's relationship to a private family member
// — official 14898's government-agency-interests entry read "Licensed
// Professional Clinical Counselor MN - Beth McNally (spouse)"; officials
// 14932/14950/14813/14985 had income-source rows like "Wells Fargo
// (Spouse)", "Allina Health (Spouse)". That family member's name reaching
// public/ verbatim is exactly the leak §1b prohibits, independent of the
// street-address question above. This drops (not redacts-in-place — per
// §1d "when in doubt, leave it out," the row itself carries no
// transparency value once its subject is removed) any row containing an
// explicit family-relationship marker. It does NOT catch a bare personal
// name with no marker (e.g. official 12529's "Carol Skoe," disclosed only
// via an unparsed relationship checkbox) — see knownGaps; that remains an
// open risk requiring human review.
const FAMILY_RELATIONSHIP_RE = /\((?:spouse|domestic partner|child|dependent|parent)\)/i;

function dropFamilyMemberRows(entries) {
  return entries.filter((entry) => !FAMILY_RELATIONSHIP_RE.test(entry));
}

// A section renders `<p>None reported</p>` when empty, or a `<table>` when
// populated. Returns [] for the empty case; for the populated case, returns
// the first `<td>` of each body row (the item name — source name, security
// issuer, agency name) as a plain string list. Confirmed against a real
// populated table for Sources of income (ids 14965, 12529) and Government
// agency interests (id 13408, "Professional consulting") — the Securities
// section's populated case remains unverified (see knownGaps).
function extractFirstColumnList(sectionHtml) {
  if (sectionHtml === null) return [];
  if (/none reported/i.test(sectionHtml)) return [];
  const rows = [...sectionHtml.matchAll(/<tr>\s*<td>([^<]*)<\/td>/gi)];
  return rows.map((r) => r[1].trim()).filter(Boolean);
}

/**
 * Fetches and parses one official's SEI page. Verified against three live
 * pages (ids 14965, 12529, 13408) for occupation, employer, income
 * sources, real property, government agency interests, and the "None
 * reported" securities case. Every extractor fails to null/[] rather than
 * throwing, so one changed label degrades a single field instead of the
 * whole record (AGENTS.md §3.3: leave a field null over guessing it).
 * @param {string} id
 * @param {string} officialName
 * @returns {Promise<import("../../src/lib/economicInterestTypes.js").EconomicInterestRecord>}
 */
async function fetchOfficialRecord(id, officialName) {
  const sourceUrl = `https://cfb.mn.gov/reports-and-data/officials-financial-disclosure/official/${id}/`;
  const res = await fetch(sourceUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${sourceUrl}`);
  const html = await res.text();

  // A multi-dimension live-verified review (2026-08-09) found the previous
  // version of these regexes matched `<span class="occupation">`/
  // `<span class="employer">` markup that only exists inside an HTML
  // comment on the live page — dead, unrendered template leftovers, not
  // the actual displayed value. Extraction "worked" only by coincidence
  // (CFB's template still duplicates the value there today); a routine
  // template cleanup removing that comment would have silently nulled
  // both fields with no error. Fixed to target the real, rendered
  // `<table class="occupation-employer-table">` cells directly — confirmed
  // against the live markup on both officials this script was built
  // against.
  const occupationMatch = html.match(/<td class="occupation">[^<]*<\/td>\s*<td>([^<]*)<\/td>/i);
  const employerMatch = html.match(/<td class="employer">[^<]*<\/td>\s*<td>([^<]*)<\/td>/i);

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
    securitiesHoldings: dropFamilyMemberRows(extractFirstColumnList(extractSection(html, "Securities"))),
    realProperty,
    incomeSources: dropFamilyMemberRows(extractFirstColumnList(extractSection(html, "Sources of income"))),
    governmentAgencyInterests: dropFamilyMemberRows(extractFirstColumnList(extractSection(html, "Government agency interests"))),
    provenance: {
      primarySourceUrl: sourceUrl,
      sourceAgency: SOURCE_AGENCY,
      documentType: "Statement of Economic Interest",
      fetchedAt: new Date().toISOString(),
      licence: SOURCE_LICENCE,
    },
  };
}

// Runtime guard, not just a code-review convention — mirrors
// assertNoIndividualDonorLeak() in mn-campaign-finance.mjs, added after a
// multi-dimension review (2026-08-09) found this script had no equivalent
// backstop: the only thing preventing a raw street address or an
// unfiltered family member's name from reaching public/ was a single
// inline function call inside the extraction path, with nothing to catch
// a future regression (a new real-property markup shape, a refactor that
// skips the redaction call, a regex edit that reintroduces a gap).
// Independently re-checks a fully-built record right before writeFile,
// using the same STREET_ADDRESS_RE/LEGAL_DESCRIPTION_RE/
// FAMILY_RELATIONSHIP_RE the extraction path itself uses, so a record
// that bypassed redaction some other way still gets caught here.
function assertNoHouseholdOrFamilyLeak(record) {
  for (const { description } of record.realProperty) {
    assert.ok(
      description.startsWith("[redacted") || !STREET_ADDRESS_RE.test(description) || LEGAL_DESCRIPTION_RE.test(description),
      `[mn-economic-interest] household-resolution address leak for official ${record.officialCfbId} ` +
        `(${record.officialName}): "${description}". Refusing to write output.`,
    );
  }
  for (const field of ["incomeSources", "governmentAgencyInterests", "securitiesHoldings"]) {
    for (const entry of record[field]) {
      assert.ok(
        !FAMILY_RELATIONSHIP_RE.test(entry),
        `[mn-economic-interest] family-member leak for official ${record.officialCfbId} ` +
          `(${record.officialName}) in ${field}: "${entry}". Refusing to write output.`,
      );
    }
  }
}

async function main() {
  const generatedAt = new Date().toISOString();
  await mkdir(OFFICIALS_DIR, { recursive: true });

  const officials = [];
  for (const { id, name } of KNOWN_OFFICIAL_IDS) {
    const record = await fetchOfficialRecord(id, name);
    // Required before any write below — same convention as
    // mn-campaign-finance.mjs's assertNoIndividualDonorLeak() call.
    assertNoHouseholdOrFamilyLeak(record);
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
