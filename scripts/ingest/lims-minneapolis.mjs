#!/usr/bin/env node
// scripts/ingest/lims-minneapolis.mjs
//
// FEATURES.md Phase 3 — Minneapolis (LIMS API). Skeleton ingest for
// lims.minneapolismn.gov's LIMS API v1: CouncilMembers, CouncilTerms,
// MeetingBodies, voting records, and file items (agenda items), back to
// 2014. This is the reference implementation for the `Holding`
// churn/roster model (src/lib/types.ts) — see that file's comment for how
// this script's output is meant to map onto it.
//
// Dependency-free by design (AGENTS.md §0.8): only Node built-ins and the
// global `fetch` (Node 18+), no npm packages. Deterministic and
// re-runnable per AGENTS.md §2.2 — this script only ever writes what the
// API returned for this run, nothing invented, nothing carried over from
// a previous run except the honest empty state below.
//
// LIMS_API_KEY is required for a live fetch. Per AGENTS.md §3.2 ("no
// proprietary API keys in the critical path" / "the build must succeed
// with every upstream API unreachable"), its absence is NOT a failure:
// this script exits 0, writes the honest empty-state contract file if one
// doesn't already exist, and logs exactly what a maintainer needs to do
// to get real data. It never crashes the build and never fabricates
// council, meeting, term, or vote records to fill the gap.
//
// NOTE ON ENDPOINT SHAPE: exact base URL casing, auth header name, and
// per-field response shape are not yet confirmed against live LIMS API
// docs (no key has been registered as of this commit) — FEATURES.md's
// Phase 3 excerpt names the endpoints below, not their full request/
// response contract. Treat BASE_URL, the endpoint paths, and the request
// helper's auth header as best-effort scaffolding to verify and correct
// against the real API docs once a key exists, not as confirmed fact.
// Nothing here is executed unless LIMS_API_KEY is set, so there is no
// live behavior to get wrong yet.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "../../public/minneapolis-meetings.json");

const SOURCE_AGENCY = "City of Minneapolis, Office of the City Clerk";
const PRIMARY_SOURCE_URL = "https://lims.minneapolismn.gov/";

// TODO(verify): confirm exact base path/casing against LIMS API docs once
// a key is registered — this is FEATURES.md's stated host, not a URL
// this script has ever successfully called.
const BASE_URL = "https://lims.minneapolismn.gov/API/v1";

// Endpoint paths exactly as named in FEATURES.md's Phase 3 excerpt.
const ENDPOINTS = {
  councilMembers: "/referenceList/CouncilMembers",
  councilTerms: "/referenceList/CouncilTerms",
  meetingBodies: "/referenceList/MeetingBodies",
  fileItemStatus: "/referenceList/FileItemStatus",
  fileTypes: "/referenceList/FileTypes",
  ordinanceIntroductions: "/search/OrdinancesIntroductions",
  latestEnactedOrdinances: "/search/LatestEnactedOrdinances",
  // Voting records and file items are queried by year/term/body/member
  // per FEATURES.md ("voting records by year/term back to 2014; file
  // items (agenda items) from 2014 onward; meetings by body or by
  // member") — parameterized below rather than a single fixed path.
  votingRecordsByYear: (year) => `/votingRecords/${year}`,
  fileItemsByYear: (year) => `/fileItems/${year}`,
  meetingsByBody: (bodyId) => `/meetings/body/${bodyId}`,
  meetingsByMember: (memberId) => `/meetings/member/${memberId}`,
};

// AGENTS.md §2.2 Good-Citizen Fetcher — descriptive User-Agent + contact.
const USER_AGENT =
  "wealldobettermn-ingest/1.0 (+https://github.com/ngabantudev/wealldobettermn; civic transparency data pull, low volume, contact via repo issues)";

const FIRST_YEAR_WITH_DATA = 2014;

/**
 * Fetch one LIMS endpoint. Sends the API key as both a header and a query
 * param — TODO(verify): LIMS's actual auth mechanism (subscription-key
 * header vs. query param vs. both) is unconfirmed without a live key;
 * this belt-and-suspenders approach is scaffolding to correct once real
 * docs/responses are available, not a claim that either works today.
 *
 * @param {string} pathname
 * @param {string} apiKey
 * @returns {Promise<unknown>}
 */
async function fetchLims(pathname, apiKey) {
  const url = new URL(pathname, BASE_URL);
  url.searchParams.set("api_key", apiKey);

  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      // TODO(verify): confirm the real subscription-key header name.
      "Ocp-Apim-Subscription-Key": apiKey,
    },
  });

  if (!res.ok) {
    throw new Error(`LIMS request failed: ${res.status} ${res.statusText} — ${url}`);
  }
  return res.json();
}

/**
 * @param {string} apiKey
 */
async function fetchCouncilMembers(apiKey) {
  return fetchLims(ENDPOINTS.councilMembers, apiKey);
}

/**
 * @param {string} apiKey
 */
async function fetchCouncilTerms(apiKey) {
  return fetchLims(ENDPOINTS.councilTerms, apiKey);
}

/**
 * @param {string} apiKey
 */
async function fetchMeetingBodies(apiKey) {
  return fetchLims(ENDPOINTS.meetingBodies, apiKey);
}

/**
 * Voting records for one year, 2014 onward per FEATURES.md.
 *
 * @param {string} apiKey
 * @param {number} year
 */
async function fetchVotingRecordsForYear(apiKey, year) {
  return fetchLims(ENDPOINTS.votingRecordsByYear(year), apiKey);
}

