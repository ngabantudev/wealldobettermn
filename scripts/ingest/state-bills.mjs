#!/usr/bin/env node
// scripts/ingest/state-bills.mjs
//
// FEATURES.md "Phase 2 — State bills & roll-call votes". Writes
// public/state-bills.json (schema: Bill[]/VoteEvent[] — see
// src/lib/types.ts's "Phase 2" section) from Open States v3's /bills
// endpoint, which resolves votes and sponsorships inline. LegiScan is
// wired in as a cross-check on roll-call tallies only (see
// crossCheckWithLegiscan() below) — Open States remains the source of
// record for bill text, sponsors, and actions.
//
// STATUS: full parse/mapping implementation. Every TODO from the original
// scaffold is either implemented below or converted into an explicit,
// documented knownGaps entry — see each section for which. As of this
// commit the script has never been run against a live key in this
// environment (OPEN_STATES_API_KEY / LEGISCAN_API_KEY are both unset
// here), so public/state-bills.json still does not exist and
// src/lib/billsRegistry.ts's BILLS_INGEST_STATUS is still "scaffolded" —
// flipping both is a deliberate follow-up once a real run has been
// reviewed, not part of this change. See --self-test below for how this
// script's logic is verified without live network access.
//
// Required: OPEN_STATES_API_KEY (free key: https://open.pluralpolicy.com/accounts/signup/).
// Optional: LEGISCAN_API_KEY (free key: https://legiscan.com/legiscan) —
// only used for the tally cross-check; the script still runs Open-States-only
// without it, just with tallyDisagreement always false.
//
// Good-citizen fetching per AGENTS.md §2.2 / FEATURES.md Core principle 5:
// a descriptive User-Agent with a contact URL, conservative rate limits,
// and backoff on 429. This script performs no scraping of any
// credentialed or robots.txt-disallowed surface — both APIs used here are
// public, documented, keyed REST endpoints, not scraped HTML.
//
// --- Session backfill vs. delta polling (AGENTS.md §0.8 investigation) ---
//
// AGENTS.md §0.8 prefers bulk files over the keyed API. Open States'
// documented bulk path is https://openstates.org/data/session-csv/
// (redirects to open.pluralpolicy.com/data/session-csv/). Investigated
// 2026-08-06: that page requires an authenticated browser login
// ("Please log in to access download links" — every download link is
// `/accounts/login/?next=/data/session-csv/`) to reach the actual per-
// session CSV file URLs, which are never exposed to an unauthenticated or
// API-key-only request. Open States' own docs site
// (docs.openstates.org — Introduction/API v3/GraphQL(deprecated)/
// Contributing/Data/Enhancement Proposals) does not document a
// programmatic, API-key-based bulk endpoint anywhere in its "Data"
// section either — the only bulk path Open States documents is the
// browser-login CSV page.
//
//   knownGaps: full-session backfill from Open States' bulk CSV export is
//   not implemented. It requires an authenticated account browser
//   session (not the same credential as OPEN_STATES_API_KEY, and not
//   automatable headlessly without scraping a login form, which AGENTS.md
//   §2.2 "no credentialed-portal automation" forbids outright), so it
//   cannot be built without a human manually downloading the CSV export
//   through the browser and committing it — a separate, manual workflow,
//   not something this script can do. `--backfill` below instead pages
//   fully through the keyed /bills endpoint for one session (no
//   `updated_since` bound), which is slower and heavier than a bulk file
//   would be but is the only backfill mechanism actually available
//   without credentials. Revisit if Open States ever publishes a keyed or
//   public-bucket bulk path.
//
// Delta polling (no --backfill) uses `updated_since` against the same
// keyed endpoint and is the intended path for a scheduled recurring run.

import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "../../public/state-bills.json");
const SNAPSHOT_DIR = path.join(__dirname, "../../data/snapshots/state-bills");
const FIXTURE_PATH = path.join(__dirname, "../fixtures/state-bills-sample.json");

const USER_AGENT = "wealldobettermn-etl/0.1 (github.com/ngabantudev/wealldobettermn)";

