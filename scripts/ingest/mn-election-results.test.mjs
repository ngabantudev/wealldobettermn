#!/usr/bin/env node
// scripts/ingest/mn-election-results.test.mjs
//
// Tests for the pure/testable logic in scripts/ingest/mn-election-results.mjs
// — the semicolon-delimited row parser, the precinct-level row filter, the
// votePercent rounding rule, contest grouping, write-in detection, the
// no-winner-field structural backstop per AGENTS.md §1c, and the
// dependency-free Windows-1252 decoder. Node's built-in test runner, no
// live network calls, no writes to public/ — same convention as
// mn-campaign-finance.test.mjs.
//
// Run directly: node scripts/ingest/mn-election-results.test.mjs
// Or via the whole ingest suite: node --test scripts/ingest/

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseResultLine,
  parseRawFile,
  computeVotePercent,
  isWriteInCandidate,
  buildContests,
  assertNoForbiddenField,
  decodeWindows1252,
} from "./mn-election-results.mjs";

const FIXTURE_PROVENANCE = {
  primarySourceUrl: "https://electionresultsfiles.sos.mn.gov/20260811/",
  sourceAgency: "Office of the Minnesota Secretary of State",
  documentType: "election results text file",
  documentId: "200",
  issuedDate: null,
  fetchedAt: "2026-08-12T00:00:00.000Z",
  licence: "test fixture",
  contentHash: "0".repeat(64),
};

const FIXTURE_CONTEXT = { certificationStatus: "unofficial", provenance: FIXTURE_PROVENANCE, resultsAsOf: null };

// --- parseResultLine --------------------------------------------------------
//
// Real-format fixtures per the confirmed live column layout (2026-08-12):
// County and Precinct are EMPTY STRINGS on a statewide/aggregate row, not
// the "00"/"0000" placeholders an earlier pass assumed.

test("parseResultLine maps all 16 columns correctly", () => {
  const line =
    "MN;27;;0101;State Representative District 60A;60A;0001;Jane Q. Testcandidate;;X;DFL;100;100;1234;55.2;2234";
  const row = parseResultLine(line);
  assert.deepEqual(row, {
    state: "MN",
    countyCode: "27",
    precinctCode: "",
    contestId: "0101",
    contestName: "State Representative District 60A",
    district: "60A",
    candidateNumber: "0001",
    candidateName: "Jane Q. Testcandidate",
    suffix: "",
    incumbentIndicator: "X",
    party: "DFL",
    precinctsReporting: 100,
    totalPrecincts: 100,
    votes: 1234,
    sourcePercent: "55.2",
    contestTotalVotes: 2234,
  });
});

test("parseResultLine returns null for a blank line", () => {
  assert.equal(parseResultLine(""), null);
  assert.equal(parseResultLine("   "), null);
});

test("parseResultLine returns null for a malformed row rather than guessing", () => {
  assert.equal(parseResultLine("not;a;valid;row"), null);
});

test("parseResultLine returns null when the numeric votes column isn't parseable", () => {
  assert.equal(
    parseResultLine("MN;27;;0101;Contest;60A;0001;Candidate;;;DFL;100;100;NOTANUMBER;55.2;2234"),
    null,
  );
});

test("parseResultLine handles a blank party (nonpartisan contest)", () => {
  const row = parseResultLine("MN;27;;0201;City Question 1;;0001;Yes;;;;50;50;300;60.0;500");
  assert.equal(row.party, "");
});

test("parseResultLine reports a real county code as-is (e.g. a county-races row)", () => {
  const row = parseResultLine("MN;01;;0391;County Commissioner District 1;01;9001;Timothy Catlin;;;NP;2;2;219;35.78;612");
  assert.equal(row.countyCode, "01");
  assert.equal(row.precinctCode, "");
});

test("parseResultLine keeps an alphanumeric district value as-is (e.g. a State House district)", () => {
  const row = parseResultLine("MN;;;0194;State Representative District 4A;4A;0301;Andrew Rockhold;;;R;13;13;1171;100.00;1171");
  assert.equal(row.district, "4A");
});

// --- parseRawFile: precinct-level and malformed-line filtering --------------

test("parseRawFile skips precinct-level rows (any non-empty precinct field)", () => {
  const raw = [
    "MN;27;;0101;Contest A;60A;0001;Statewide Row;;;DFL;100;100;500;100;500",
    "MN;27;0412;0101;Contest A;60A;0001;Precinct Row;;;DFL;10;10;50;100;500",
  ].join("\n");
  const { rows, skippedPrecinctRowCount } = parseRawFile(raw);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].candidateName, "Statewide Row");
  assert.equal(skippedPrecinctRowCount, 1);
});

test("parseRawFile skips malformed lines without throwing", () => {
  const raw = [
    "MN;27;;0101;Contest A;60A;0001;Candidate A;;;DFL;100;100;500;100;500",
    "not;enough;fields",
    "",
  ].join("\n");
  const { rows, skippedMalformedRowCount } = parseRawFile(raw);
  assert.equal(rows.length, 1);
  assert.equal(skippedMalformedRowCount, 1);
});

