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
// SCAFFOLD STATUS: this is a skeleton per the Phase 2 scaffolding task.
// It fetches, snapshots, and parses Open States data into the shared
// schema; it does not yet page through a full session, resolve sponsors
// to a `holding` (no `holding` entity exists in this repo yet — see
// HoldingRef in src/lib/types.ts), or implement the LegiScan cross-check
// call itself (stubbed below with TODOs). It writes no output file, and
// no output file exists yet, until those are filled in and a real run has
// been reviewed — per AGENTS.md §3.1, an honest gap beats a partial or
// fabricated public/state-bills.json.
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

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "../../public/state-bills.json");
const SNAPSHOT_DIR = path.join(__dirname, "../../data/snapshots/state-bills");

const USER_AGENT = "wealldobettermn-etl/0.1 (github.com/ngabantudev/wealldobettermn)";

const OPEN_STATES_API_KEY = process.env.OPEN_STATES_API_KEY;
const LEGISCAN_API_KEY = process.env.LEGISCAN_API_KEY; // optional — cross-check only

// AGENTS.md §0.8/§3.2: an API is a refresh mechanism, not a runtime
// dependency. A missing key is a clean, documented exit — never a crashed
// build and never a reason to fabricate output. §3.1 forbids placeholder
// data shipping as fact, so there is no fallback path here that writes
// public/state-bills.json without real upstream data behind it.
if (!OPEN_STATES_API_KEY) {
  console.error("[state-bills] OPEN_STATES_API_KEY is not set — skipping this ingest run.");
  console.error("[state-bills] Get a free key at https://open.pluralpolicy.com/accounts/signup/");
  console.error("[state-bills] No output was written; public/state-bills.json is left untouched.");
  process.exit(0);
}

const OPEN_STATES_BASE = "https://v3.openstates.org";
const MN_JURISDICTION = "Minnesota";

// Bulk JSON/CSV per-session downloads (https://openstates.org/data/session-csv/)
// are the preferred path for a full-session backfill per AGENTS.md §0.8
// ("prefer bulk files over the keyed API") — the keyed /bills endpoint
// below is for delta polling via `updated_since`, not for backfilling an
// entire session from scratch. Backfill-from-bulk is not implemented in
// this scaffold; see TODO in main().
const BULK_DOWNLOADS_URL = "https://openstates.org/data/session-csv/";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Same retry-with-backoff shape as scripts/fetch-state-legislature.mjs's
// fetchJson — free-tier Open States keys rate-limit tightly enough that a
// naive loop trips them.
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

// Delta-polling entry point: Open States' /bills supports `updated_since`
// so a scheduled run only pulls what changed rather than re-fetching a
// whole session. `include=votes,sponsorships` resolves both inline in one
// call, per FEATURES.md's "votes/sponsorships resolved inline."
function buildBillsQuery({ updatedSince, page }) {
  const params = new URLSearchParams({
    jurisdiction: MN_JURISDICTION,
    sort: "updated_desc",
    include: "votes,sponsorships,actions,sources",
    page: String(page),
    per_page: "20",
  });
  if (updatedSince) params.set("updated_since", updatedSince);
  return `/bills?${params.toString()}`;
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

// TODO(phase2): resolve an Open States sponsorship's `name` (and, where
// present, `person.id`) against this repo's officeholder data to produce a
// HoldingRef — see src/lib/types.ts's BillSponsor.holding. Returns null
// (unresolved) until that join is implemented; an unresolved sponsor is
// still recorded by name, never dropped, per AGENTS.md §3.3 "Missing
// Sources" (leave the field null rather than guessing).
function resolveSponsorHolding(_sponsorship) {
  return null;
}

// TODO(phase2): resolve an Open States vote's `voter_name` + the vote
// event's `start_date` to a HoldingRef via (person, date) — the join
// FEATURES.md specifies ("attach votes to `holding`, not `person` —
// resolve by (person, date)"). Returns null (unresolved) until this
// repo has a `holding` entity and a person→holding-by-date index to
// join against.
function resolveVoterHolding(_vote, _voteEventDate) {
  return null;
}

// TODO(phase2): call LegiScan's getRollCall (https://legiscan.com/gaits/documentation/legiscan)
// for the matching MN roll call and compare its yea/nay/other counts
// against Open States' own tally on the same vote event. Per FEATURES.md:
// "Where Open States and LegiScan disagree on a tally, store both and
// flag; never silently pick one." When implemented, this should push a
// second VoteTally entry (source: "legiscan") onto VoteEvent.tallies and
// set tallyDisagreement = true iff the two tallies' yes/no/other counts
// differ — never resolve the disagreement here, only record it.
async function crossCheckWithLegiscan(_voteEvent) {
  if (!LEGISCAN_API_KEY) {
    return { tallies: [], tallyDisagreement: false };
  }
  console.log("[state-bills] LEGISCAN_API_KEY is set, but the cross-check call is not yet implemented (TODO).");
  return { tallies: [], tallyDisagreement: false };
}

async function main() {
  console.log("[state-bills] fetching first page of recently-updated MN bills from Open States v3...");

  // TODO(phase2): for a full-session backfill, download and parse the
  // relevant session's bulk JSON/CSV from BULK_DOWNLOADS_URL instead of
  // paging the keyed endpoint below — see the comment on
  // BULK_DOWNLOADS_URL above. The keyed call here is the delta-polling
  // path (`updated_since`), appropriate for a scheduled incremental
  // refresh, not for populating an empty dataset from scratch.
  const page = await openStatesFetch(buildBillsQuery({ page: 1 }));
  const snapshotPath = await snapshotRaw("bills-page-1", page);
  console.log(`[state-bills] snapshotted raw response to ${snapshotPath}`);

  // TODO(phase2): map page.results into Bill[] / VoteEvent[] per
  // src/lib/types.ts, calling resolveSponsorHolding / resolveVoterHolding
  // / crossCheckWithLegiscan for each bill and vote event, then write the
  // parsed result to OUTPUT_PATH with a provenance record per bill (see
  // Provenance in types.ts). Left unimplemented in this scaffold — see
  // module header. No partial or synthetic output is written in the
  // meantime, per AGENTS.md §3.1.
  console.log(
    `[state-bills] fetched ${Array.isArray(page.results) ? page.results.length : 0} bill(s) and snapshotted them.`
  );
  console.log("[state-bills] parsing into public/state-bills.json is not yet implemented — no output written.");
  console.log(`[state-bills] output path once implemented: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  // A failed upstream fetch is a refresh-mechanism failure, not a build
  // failure (AGENTS.md §0.8) — log loudly, but exit non-fatally to a
  // manual-workflow signal rather than crashing whatever invoked this
  // script. (`data:` scripts are run standalone, not during `npm run
  // build`, so this does not block the app build itself either way.)
  console.error("[state-bills] ingest run failed:", err.message);
  process.exit(1);
});
