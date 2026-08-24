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
//   through the keyed /bills endpoint, which is slower and heavier than a
//   bulk file would be but is the only backfill mechanism actually
//   available without credentials. Revisit if Open States ever publishes
//   a keyed or public-bucket bulk path.
//
// --- Caching / quota protection (added 2026-08-06, after the first live
// run against a real free-tier key — 500 req/day, 1 req/sec — surfaced
// that none of this existed) ---
//
// Neither mode makes an unbounded number of live requests. Both are
// capped (MAX_BACKFILL_REQUESTS / MAX_DELTA_POLL_REQUESTS below) and a
// capped run is recorded honestly in the written output's `knownGaps`,
// never silently truncated. public/state-bills.json is merged into, not
// overwritten (mergeById below) — a bill or vote event this run didn't
// touch stays exactly as a prior run left it, so repeated cheap runs
// actually accumulate coverage instead of replacing the same snapshot.
//
// Delta polling (no --backfill) persists `lastDeltaPollAt` in the output
// and passes it as `updated_since` on the next run — genuinely
// incremental, not just "fetch the top page again" — and still paginates
// (capped) so an unusually large batch of same-day updates isn't silently
// truncated to one page. The watermark only advances past a run's fetch
// time when that run wasn't itself capped; a capped delta poll re-polls
// from the same watermark next time rather than skipping bills it never
// saw.
//
// `--backfill` uses Open States' `first_action_asc` sort (confirmed via
// the API's own 422 enum-validation error, 2026-08-06 — the only stable
// sort order among the six it documents: introduction order doesn't
// reshuffle as bills get updated later, unlike `updated_desc`). A capped
// backfill run persists `backfill.nextPage` in the output and resumes
// from there on the next `--backfill` invocation, so a full session gets
// covered across several safely-capped runs instead of one large one.

import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { fetchJson } from "../lib/fetchJson.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "../../public/state-bills.json");
const SNAPSHOT_DIR = path.join(__dirname, "../../data/snapshots/state-bills");
const FIXTURE_PATH = path.join(__dirname, "../fixtures/state-bills-sample.json");

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

// Confirmed live 2026-08-06 against Open States' own
// GET /jurisdictions/ocd-jurisdiction/country:us/state:mn/government
// ?include=legislative_sessions response: the identifier for MN's current
// regular session. MUST be updated by hand each new biennium (next
// expected: "2027-2028", ~January 2027) — same manual-maintenance posture
// as electionConfig.ts's MN_STATE_GENERAL_ELECTION_DATE. Critical for
// --backfill: without a session filter, `jurisdiction=Minnesota` alone
// returns Open States' entire MN corpus back to at least 2009-2010 —
// live-verified as 57,791 bills / 28,896 pages as of this writing.
// first_action_asc-sorted, unscoped, that would spend the entire request
// budget crawling forward from 2009 for hundreds of runs before ever
// reaching a current bill. Also applied to delta polling for the same
// correctness reason (in practice `updated_desc` alone already stayed
// within the current session — verified against a live run — but scoping
// explicitly removes the "in practice" caveat). Does not cover a
// concurrent special session (e.g. "2025s1") — a real, intentional gap,
// not silently expanded scope; see the knownGaps entry in main().
const MN_CURRENT_SESSION = "2025-2026";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function openStatesFetch(pathAndQuery) {
  return fetchJson(`${OPEN_STATES_BASE}${pathAndQuery}`, {
    headers: { "X-API-KEY": OPEN_STATES_API_KEY },
    logLabel: "state-bills",
  });
}