const SELF_TEST = process.argv.includes("--self-test");
const BACKFILL = process.argv.includes("--backfill");

// True only when this file is the process's entry point (`node
// scripts/ingest/state-bills.mjs ...`), false when it's imported for its
// pure functions (scripts/ingest/state-bills.test.mjs). The API-key guard
// and the main()/self-test dispatch below are both side-effecting
// (process.exit, network calls) and must never fire just because this
// module was imported — otherwise importing it for its exported functions
// in a test would trip the "no key" exit before any test ran.
const IS_MAIN = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

const OPEN_STATES_API_KEY = process.env.OPEN_STATES_API_KEY;
const LEGISCAN_API_KEY = process.env.LEGISCAN_API_KEY; // optional — cross-check only

// AGENTS.md §0.8/§3.2: an API is a refresh mechanism, not a runtime
// dependency. A missing key is a clean, documented exit — never a crashed
// build and never a reason to fabricate output. §3.1 forbids placeholder
// data shipping as fact, so there is no fallback path here that writes
// public/state-bills.json without real upstream data behind it.
if (IS_MAIN && !SELF_TEST && !OPEN_STATES_API_KEY) {
  console.error("[state-bills] OPEN_STATES_API_KEY is not set — skipping this ingest run.");
  console.error("[state-bills] Get a free key at https://open.pluralpolicy.com/accounts/signup/");
  console.error("[state-bills] No output was written; public/state-bills.json is left untouched.");
  console.error("[state-bills] Run with --self-test to exercise this script's logic against a fixture instead.");
  process.exit(0);
}