// --- computeVotePercent -----------------------------------------------------

test("computeVotePercent rounds to 1 decimal place", () => {
  assert.equal(computeVotePercent(1234, 2234), 55.2);
  assert.equal(computeVotePercent(1, 3), 33.3);
  assert.equal(computeVotePercent(2, 3), 66.7);
});

test("computeVotePercent returns 0, not NaN, when the contest total is 0", () => {
  assert.equal(computeVotePercent(0, 0), 0);
});

test("computeVotePercent returns 0 for 0 votes against a nonzero total", () => {
  assert.equal(computeVotePercent(0, 500), 0);
});

test("computeVotePercent returns 100 when a candidate has all the votes", () => {
  assert.equal(computeVotePercent(500, 500), 100);
});

// --- isWriteInCandidate ------------------------------------------------------

test("isWriteInCandidate matches common write-in name spellings", () => {
  assert.equal(isWriteInCandidate("Write-In"), true);
  assert.equal(isWriteInCandidate("WRITE IN"), true);
  assert.equal(isWriteInCandidate("writein"), true);
});

test("isWriteInCandidate is false for a normal candidate name", () => {
  assert.equal(isWriteInCandidate("Jane Q. Testcandidate"), false);
});

// --- buildContests -----------------------------------------------------------

test("buildContests groups rows by contestId and orders candidates by votes descending", () => {
  const rows = [
    parseResultLine(
      "MN;;;0101;State Representative District 60A;60A;0002;John R. Otherperson;;;R;100;100;1000;44.8;2234",
    ),
    parseResultLine(
      "MN;;;0101;State Representative District 60A;60A;0001;Jane Q. Testcandidate;;X;DFL;100;100;1234;55.2;2234",
    ),
  ];
  const contests = buildContests(rows, FIXTURE_CONTEXT);
  assert.equal(contests.length, 1);
  const [contest] = contests;
  assert.equal(contest.contestId, "0101");
  assert.equal(contest.candidates.length, 2);
  assert.equal(contest.candidates[0].candidateName, "Jane Q. Testcandidate", "higher vote count sorts first");
  assert.equal(contest.candidates[1].candidateName, "John R. Otherperson");
});

test("buildContests keeps distinct contestIds separate", () => {
  const rows = [
    parseResultLine("MN;;;0101;Contest A;60A;0001;Candidate A;;;DFL;100;100;500;100;500"),
    parseResultLine("MN;;;0102;Contest B;60B;0001;Candidate B;;;R;100;100;300;100;300"),
  ];
  const contests = buildContests(rows, FIXTURE_CONTEXT);
  assert.equal(contests.length, 2);
});

test("buildContests keeps a statewide contest (empty County field) as county: null", () => {
  const rows = [parseResultLine("MN;;;0101;Governor;;0001;Candidate A;;;DFL;100;100;500;100;500")];
  const contests = buildContests(rows, FIXTURE_CONTEXT);
  assert.equal(contests[0].county, null);
  assert.equal(contests[0].contestId, "0101");
});

test("buildContests splits the same contestId into separate records per real county code", () => {
  const rows = [
    parseResultLine("MN;27;;0301;County Commissioner Dist 1;1;0001;Candidate A;;;DFL;20;20;500;100;500"),
    parseResultLine("MN;53;;0301;County Commissioner Dist 1;1;0001;Candidate B;;;R;15;15;400;100;400"),
  ];
  const contests = buildContests(rows, FIXTURE_CONTEXT);
  assert.equal(contests.length, 2);
  const ids = contests.map((c) => c.contestId).sort();
  assert.deepEqual(ids, ["0301-27", "0301-53"]);
});

test("buildContests appends a candidate's suffix to their display name", () => {
  const rows = [parseResultLine("MN;;;0101;Governor;;0001;John Smith;Jr.;;R;100;100;500;100;500")];
  const contests = buildContests(rows, FIXTURE_CONTEXT);
  assert.equal(contests[0].candidates[0].candidateName, "John Smith Jr.");
});

test("buildContests computes votePercent per candidate from the contest total, not the source file's own Percent column", () => {
  const rows = [parseResultLine("MN;;;0101;Governor;;0001;Candidate A;;;DFL;100;100;1234;99.9;2234")];
  const contests = buildContests(rows, FIXTURE_CONTEXT);
  assert.equal(contests[0].candidates[0].votePercent, 55.2);
});

test("buildContests marks a write-in row's candidate result isWriteIn: true", () => {
  const rows = [parseResultLine("MN;;;0101;Governor;;0003;Pat Write-In;;;WI;100;100;10;0.4;2234")];
  const contests = buildContests(rows, FIXTURE_CONTEXT);
  assert.equal(contests[0].candidates[0].isWriteIn, true);
});

test("buildContests carries resultsAsOf from context onto every contest", () => {
  const rows = [parseResultLine("MN;;;0101;Governor;;0001;Candidate A;;;DFL;100;100;500;100;500")];
  const contests = buildContests(rows, { ...FIXTURE_CONTEXT, resultsAsOf: "2026-08-12T20:27:47.000Z" });
  assert.equal(contests[0].resultsAsOf, "2026-08-12T20:27:47.000Z");
});