function legiscanFetch(params) {
  const qs = new URLSearchParams({ key: LEGISCAN_API_KEY, ...params });
  return fetchJson(`${LEGISCAN_BASE}?${qs.toString()}`, { logLabel: "state-bills" });
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

// Hard request-count circuit breakers, so neither delta-poll nor
// --backfill can silently consume a meaningful fraction of a free-tier
// key's daily quota (500 req/day on Open States' default/new-user tier)
// in a single run — see the module header's "Caching / quota protection"
// note. Deliberately conservative, leaving headroom for same-day LegiScan
// cross-check calls and manual re-runs. A capped run is not a failure:
// it's recorded in the written output's knownGaps and the next run of the
// same mode picks up where this one left off (mergeById below for delta
// polling's accumulation, `backfill.nextPage` for backfill's resume
// point).
const MAX_BACKFILL_REQUESTS = 40; // 40 pages * 20/page = up to 800 bills/run
const MAX_DELTA_POLL_REQUESTS = 5; // up to 100 bills/run — enough headroom for a normal update burst between polls, capped against an unusual one

// Delta-polling entry point: Open States' /bills supports `updated_since`
// so a scheduled run only pulls what changed rather than re-fetching a
// whole session. `include=votes&include=sponsorships&...` resolves all
// four inline in one call, per FEATURES.md's "votes/sponsorships resolved
// inline." `sort` defaults to `updated_desc` (delta polling's natural
// order) but --backfill passes `first_action_asc` instead — see the
// module header note on why a stable sort matters for resumable paging.
export function buildBillsQuery({ updatedSince, page, session, sort = "updated_desc" }) {
  const params = new URLSearchParams({
    jurisdiction: MN_JURISDICTION,
    sort,
    page: String(page),
    per_page: "20",
  });
  for (const field of BILL_INCLUDE_FIELDS) params.append("include", field);
  if (updatedSince) params.set("updated_since", updatedSince);
  if (session) params.set("session", session);
  return `/bills?${params.toString()}`;
}

// Spacing between our own consecutive requests, on top of fetchJson's own
// 429 backoff. Live-verified 2026-08-06: 500ms (2 req/sec) was well over
// this key's actual "1 requests/sec" free-tier limit and triggered
// repeated 429s that exhausted fetchJson's own retry budget outright; even
// 1100ms (which is already >1 req/sec of margin measured request-start to
// request-start) still hit 429 twice across a 40-request run. The real
// enforcement appears tighter in practice than the stated limit — 1500ms
// trades some run duration for meaningfully fewer wasted, failed requests
// (a 429 still likely counts against the daily quota) without needing to
// keep re-tuning this by trial and error.
const REQUEST_SPACING_MS = 1500;

// Shared paginator for both modes: starts at `startPage`, stops when
// Open States reports no more pages (a genuinely completed pass —
// `nextPage: null`), when `maxRequests` is hit first (a capped stop), or
// when a request fails after exhausting fetchJson's own retries (treated
// the same as a capped stop, not a lost run — see below). Either kind of
// stop returns `nextPage` for the next call of this mode to resume from,
// and is recorded in the returned `gaps`, never silently swallowed.
async function fetchBillPages({ session, sort, updatedSince, startPage = 1, maxRequests, label }) {
  const results = [];
  const gaps = [];
  let page = startPage;
  let maxPage = null;

  for (let requestCount = 0; ; requestCount++) {
    if (requestCount >= maxRequests) {
      gaps.push(
        `${label}: stopped after ${requestCount} request(s) this run (page ${startPage}-${page - 1}, ${results.length} ` +
          `bill(s) fetched) to stay within a good-citizen request budget (AGENTS.md §2.2) and protect the free-tier ` +
          `daily quota.${maxPage ? ` ${maxPage - page + 1} page(s) remain.` : ""} Run again to continue — already-` +
          "fetched bills are preserved (merged, not overwritten).",
      );
      return { results, nextPage: page, gaps };
    }
    if (requestCount > 0) await sleep(REQUEST_SPACING_MS);

    let data;
    try {
      data = await openStatesFetch(buildBillsQuery({ page, session, sort, updatedSince }));
    } catch (err) {
      // A request failure mid-pagination (rate-limit retries exhausted,
      // network blip) must not throw away everything already fetched this
      // run — that would waste real API budget for nothing. Treated as a
      // capped stop at the failed page: already-fetched pages are still
      // returned (and get merged/persisted by main()), and the next run
      // resumes here rather than redoing them or losing the cursor.
      gaps.push(
        `${label}: stopped at page ${page} after a request failure (${err.message}) — ${results.length} bill(s) ` +
          `fetched and preserved this run (merged, not overwritten). Run again to resume from page ${page}.`,
      );
      return { results, nextPage: page, gaps };
    }
    maxPage = data.pagination?.max_page ?? null;
    results.push(...(data.results ?? []));
    console.log(`[state-bills] ${label} page ${page}/${maxPage ?? "?"}: ${data.results?.length ?? 0} bill(s)`);
    if (!data.pagination || page >= data.pagination.max_page) {
      return { results, nextPage: null, gaps }; // full pass complete, not just capped
    }
    page += 1;
  }
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

// Upserts freshly-fetched records into the previously-committed set by
// `id` — a record already in public/state-bills.json that this run didn't
// touch is preserved exactly as-is; a record this run did fetch replaces
// its prior version (the new fetch is definitionally more current, per
// its own newer provenance.fetchedAt). This is what makes repeated,
// individually-cheap delta-poll runs actually accumulate coverage instead
// of each one replacing the last. Sorted by id on the way out so an
// unchanged re-run produces a stable diff, not reordering noise.
export function mergeById(existing, fresh) {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of fresh) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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

// Reads the previously-committed public/state-bills.json, if any — the
// starting point for this run's merge, and the source of the delta-poll
// watermark / backfill resume cursor. A missing or unparseable file means
// this is the first run ever; that's a normal starting state, not an
// error, so it returns the same empty shape a corrupt file would rather
// than throwing.
async function loadExistingOutput() {
  try {
    const raw = await readFile(OUTPUT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      lastDeltaPollAt: typeof parsed.lastDeltaPollAt === "string" ? parsed.lastDeltaPollAt : null,
      backfillNextPage: typeof parsed.backfill?.nextPage === "number" ? parsed.backfill.nextPage : 1,
      backfillLastCompletedAt: typeof parsed.backfill?.lastCompletedAt === "string" ? parsed.backfill.lastCompletedAt : null,
      bills: Array.isArray(parsed.bills) ? parsed.bills : [],
      voteEvents: Array.isArray(parsed.voteEvents) ? parsed.voteEvents : [],
    };
  } catch {
    return { lastDeltaPollAt: null, backfillNextPage: 1, backfillLastCompletedAt: null, bills: [], voteEvents: [] };
  }
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const existing = await loadExistingOutput();

  let rawBills;
  let nextBackfillPage = existing.backfillNextPage;
  let backfillCompletedThisRun = false;
  let advanceLastDeltaPollAt = false;
  const runGaps = [];

  if (BACKFILL) {
    console.log(
      `[state-bills] --backfill: resuming from page ${existing.backfillNextPage} (stable sort: first_action_asc — ` +
        "see module header for why this isn't a bulk-file download)...",
    );
    const { results, nextPage, gaps } = await fetchBillPages({
      session: MN_CURRENT_SESSION,
      sort: "first_action_asc",
      startPage: existing.backfillNextPage,
      maxRequests: MAX_BACKFILL_REQUESTS,
      label: "backfill",
    });
    rawBills = results;
    runGaps.push(...gaps);
    runGaps.push(
      `Scoped to session ${MN_CURRENT_SESSION} only — a concurrent special session (e.g. "2025s1") is not included. ` +
        "See MN_CURRENT_SESSION's module comment.",
    );
    if (nextPage === null) {
      // A completed pass restarts from page 1 next time (to pick up
      // brand-new bills introduced since), and — since it just walked the
      // entire session as of now — also advances the delta-poll watermark,
      // the same as a non-capped delta poll would.
      nextBackfillPage = 1;
      backfillCompletedThisRun = true;
      advanceLastDeltaPollAt = true;
      console.log("[state-bills] backfill: full pass complete.");
    } else {
      nextBackfillPage = nextPage;
    }
  } else {
    console.log(
      existing.lastDeltaPollAt
        ? `[state-bills] delta poll: fetching MN bills updated since ${existing.lastDeltaPollAt}...`
        : "[state-bills] delta poll: no prior run recorded — fetching the most recently updated MN bills...",
    );
    const { results, nextPage, gaps } = await fetchBillPages({
      session: MN_CURRENT_SESSION,
      sort: "updated_desc",
      updatedSince: existing.lastDeltaPollAt ?? undefined,
      startPage: 1,
      maxRequests: MAX_DELTA_POLL_REQUESTS,
      label: "delta poll",
    });
    rawBills = results;
    runGaps.push(...gaps);
    // Only advance the watermark past this run's fetch time when the run
    // actually saw everything up to now (nextPage === null). A capped
    // delta poll may have missed bills beyond what it fetched this time,
    // so the next run re-polls from the same watermark rather than
    // skipping ahead past updates it never saw.
    advanceLastDeltaPollAt = nextPage === null;
  }

  const snapshotPath = await snapshotRaw(BACKFILL ? "bills-backfill" : "bills-delta", rawBills);
  console.log(`[state-bills] snapshotted ${rawBills.length} raw bill record(s) to ${snapshotPath}`);

  const freshBills = [];
  const freshVoteEvents = [];
  for (const rawBill of rawBills) {
    const { bill, voteEvents: mappedVoteEvents } = mapBillPage(rawBill, fetchedAt);
    await applyLegiscanCrossCheck(bill.identifier, mappedVoteEvents);
    freshBills.push(bill);
    freshVoteEvents.push(...mappedVoteEvents);
  }

  const disagreements = freshVoteEvents.filter((v) => v.tallyDisagreement).length;
  console.log(
    `[state-bills] parsed ${freshBills.length} bill(s), ${freshVoteEvents.length} vote event(s) this run, ` +
      `${disagreements} tally disagreement(s).`,
  );

  const mergedBills = mergeById(existing.bills, freshBills);
  const mergedVoteEvents = mergeById(existing.voteEvents, freshVoteEvents);

  // Top-level output shape (no named TS interface — this file is the only
  // writer, src/app/bills/page.tsx the only reader, and it only reads
  // .bills — same "ad-hoc, not over-formalized" posture the previous
  // {schemaVersion, generatedAt, bills, voteEvents} shape already had):
  //   schemaVersion, generatedAt (this run's fetch time),
  //   lastDeltaPollAt (delta-poll watermark — see module header),
  //   backfill: { sort, nextPage, lastCompletedAt } (backfill resume
  //   cursor), bills, voteEvents (both accumulated via mergeById, never
  //   overwritten wholesale), knownGaps (this run's, not accumulated
  //   across runs — a capped-run gap stops being true once resumed).
  const output = {
    schemaVersion: 1,
    generatedAt: fetchedAt,
    lastDeltaPollAt: advanceLastDeltaPollAt ? fetchedAt : existing.lastDeltaPollAt,
    backfill: {
      sort: "first_action_asc",
      nextPage: nextBackfillPage,
      lastCompletedAt: backfillCompletedThisRun ? fetchedAt : existing.backfillLastCompletedAt,
    },
    bills: mergedBills,
    voteEvents: mergedVoteEvents,
    knownGaps: runGaps,
  };
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(
    `[done] wrote ${mergedBills.length} bill(s) total (${freshBills.length} new/updated this run) and ` +
      `${mergedVoteEvents.length} vote event(s) total (${freshVoteEvents.length} new/updated this run) to ${OUTPUT_PATH}`,
  );
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