const OPEN_STATES_BASE = "https://v3.openstates.org";
const LEGISCAN_BASE = "https://api.legiscan.com/";
const MN_JURISDICTION = "Minnesota";
const LICENCE = "Open States data is available under a CC BY-SA 4.0-equivalent open license; see https://docs.openstates.org/en/latest/api/index.html";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Same retry-with-backoff shape as scripts/fetch-state-legislature.mjs's
// fetchJson — free-tier Open States keys rate-limit tightly enough that a
// naive loop trips them. Reused for LegiScan calls too (AGENTS.md §2.2
// "good-citizen fetching" applies to both upstreams, not just the primary
// one).
async function fetchJson(url, headers = {}, attempt = 1) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers } });
  if (res.status === 429 && attempt <= 5) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 2000;
    console.log(`[state-bills] rate limited, waiting ${Math.round(delayMs / 1000)}s (attempt ${attempt})...`);
    await sleep(delayMs);
    return fetchJson(url, headers, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function openStatesFetch(pathAndQuery) {
  return fetchJson(`${OPEN_STATES_BASE}${pathAndQuery}`, { "X-API-KEY": OPEN_STATES_API_KEY });
}

function legiscanFetch(params) {
  const qs = new URLSearchParams({ key: LEGISCAN_API_KEY, ...params });
  return fetchJson(`${LEGISCAN_BASE}?${qs.toString()}`);
}

// Open States v3's `include` param must appear once per field
// (`include=votes&include=sponsorships&...`), not as one comma-joined
// value — live-verified 2026-08-06: a single `include=votes,sponsorships,
// actions,sources` value 422s ("value is not a valid enumeration member"),
// because the API parses each `include` occurrence as one enum member, not
// a delimited list. Caught by an actual live run against the real API; the
// fixture-driven self-test/unit tests never exercised query construction,
// only the response-parsing side, so this shipped without either test
// catching it.
const BILL_INCLUDE_FIELDS = ["votes", "sponsorships", "actions", "sources"];

// Delta-polling entry point: Open States' /bills supports `updated_since`
// so a scheduled run only pulls what changed rather than re-fetching a
// whole session. `include=votes&include=sponsorships&...` resolves all
// four inline in one call, per FEATURES.md's "votes/sponsorships resolved
// inline."
export function buildBillsQuery({ updatedSince, page, session }) {
  const params = new URLSearchParams({
    jurisdiction: MN_JURISDICTION,
    sort: "updated_desc",
    page: String(page),
    per_page: "20",
  });
  for (const field of BILL_INCLUDE_FIELDS) params.append("include", field);
  if (updatedSince) params.set("updated_since", updatedSince);
  if (session) params.set("session", session);
  return `/bills?${params.toString()}`;
}

// Full-session backfill: pages through every result with no
// `updated_since` bound, for one session. See the module header's
// investigation note — this is the fallback path in the absence of an
// automatable bulk CSV download, not a full replacement for one.
async function fetchAllBillPages({ session } = {}) {
  const results = [];
  for (let page = 1; ; page++) {
    if (page > 1) await sleep(500); // spread requests out, on top of fetchJson's own 429 backoff
    const data = await openStatesFetch(buildBillsQuery({ page, session }));
    results.push(...(data.results ?? []));
    console.log(`[state-bills] backfill page ${page}/${data.pagination?.max_page ?? "?"}: ${data.results?.length ?? 0} bill(s)`);
    if (!data.pagination || page >= data.pagination.max_page) break;
  }
  return results;
}

// AGENTS.md §2.2 "Snapshot, Don't Overwrite" — raw upstream payloads are
// written to disk before any parsing happens, so a schema change or a bug
// in the parser below never loses the original response. Snapshot files
// are content, not code: gitignored by data/snapshots (matches this repo's
// existing convention for other large fetched payloads) and regenerated
// on each run, dated by fetch time only — never used as an input to the
// parsed output itself (AGENTS.md §2.2 "Deterministic and Re-runnable").
async function snapshotRaw(name, payload) {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  const fetchedAt = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotPath = path.join(SNAPSHOT_DIR, `${name}-${fetchedAt}.json`);
  await writeFile(snapshotPath, JSON.stringify(payload, null, 2));
  return snapshotPath;
}

// --- Pure transform functions (self-test / node --test covered) ----------

// AGENTS.md §2.2 provenance record's contentHash: a stable sha256 of the
// exact raw upstream payload for one bill, so a downstream consumer can
// detect if the source record behind a Bill changed without re-fetching
// it themselves.
export function hashSnapshot(rawPayload) {
  return createHash("sha256").update(JSON.stringify(rawPayload)).digest("hex");
}

// TODO(phase2, tracked not silently worked around — see module header and
// AGENTS.md §3.3 "Missing Sources"): resolve an Open States sponsorship's
// `name` (and, where present, `person.id`) against this repo's officeholder
// data to produce a HoldingRef — see src/lib/types.ts's BillSponsor.holding.
// No `Holding` row is ever constructed anywhere in this codebase for state
// legislators (models.ts's Holding has zero consumers as of this writing),
// so there is nothing to resolve against yet; any non-null value returned
// here today would be fabricated. Returns null (unresolved) until a real
// holding index exists to join against. An unresolved sponsor is still
// recorded by name, never dropped.
export function resolveSponsorHolding(_sponsorship) {
  return null;
}

// TODO(phase2): resolve an Open States vote's `voter_name` + the vote
// event's `start_date` to a HoldingRef via (person, date) — the join
// FEATURES.md specifies ("attach votes to `holding`, not `person` —
// resolve by (person, date)"). Same "no Holding rows exist yet" blocker as
// resolveSponsorHolding above — returns null until this repo has a
// `holding` entity and a person→holding-by-date index to join against.
export function resolveVoterHolding(_vote, _voteEventDate) {
  return null;
}

function mapSponsor(sponsorship) {
  return {
    name: sponsorship.name,
    classification: sponsorship.classification ?? null,
    holding: resolveSponsorHolding(sponsorship),
  };
}

function mapAction(action) {
  return {
    date: action.date,
    description: action.description,
    classification: Array.isArray(action.classification) ? action.classification : [],
  };
}

function mapExternalSource(source, provider) {
  return {
    provider,
    id: source.url ?? source.id ?? "",
    url: source.url ?? null,
  };
}

const VOTE_OPTION_MAP = {
  yes: "yes",
  no: "no",
  other: "other",
  absent: "absent",
  excused: "excused",
  "not voting": "not voting",
};

// Open States reports an unrecognized option ("other" catch-all covers
// most of these already) — never guessed at, mapped to "other" only when
// it's genuinely one of Open States' own non-yes/no categories, and passed
// through as-is otherwise so a truly novel value is still visible rather
// than silently dropped.
function mapVoteOption(rawOption) {
  const normalized = String(rawOption ?? "").trim().toLowerCase();
  return VOTE_OPTION_MAP[normalized] ?? "other";
}

function mapVote(rawVote, voteEventDate) {
  return {
    // Genuinely null, not a fabricated placeholder id — see the Vote.holding
    // comment in src/lib/types.ts and resolveVoterHolding() above for why.
    holding: resolveVoterHolding(rawVote, voteEventDate),
    option: mapVoteOption(rawVote.option),
  };
}

// Open States' own `counts` array (list of {option, value}) becomes this
// repo's VoteTally shape. Missing counts default to 0 rather than being
// omitted, so every VoteTally always carries the same three fields.
function openStatesTally(rawVoteEvent, sourceUrl) {
  const counts = new Map((rawVoteEvent.counts ?? []).map((c) => [c.option, c.value]));
  return {
    source: "openstates",
    yes: counts.get("yes") ?? 0,
    no: counts.get("no") ?? 0,
    other: [...counts.entries()].filter(([opt]) => opt !== "yes" && opt !== "no").reduce((sum, [, v]) => sum + v, 0),
    url: sourceUrl,
  };
}

// Given a LegiScan getRollCall response's `roll_call` object, produce a
// VoteTally with source: "legiscan". LegiScan's own fields are
// yea/nay/nv (not voting)/absent — nv and absent are both folded into this
// repo's single `other` bucket, since VoteTally doesn't distinguish them
// (matching the same collapse openStatesTally() does above for any
// non-yes/no Open States option).
export function parseLegiscanRollCall(rollCallResponse) {
  const rc = rollCallResponse.roll_call;
  if (!rc) throw new Error("LegiScan getRollCall response missing roll_call");
  return {
    source: "legiscan",
    yes: rc.yea ?? 0,
    no: rc.nay ?? 0,
    other: (rc.nv ?? 0) + (rc.absent ?? 0),
    url: rc.url ?? null,
  };
}

// Pure comparison: given two VoteTally objects for the same vote event, do
// they disagree? Per FEATURES.md: "Where Open States and LegiScan disagree
// on a tally, store both and flag; never silently pick one." This function
// only answers the yes/no question — it never resolves which is correct.
export function compareTallies(a, b) {
  return a.yes !== b.yes || a.no !== b.no || a.other !== b.other;
}

// LegiScan cross-check: given an already-mapped VoteEvent (bill identifier
// + date needed to locate the matching LegiScan roll call) and the raw
// Open States tally already computed for it, looks up LegiScan's own tally
// for the same vote and returns the extra tallies/disagreement fields to
// merge onto the VoteEvent.
//
// LegiScan has no direct "look up by Open States vote id" endpoint, so
// locating the matching roll call is a real two-hop hierarchy per
// LegiScan's own documented API (https://legiscan.com/gaits/documentation/legiscan):
//   1. getSearch (state=MN, bill=<identifier>) — text/number search,
//      returns LegiScan's own internal bill_id for a matching bill.
//   2. getBill (id=<bill_id>) — returns bill detail including a `votes[]`
//      array of {roll_call_id, date, ...}; matched to this vote event by
//      date (LegiScan and Open States report the same calendar date for
//      the same floor action).
//   3. getRollCall (id=<roll_call_id>) — the actual yea/nay/nv/absent
//      tally, parsed by parseLegiscanRollCall() above.
// A miss at any hop (no matching bill, no matching date) is treated as
// "no cross-check available for this vote," not an error — LegiScan's MN
// coverage and Open States' aren't guaranteed to line up 1:1 on every
// bill, and a missing cross-check is not itself a tally disagreement.
export async function crossCheckWithLegiscan(billIdentifier, voteEvent, openStatesVoteTally) {
  if (!LEGISCAN_API_KEY) {
    return { tallies: [openStatesVoteTally], tallyDisagreement: false };
  }
  try {
    const searchRes = await legiscanFetch({ op: "getSearch", state: "MN", bill: billIdentifier });
    const searchResults = searchRes?.searchresult ? Object.values(searchRes.searchresult).filter((r) => r?.bill_id) : [];
    const billId = searchResults[0]?.bill_id;
    if (!billId) {
      console.log(`[state-bills] LegiScan: no matching bill found for ${billIdentifier}, skipping cross-check.`);
      return { tallies: [openStatesVoteTally], tallyDisagreement: false };
    }

    await sleep(250);
    const billRes = await legiscanFetch({ op: "getBill", id: String(billId) });
    const rollCallId = (billRes?.bill?.votes ?? []).find((v) => v.date === voteEvent.date)?.roll_call_id;
    if (!rollCallId) {
      console.log(`[state-bills] LegiScan: no roll call on ${voteEvent.date} for ${billIdentifier}, skipping cross-check.`);
      return { tallies: [openStatesVoteTally], tallyDisagreement: false };
    }

    await sleep(250);
    const rollCallRes = await legiscanFetch({ op: "getRollCall", id: String(rollCallId) });
    const legiscanTally = parseLegiscanRollCall(rollCallRes);
    const disagreement = compareTallies(openStatesVoteTally, legiscanTally);
    if (disagreement) {
      console.warn(`[state-bills] tally disagreement on ${billIdentifier} vote ${voteEvent.id}: Open States vs. LegiScan differ.`);
    }
    return { tallies: [openStatesVoteTally, legiscanTally], tallyDisagreement: disagreement };
  } catch (err) {
    // A failed cross-check call is a refresh-mechanism failure for this one
    // vote, not a reason to fail the whole ingest run — the Open States
    // tally alone is still a complete, sourced record without it.
    console.warn(`[state-bills] LegiScan cross-check failed for ${billIdentifier}: ${err.message}`);
    return { tallies: [openStatesVoteTally], tallyDisagreement: false };
  }
}

function mapVoteEvent(rawVoteEvent, billId, fetchedAt) {
  const primarySource = rawVoteEvent.sources?.[0]?.url ?? null;
  return {
    id: rawVoteEvent.id,
    billId,
    identifier: rawVoteEvent.identifier ?? "",
    motion: rawVoteEvent.motion_text ?? "",
    date: rawVoteEvent.start_date,
    result: rawVoteEvent.result ?? "unknown",
    chamber: rawVoteEvent.organization?.classification === "upper" ? "senate" : rawVoteEvent.organization?.classification === "lower" ? "house" : null,
    votes: (rawVoteEvent.votes ?? []).map((v) => mapVote(v, rawVoteEvent.start_date)),
    tallies: [openStatesTally(rawVoteEvent, primarySource)],
    tallyDisagreement: false,
    sources: (rawVoteEvent.sources ?? []).map((s) => mapExternalSource(s, "openstates")),
    provenance: {
      primarySourceUrl: primarySource ?? "",
      sourceAgency: "Open States",
      documentType: "roll-call-vote",
      documentId: rawVoteEvent.id,
      issuedDate: rawVoteEvent.start_date ?? null,
      fetchedAt,
      licence: LICENCE,
      contentHash: hashSnapshot(rawVoteEvent),
    },
  };
}

// Maps one Open States /bills result (with votes/sponsorships/actions/
// sources already resolved inline via `include=`) into this repo's Bill +
// VoteEvent[] shapes. Returns both because a Bill's vote events are
// written as separate top-level records (VoteEvent.billId is the join
// key), matching src/lib/types.ts's normalized-but-flat design.
export function mapBillPage(rawBill, fetchedAt) {
  const primarySource = rawBill.sources?.[0]?.url ?? rawBill.openstates_url ?? "";
  const bill = {
    schemaVersion: 1,
    id: rawBill.id,
    identifier: rawBill.identifier,
    session: rawBill.session,
    title: rawBill.title,
    chamber: rawBill.from_organization?.classification === "upper" ? "senate" : rawBill.from_organization?.classification === "lower" ? "house" : null,
    sponsors: (rawBill.sponsorships ?? []).map(mapSponsor),
    actions: (rawBill.actions ?? []).map(mapAction),
    status: rawBill.latest_action_description ?? "Unknown",
    sources: (rawBill.sources ?? []).map((s) => mapExternalSource(s, "openstates")),
    provenance: {
      primarySourceUrl: primarySource,
      sourceAgency: "Open States",
      documentType: "bill",
      documentId: rawBill.id,
      issuedDate: rawBill.actions?.[0]?.date ?? null,
      fetchedAt,
      licence: LICENCE,
      contentHash: hashSnapshot(rawBill),
    },
  };
  const voteEvents = (rawBill.votes ?? []).map((v) => mapVoteEvent(v, rawBill.id, fetchedAt));
  return { bill, voteEvents };
}

// Applies the LegiScan cross-check to every vote event produced by
// mapBillPage() above, mutating each VoteEvent's tallies/tallyDisagreement
// in place (the Open States-only tally already set by mapVoteEvent is
// replaced with the cross-checked result, which always includes it as the
// first entry regardless of whether LegiScan agreed, disagreed, or
// couldn't be matched).
async function applyLegiscanCrossCheck(billIdentifier, voteEvents) {
  for (const voteEvent of voteEvents) {
    const openStatesOnly = voteEvent.tallies[0];
    const { tallies, tallyDisagreement } = await crossCheckWithLegiscan(billIdentifier, voteEvent, openStatesOnly);
    voteEvent.tallies = tallies;
    voteEvent.tallyDisagreement = tallyDisagreement;
  }
}

async function main() {
  const fetchedAt = new Date().toISOString();
  let rawBills;

  if (BACKFILL) {
    console.log("[state-bills] --backfill: paging the full current session from Open States v3 (see module header for why this isn't a bulk-file download)...");
    rawBills = await fetchAllBillPages({});
  } else {
    console.log("[state-bills] delta poll: fetching first page of recently-updated MN bills from Open States v3...");
    const page = await openStatesFetch(buildBillsQuery({ page: 1 }));
    rawBills = page.results ?? [];
  }

  const snapshotPath = await snapshotRaw(BACKFILL ? "bills-backfill" : "bills-delta", rawBills);
  console.log(`[state-bills] snapshotted ${rawBills.length} raw bill record(s) to ${snapshotPath}`);

  const bills = [];
  const voteEvents = [];
  for (const rawBill of rawBills) {
    const { bill, voteEvents: mappedVoteEvents } = mapBillPage(rawBill, fetchedAt);
    await applyLegiscanCrossCheck(bill.identifier, mappedVoteEvents);
    bills.push(bill);
    voteEvents.push(...mappedVoteEvents);
  }

  const disagreements = voteEvents.filter((v) => v.tallyDisagreement).length;
  console.log(`[state-bills] parsed ${bills.length} bill(s), ${voteEvents.length} vote event(s), ${disagreements} tally disagreement(s).`);

  const output = { schemaVersion: 1, generatedAt: fetchedAt, bills, voteEvents };
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`[done] wrote ${bills.length} bill(s) and ${voteEvents.length} vote event(s) to ${OUTPUT_PATH}`);
}

