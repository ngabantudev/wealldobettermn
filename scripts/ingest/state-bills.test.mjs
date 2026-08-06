#!/usr/bin/env node
// scripts/ingest/state-bills.test.mjs
//
// Tests for the Phase 2 state bills ingest's pure transform functions.
// Uses Node's built-in test runner (`node --test`) — no dependency added
// for this, per AGENTS.md §0.8 / FEATURES.md principle 4
// ("dependency-free Node"). Matches this repo's scripts/ingest/*.test.mjs
// convention (see roster-diff.test.mjs). Complements — does not replace —
// `node scripts/ingest/state-bills.mjs --self-test`, which exercises the
// same functions end-to-end against the same fixture with plain-language
// pass/fail output.
//
// Run directly: node --test scripts/ingest/state-bills.test.mjs
// Or via the whole ingest suite: npm run test:ingest

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBillsQuery,
  compareTallies,
  crossCheckWithLegiscan,
  hashSnapshot,
  mapBillPage,
  mergeById,
  parseLegiscanRollCall,
  resolveSponsorHolding,
  resolveVoterHolding,
} from "./state-bills.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "../fixtures/state-bills-sample.json");

async function loadFixture() {
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  assert.equal(fixture.synthetic, true, "fixture must carry synthetic: true");
  return fixture;
}

// Regression test for a real bug caught only by an actual live run against
// Open States v3 on 2026-08-06: a single `include=votes,sponsorships,
// actions,sources` value 422s ("value is not a valid enumeration member")
// because the API requires `include` repeated once per field, not
// comma-joined. The fixture-driven self-test/other unit tests here only
// ever exercised response *parsing* (mapBillPage etc.), never request
// *construction* — nothing caught this until a live call did. This test
// exists so query construction can't silently regress back to the broken
// comma-joined form even though the rest of this suite runs offline.
test("buildBillsQuery repeats include= once per field rather than comma-joining them", () => {
  const url = buildBillsQuery({ page: 1 });
  const params = new URLSearchParams(url.split("?")[1]);

  assert.deepEqual(params.getAll("include"), ["votes", "sponsorships", "actions", "sources"]);
  assert.equal(params.get("jurisdiction"), "Minnesota");
  assert.equal(params.get("page"), "1");
});

test("buildBillsQuery sets updated_since and session only when provided", () => {
  const bare = new URLSearchParams(buildBillsQuery({ page: 1 }).split("?")[1]);
  assert.equal(bare.has("updated_since"), false);
  assert.equal(bare.has("session"), false);

  const withBoth = new URLSearchParams(
    buildBillsQuery({ page: 2, updatedSince: "2026-01-01", session: "2025-2026" }).split("?")[1],
  );
  assert.equal(withBoth.get("updated_since"), "2026-01-01");
  assert.equal(withBoth.get("session"), "2025-2026");
});

test("buildBillsQuery defaults to updated_desc but accepts a stable sort for resumable backfill paging", () => {
  const defaultSort = new URLSearchParams(buildBillsQuery({ page: 1 }).split("?")[1]);
  assert.equal(defaultSort.get("sort"), "updated_desc");

  // first_action_asc is live-verified (2026-08-06, via Open States' own
  // sort= enum-validation error) as one of the six sort values the real
  // API accepts, and the only stable one — introduction order doesn't
  // reshuffle as bills get updated later, which is what makes
  // backfill.nextPage a safe resume cursor across capped runs.
  const stableSort = new URLSearchParams(buildBillsQuery({ page: 1, sort: "first_action_asc" }).split("?")[1]);
  assert.equal(stableSort.get("sort"), "first_action_asc");
});

// Regression coverage for the caching/quota-protection gap found
// 2026-08-06: before this, every run overwrote public/state-bills.json
// with only that run's fetch, so repeated cheap delta-poll runs never
// accumulated coverage — they just replaced the same snapshot.
test("mergeById upserts by id, preserving existing records the fresh set doesn't touch", () => {
  const existing = [
    { id: "a", title: "old A" },
    { id: "b", title: "B, untouched this run" },
  ];
  const fresh = [{ id: "a", title: "updated A" }, { id: "c", title: "new C" }];

  const merged = mergeById(existing, fresh);

  assert.deepEqual(
    merged.map((r) => [r.id, r.title]),
    [
      ["a", "updated A"], // fresh version wins for a record both sets have
      ["b", "B, untouched this run"], // preserved even though this run never fetched it
      ["c", "new C"], // newly added
    ],
  );
});

test("mergeById produces a stable id-sorted order regardless of input order", () => {
  const a = mergeById([{ id: "z" }, { id: "a" }], [{ id: "m" }]);
  const b = mergeById([{ id: "a" }], [{ id: "m" }, { id: "z" }]);
  assert.deepEqual(a.map((r) => r.id), ["a", "m", "z"]);
  assert.deepEqual(b.map((r) => r.id), a.map((r) => r.id));
});