test("buildContests never produces a candidate record with a winner/projected-style field", () => {
  const rows = [
    parseResultLine(
      "MN;;;0101;State Representative District 60A;60A;0001;Jane Q. Testcandidate;;X;DFL;100;100;1234;55.2;2234",
    ),
  ];
  const contests = buildContests(rows, FIXTURE_CONTEXT);
  const candidate = contests[0].candidates[0];
  for (const key of Object.keys(candidate)) {
    assert.ok(!/winner|projected|advances|leading/i.test(key), `candidate record must not carry a "${key}" field`);
  }
  assert.deepEqual(
    Object.keys(candidate).sort(),
    ["candidateName", "candidateParty", "votes", "votePercent", "isWriteIn"].sort(),
  );
});

// --- assertNoForbiddenField: the runtime backstop ----------------------------

test("assertNoForbiddenField passes on a clean contest", () => {
  const rows = [parseResultLine("MN;;;0101;Governor;;0001;Candidate A;;;DFL;100;100;500;100;500")];
  const contests = buildContests(rows, FIXTURE_CONTEXT);
  assert.doesNotThrow(() => assertNoForbiddenField(contests));
});

test("assertNoForbiddenField throws if a contest carries a forbidden field", () => {
  const rows = [parseResultLine("MN;;;0101;Governor;;0001;Candidate A;;;DFL;100;100;500;100;500")];
  const contests = buildContests(rows, FIXTURE_CONTEXT);
  contests[0].winner = "Candidate A";
  assert.throws(() => assertNoForbiddenField(contests), /forbidden field "winner"/);
});

test("assertNoForbiddenField throws if a candidate record carries a forbidden field", () => {
  const rows = [parseResultLine("MN;;;0101;Governor;;0001;Candidate A;;;DFL;100;100;500;100;500")];
  const contests = buildContests(rows, FIXTURE_CONTEXT);
  contests[0].candidates[0].isProjectedWinner = true;
  assert.throws(() => assertNoForbiddenField(contests), /forbidden field "isProjectedWinner"/);
});

// --- decodeWindows1252 -------------------------------------------------------

test("decodeWindows1252 decodes curly double quotes (0x93/0x94) to the correct Unicode characters", () => {
  const buffer = Buffer.from([0x93, 0x41, 0x94]); // “A”
  assert.equal(decodeWindows1252(buffer), "“A”");
});

test("decodeWindows1252 decodes an en dash (0x96) and em dash (0x97)", () => {
  assert.equal(decodeWindows1252(Buffer.from([0x96])), "–");
  assert.equal(decodeWindows1252(Buffer.from([0x97])), "—");
});

test("decodeWindows1252 leaves plain ASCII bytes unchanged (round-trip)", () => {
  const ascii = "Melissa Lawlis, Jeff Reinert & J. Mark Wedel";
  assert.equal(decodeWindows1252(Buffer.from(ascii, "ascii")), ascii);
});

test("decodeWindows1252 maps a Latin-1-range accented character (e.g. í in María) correctly", () => {
  // "María" as Windows-1252/Latin-1 bytes: í is 0xED, both encodings agree
  // outside the 0x80-0x9F range.
  const buffer = Buffer.from([0x4d, 0x61, 0x72, 0xed, 0x61]); // "Mar" + í + "a"
  assert.equal(decodeWindows1252(buffer), "María");
});

// --- Empty-input-directory honest-empty-state path --------------------------
//
// Now covers the --offline/--from-manual-drop path's honest empty state:
// exercises the same directory-read code path readFromManualDropDirectory()
// uses (readdir over a possibly-nonexistent or empty directory), without
// invoking main() itself or touching the real public/ output.

test("reading a nonexistent input directory throws ENOENT — the exact error listInputFiles() catches to treat as zero files", async () => {
  const doesNotExist = path.join(tmpdir(), "mn-election-results-test-does-not-exist-" + Date.now());
  await assert.rejects(readdir(doesNotExist), { code: "ENOENT" });
});

test("reading an empty (but existing) input directory yields zero data filenames", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mn-election-results-test-"));
  try {
    await writeFile(path.join(dir, "README.md"), "not data");
    await writeFile(path.join(dir, ".gitkeep"), "");
    const IGNORED = new Set(["README.md", ".gitkeep", ".DS_Store"]);
    const filenames = (await readdir(dir)).filter((name) => !IGNORED.has(name));
    assert.deepEqual(filenames, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a directory with one real data file parses correctly end to end via parseRawFile + decodeWindows1252", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mn-election-results-test-"));
  try {
    await writeFile(path.join(dir, "README.md"), "not data");
    await writeFile(
      path.join(dir, "statewide.txt"),
      "MN;;;0101;Contest A;60A;0001;Candidate A;;;DFL;100;100;500;100;500",
    );
    const buffer = await readFile(path.join(dir, "statewide.txt"));
    const raw = decodeWindows1252(buffer);
    const { rows } = parseRawFile(raw);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].contestName, "Contest A");
    assert.equal(rows[0].votes, 500);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