// --self-test: exercises mapBillPage/mapVoteEvent/parseLegiscanRollCall/
// compareTallies/hashSnapshot against scripts/fixtures/state-bills-sample.json
// — a small, clearly-labeled, non-production fixture — instead of the live
// Open States/LegiScan APIs. Never writes to public/, never touches
// OUTPUT_PATH, never presents its fixture output as real bill or vote
// data. This is the fixture-driven test path for a build/CI environment
// where neither upstream key nor network access is available. See also
// scripts/ingest/state-bills.test.mjs for the same functions exercised via
// `node --test`, matching this repo's scripts/ingest/*.test.mjs
// convention (e.g. roster-diff.test.mjs).
async function runSelfTest() {
  console.log(`[self-test] loading fixture from ${FIXTURE_PATH}`);
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  if (fixture.synthetic !== true) {
    throw new Error("[self-test] fixture is missing its required `synthetic: true` marker — refusing to use it.");
  }

  const fetchedAt = "2026-08-06T00:00:00.000Z";
  const rawBills = fixture.openStatesBillsPage.results;
  const mapped = rawBills.map((rb) => mapBillPage(rb, fetchedAt));

  const withVote = mapped.find((m) => m.voteEvents.length > 0);
  if (!withVote) throw new Error("[self-test] expected at least one fixture bill with a vote event.");
  const voteEvent = withVote.voteEvents[0];

  if (voteEvent.votes.length !== 3) {
    throw new Error(`[self-test] expected 3 votes on the fixture roll call, got ${voteEvent.votes.length}`);
  }
  if (voteEvent.votes.some((v) => !("holding" in v))) {
    throw new Error("[self-test] every Vote must carry a holding field (present, even though genuinely unresolved).");
  }
  if (voteEvent.votes.some((v) => v.holding !== null)) {
    throw new Error("[self-test] resolveVoterHolding must return null — no Holding rows exist to resolve against yet.");
  }
  if (withVote.bill.sponsors.some((s) => s.holding !== null)) {
    throw new Error("[self-test] resolveSponsorHolding must return null — no Holding rows exist to resolve against yet.");
  }
  if (voteEvent.tallies[0].yes !== 2 || voteEvent.tallies[0].no !== 1) {
    throw new Error("[self-test] Open States tally mapped incorrectly from fixture counts.");
  }

  const noSourceBill = mapped.find((m) => m.bill.identifier === "HF 1000");
  if (!noSourceBill || noSourceBill.bill.provenance.primarySourceUrl !== "") {
    throw new Error("[self-test] a bill with no sources/openstates_url should get an empty (never fabricated) primarySourceUrl.");
  }

  // contentHash: deterministic, and changes when the underlying payload changes.
  const h1 = hashSnapshot(rawBills[0]);
  const h2 = hashSnapshot(rawBills[0]);
  if (h1 !== h2) throw new Error("[self-test] hashSnapshot is not deterministic.");
  if (h1 === hashSnapshot(rawBills[1])) throw new Error("[self-test] hashSnapshot collided on two different bills.");

  // LegiScan tally parsing + comparison, entirely offline.
  const openStatesTallyForVote = voteEvent.tallies[0];
  const agreeingTally = parseLegiscanRollCall(fixture.legiscanRollCallAgree);
  const disagreeingTally = parseLegiscanRollCall(fixture.legiscanRollCallDisagree);
  if (compareTallies(openStatesTallyForVote, agreeingTally) !== false) {
    throw new Error("[self-test] compareTallies should not flag disagreement on matching tallies.");
  }
  if (compareTallies(openStatesTallyForVote, disagreeingTally) !== true) {
    throw new Error("[self-test] compareTallies should flag disagreement on differing tallies.");
  }

  console.log(
    `[self-test] PASS — mapped ${mapped.length} fixture bill(s) and ${withVote.voteEvents.length} vote event(s) on ${withVote.bill.identifier}, ` +
      "holding resolution correctly stays null, contentHash is deterministic and collision-free across fixture bills, " +
      "LegiScan tally comparison correctly agrees/disagrees against fixture roll calls.",
  );
}

// Gated on IS_MAIN — see its definition above — so importing this module
// for its exported pure functions (state-bills.test.mjs) never triggers a
// live run, a self-test run, or a process.exit as a side effect of import.
if (IS_MAIN) {
  if (SELF_TEST) {
    runSelfTest().catch((err) => {
      console.error("[fatal]", err);
      process.exit(1);
    });
  } else {
    main().catch((err) => {
      // A failed upstream fetch is a refresh-mechanism failure, not a build
      // failure (AGENTS.md §0.8) — log loudly, but exit non-fatally to a
      // manual-workflow signal rather than crashing whatever invoked this
      // script. (`data:` scripts are run standalone, not during `npm run
      // build`, so this does not block the app build itself either way.)
      console.error("[state-bills] ingest run failed:", err.message);
      process.exit(1);
    });
  }
}