test("resolveSponsorHolding and resolveVoterHolding always return null — no Holding rows exist to resolve against", () => {
  assert.equal(resolveSponsorHolding({ name: "Someone", person: { id: "x" } }), null);
  assert.equal(resolveVoterHolding({ voter_name: "Someone" }, "2026-01-01"), null);
});

test("hashSnapshot is deterministic and distinguishes different payloads", () => {
  const a = { foo: "bar" };
  const b = { foo: "baz" };
  assert.equal(hashSnapshot(a), hashSnapshot(a));
  assert.notEqual(hashSnapshot(a), hashSnapshot(b));
});

test("compareTallies flags disagreement only when yes/no/other differ", () => {
  const base = { source: "openstates", yes: 2, no: 1, other: 0, url: null };
  assert.equal(compareTallies(base, { ...base, source: "legiscan" }), false);
  assert.equal(compareTallies(base, { ...base, source: "legiscan", yes: 3 }), true);
  assert.equal(compareTallies(base, { ...base, source: "legiscan", other: 1 }), true);
});

test("parseLegiscanRollCall maps LegiScan's yea/nay/nv/absent into VoteTally, folding nv+absent into other", () => {
  const tally = parseLegiscanRollCall({
    roll_call: { yea: 5, nay: 3, nv: 1, absent: 2, total: 11, url: "https://legiscan.com/x" },
  });
  assert.deepEqual(tally, { source: "legiscan", yes: 5, no: 3, other: 3, url: "https://legiscan.com/x" });
});

test("parseLegiscanRollCall throws on a response with no roll_call rather than guessing", () => {
  assert.throws(() => parseLegiscanRollCall({}), /roll_call/);
});

test("mapBillPage maps a fixture bill with a vote event into Bill + VoteEvent[] with holdings genuinely null", async () => {
  const fixture = await loadFixture();
  const rawBill = fixture.openStatesBillsPage.results.find((b) => b.identifier === "HF 4541");
  const { bill, voteEvents } = mapBillPage(rawBill, "2026-08-06T00:00:00.000Z");

  assert.equal(bill.identifier, "HF 4541");
  assert.equal(bill.schemaVersion, 1);
  assert.equal(bill.chamber, "house");
  assert.equal(bill.sponsors.length, 2);
  for (const sponsor of bill.sponsors) assert.equal(sponsor.holding, null);
  assert.equal(bill.provenance.sourceAgency, "Open States");
  assert.equal(bill.provenance.documentId, rawBill.id);
  assert.equal(bill.provenance.contentHash, hashSnapshot(rawBill));

  assert.equal(voteEvents.length, 1);
  const [voteEvent] = voteEvents;
  assert.equal(voteEvent.billId, bill.id);
  assert.equal(voteEvent.votes.length, 3);
  for (const vote of voteEvent.votes) {
    assert.ok("holding" in vote);
    assert.equal(vote.holding, null);
  }
  assert.equal(voteEvent.tallies[0].source, "openstates");
  assert.equal(voteEvent.tallies[0].yes, 2);
  assert.equal(voteEvent.tallies[0].no, 1);
});

test("mapBillPage leaves primarySourceUrl empty (never fabricated) for a bill with no sources or openstates_url", async () => {
  const fixture = await loadFixture();
  const rawBill = fixture.openStatesBillsPage.results.find((b) => b.identifier === "HF 1000");
  const { bill, voteEvents } = mapBillPage(rawBill, "2026-08-06T00:00:00.000Z");

  assert.equal(bill.provenance.primarySourceUrl, "");
  assert.deepEqual(bill.sources, []);
  assert.deepEqual(voteEvents, []);
});

test("mapBillPage maps a bill with no vote events to an empty VoteEvent[] array, not omitted or null", async () => {
  const fixture = await loadFixture();
  const rawBill = fixture.openStatesBillsPage.results.find((b) => b.identifier === "SF 3210");
  const { bill, voteEvents } = mapBillPage(rawBill, "2026-08-06T00:00:00.000Z");

  assert.equal(bill.chamber, "senate");
  assert.deepEqual(voteEvents, []);
});

test("crossCheckWithLegiscan with no LEGISCAN_API_KEY set returns the Open States tally alone and no disagreement", async () => {
  const openStatesTally = { source: "openstates", yes: 2, no: 1, other: 0, url: null };
  const result = await crossCheckWithLegiscan("HF 4541", { id: "v1", date: "2026-03-01" }, openStatesTally);
  assert.deepEqual(result, { tallies: [openStatesTally], tallyDisagreement: false });
});