/**
 * File items (agenda items) for one year, 2014 onward per FEATURES.md.
 *
 * @param {string} apiKey
 * @param {number} year
 */
async function fetchFileItemsForYear(apiKey, year) {
  return fetchLims(ENDPOINTS.fileItemsByYear(year), apiKey);
}

/**
 * TODO: once real response shapes are confirmed, map raw LIMS
 * CouncilMembers + CouncilTerms rows onto src/lib/types.ts's `Holding`
 * shape (officeOcdId, personExternalId, name, officeHeld, jurisdiction,
 * termStart, termEnd, sourceUrl, verifiedAt) — this is the reference
 * implementation the churn/roster-diff model (AGENTS.md §2.1,
 * scripts/ingest/roster-diff.mjs on feature/phase5-roster-churn-detection)
 * is meant to consume. Left unimplemented here: no live response has
 * been seen yet to map against, and inventing a mapping from the field
 * *names* alone risks getting it wrong in a way nobody would catch until
 * a real key exists.
 *
 * @param {unknown} _rawCouncilMembers
 * @param {unknown} _rawCouncilTerms
 * @returns {import("../../src/lib/types.js").Holding[]}
 */
function toHoldings(_rawCouncilMembers, _rawCouncilTerms) {
  throw new Error(
    "toHoldings: not implemented — response shape unconfirmed without a live LIMS_API_KEY. " +
      "Implement this against real API responses before wiring it into main().",
  );
}

/**
 * Writes the honest empty-state contract file — same shape a populated
 * run would produce, with every collection empty and `reason` explaining
 * why. Never overwrites a file that already has real data in it.
 */
async function writeEmptyState(reason) {
  const emptyState = {
    schemaVersion: 1,
    generatedAt: null,
    status: "empty",
    reason,
    sourceAgency: SOURCE_AGENCY,
    primarySourceUrl: PRIMARY_SOURCE_URL,
    councilMembers: [],
    councilTerms: [],
    meetingBodies: [],
    meetings: [],
    votes: [],
    fileItems: [],
  };
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(emptyState, null, 2)}\n`, "utf8");
  return emptyState;
}

async function main() {
  const apiKey = process.env.LIMS_API_KEY;

  if (!apiKey) {
    console.log(
      "[lims-minneapolis] LIMS_API_KEY is not set — skipping live fetch.\n" +
        "  This is expected until a free registered key is obtained from " +
        `${PRIMARY_SOURCE_URL}.\n` +
        "  Writing an honest empty state to " +
        `${OUTPUT_PATH} (AGENTS.md §3.1) instead of failing the build or\n` +
        "  fabricating council/meeting/vote data. Set LIMS_API_KEY and re-run " +
        "once a key is available.",
    );
    await writeEmptyState(
      "No LIMS_API_KEY provisioned yet — this script has never completed a live fetch.",
    );
    return;
  }

  // Live path: fetch reference lists, then per-year voting records and
  // file items back to FIRST_YEAR_WITH_DATA. Left as straight-line
  // scaffolding — no retry/backoff, no pagination handling, no snapshot
  // diffing yet (AGENTS.md §2.2's "Snapshot, Don't Overwrite" and §0.5's
  // diff-on-refresh are follow-up work once real responses are in hand
  // to design pagination/backoff against).
  console.log("[lims-minneapolis] LIMS_API_KEY present — starting live fetch.");

  const currentYear = new Date().getUTCFullYear();
  const years = [];
  for (let year = FIRST_YEAR_WITH_DATA; year <= currentYear; year += 1) {
    years.push(year);
  }

  try {
    const [councilMembers, councilTerms, meetingBodies] = await Promise.all([
      fetchCouncilMembers(apiKey),
      fetchCouncilTerms(apiKey),
      fetchMeetingBodies(apiKey),
    ]);

    console.log(
      `[lims-minneapolis] fetched reference lists: ${Array.isArray(councilMembers) ? councilMembers.length : "?"} council member(s), ` +
        `${Array.isArray(councilTerms) ? councilTerms.length : "?"} term row(s), ` +
        `${Array.isArray(meetingBodies) ? meetingBodies.length : "?"} meeting body(ies).`,
    );

    // Per-year voting records and file items, 2014 onward. Fetched
    // sequentially rather than in parallel, out of caution for a
    // rate-limit policy that isn't documented anywhere this script's
    // author could confirm — see AGENTS.md §2.2's Good-Citizen Fetcher
    // and LESSONS.md's Legistar rate-limit entry for the same reasoning
    // applied to a different API.
    const votingRecordsByYear = {};
    const fileItemsByYear = {};
    for (const year of years) {
      votingRecordsByYear[year] = await fetchVotingRecordsForYear(apiKey, year);
      fileItemsByYear[year] = await fetchFileItemsForYear(apiKey, year);
    }
    console.log(
      `[lims-minneapolis] fetched voting records + file items for ${years.length} year(s) ` +
        `(${years[0]}-${years[years.length - 1]}).`,
    );

    // Mapping raw LIMS rows onto the public Holding contract is not
    // implemented yet (see toHoldings()'s own note) — this call is
    // expected to throw until that mapping is written against real
    // response shapes. Caught here (rather than left to propagate) so the
    // log above about what *did* fetch successfully isn't lost.
    toHoldings(councilMembers, councilTerms);
  } catch (err) {
    console.error(
      "[lims-minneapolis] live fetch did not complete:",
      err instanceof Error ? err.message : err,
    );
    console.error(
      "[lims-minneapolis] leaving the existing public/minneapolis-meetings.json untouched " +
        "rather than overwriting known-good (or honestly empty) data with a partial result.",
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
