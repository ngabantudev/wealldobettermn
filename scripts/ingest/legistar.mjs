#!/usr/bin/env node
// scripts/ingest/legistar.mjs
//
// Phase 4 (FEATURES.md) — dependency-free adapter for Legistar's public Web
// API (webapi.legistar.com/v1/{client}), covering the MN clients known so
// far: St. Paul City Council (`stpaul`) and the Hennepin County Board
// (`hennepinmn`). Client list is config (LEGISTAR_CLIENTS below), not
// per-city branches — a probe finding a third MN Legistar client means
// adding one array entry, not new code.
//
// SCOPE: this is the Phase 4 scaffold. It implements the fetch/paging/
// date-filter/token primitives and the two-hop vote-fetch path FEATURES.md
// describes, and exports them for a follow-up ingest to drive. What it does
// NOT yet do is walk every body's full persons/events/matters/votes history
// and emit a populated dataset — see main() below. Until that lands, this
// script's only job is: probe each client for reachability, and make sure
// public/legistar/{client}.json always exists as an honest, non-fabricated
// empty state (AGENTS.md §0.3, §3.1) rather than a placeholder pretending
// to be a coverage claim.
//
// Usage:
//   node scripts/ingest/legistar.mjs
//
// Optional env (only needed if a client's read-only GETs come back
// 401/403 — some Legistar InSite deployments require a token even for
// public reads; neither known MN client does as of this writing):
//   LEGISTAR_TOKEN_STPAUL, LEGISTAR_TOKEN_HENNEPINMN, or a shared
//   LEGISTAR_TOKEN fallback used for any client without its own var set.
//
// Never crashes `npm run build`: every failure mode below (no network, a
// client requiring a token nobody has set, an unexpected response shape)
// is caught, logged plainly, and followed by a clean exit(0) after writing
// (or leaving in place) the honest empty-state file. Nothing here ever
// synthesizes persons, votes, or dates that didn't come back from the API.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../../public/legistar");

// Good-citizen fetcher per AGENTS.md §2.2: real project identity + contact,
// so an upstream operator who wants us to slow down or stop can reach us.
const USER_AGENT =
  "wealldobettermn-civic-etl/0.1 (+https://github.com/ngabantudev/wealldobettermn; contact: hello@wealldobettermn.org)";

const LEGISTAR_BASE = "https://webapi.legistar.com/v1";

// --- Known MN Legistar clients -------------------------------------------
// `client` is Legistar's own path segment. `tokenEnvVar` is checked before
// falling back to the shared LEGISTAR_TOKEN. Neither known client has
// required a token for the read-only endpoints probed below (confirmed
//2026-08-06), but the field exists because FEATURES.md flags this as a
// per-client possibility, not a per-project one. (Confirmed unauthenticated
// against both clients' `bodies`/`persons` resources on 2026-08-06.)
export const LEGISTAR_CLIENTS = [
  {
    client: "stpaul",
    jurisdiction: "St. Paul City Council",
    tokenEnvVar: "LEGISTAR_TOKEN_STPAUL",
  },
  {
    client: "hennepinmn",
    jurisdiction: "Hennepin County Board",
    tokenEnvVar: "LEGISTAR_TOKEN_HENNEPINMN",
  },
];

const PAGE_SIZE = 1000; // Legistar's own documented per-request cap.

class LegistarAuthError extends Error {
  constructor(client, status) {
    super(
      `[legistar:${client}] HTTP ${status} — this client requires a token. ` +
        `Set LEGISTAR_TOKEN_${client.toUpperCase()} (or LEGISTAR_TOKEN) and re-run.`,
    );
    this.name = "LegistarAuthError";
    this.client = client;
    this.status = status;
  }
}

function resolveToken(clientConfig) {
  return process.env[clientConfig.tokenEnvVar] ?? process.env.LEGISTAR_TOKEN ?? null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Single-page GET against one Legistar resource, with 429 backoff. Legistar
// returns bare 403 ("Key or Token is required") rather than 401 for the
// auth-required case observed against these two clients' non-public
// resources — both are treated as LegistarAuthError so callers get the
// same clear remediation message regardless of which status the client
// happens to use.
async function legistarGet(client, resourcePath, { params = {}, token, attempt = 1 } = {}) {
  const url = new URL(`${LEGISTAR_BASE}/${client}/${resourcePath}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  if (token) url.searchParams.set("token", token);

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });

  if (res.status === 429 && attempt <= 5) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 2000;
    console.log(`[legistar:${client}] rate limited on ${resourcePath}, waiting ${Math.round(delayMs / 1000)}s (attempt ${attempt})...`);
    await sleep(delayMs);
    return legistarGet(client, resourcePath, { params, token, attempt: attempt + 1 });
  }

  if (res.status === 401 || res.status === 403) {
    throw new LegistarAuthError(client, res.status);
  }
  if (!res.ok) {
    throw new Error(`[legistar:${client}] HTTP ${res.status} ${res.statusText} for ${resourcePath}`);
  }
  return res.json();
}

// Pages a full resource with $top/$skip until a short page signals the end
// — the documented paging contract for a 1000-row response cap. Params
// beyond $top/$skip (e.g. $filter) pass straight through.
export async function legistarPageAll(client, resourcePath, { params = {}, token, pageSize = PAGE_SIZE } = {}) {
  const all = [];
  let skip = 0;
  for (;;) {
    const page = await legistarGet(client, resourcePath, {
      token,
      params: { ...params, "$top": pageSize, "$skip": skip },
    });
    if (!Array.isArray(page)) {
      throw new Error(`[legistar:${client}] expected an array response from ${resourcePath}, got ${typeof page}`);
    }
    all.push(...page);
    if (page.length < pageSize) break;
    skip += pageSize;
  }
  return all;
}

// OData date-range filter in Legistar's documented shape:
// $filter=EventDate ge datetime'2024-01-01' and EventDate lt datetime'2025-01-01'
export function dateRangeFilter(fieldName, startIsoDate, endIsoDate) {
  return `${fieldName} ge datetime'${startIsoDate}' and ${fieldName} lt datetime'${endIsoDate}'`;
}

// --- Resource-shaped helpers ----------------------------------------------

export function getPersons(client, { token } = {}) {
  return legistarPageAll(client, "persons", { token });
}

export function getBodies(client, { token } = {}) {
  return legistarPageAll(client, "bodies", { token });
}

// Authoritative for holding.start_date/end_date per FEATURES.md — never
// take term dates from a body roster or a person record instead.
export function getOfficeRecords(client, { token, startIsoDate, endIsoDate } = {}) {
  const params = {};
  if (startIsoDate && endIsoDate) {
    params["$filter"] = dateRangeFilter("OfficeRecordStartDate", startIsoDate, endIsoDate);
  }
  return legistarPageAll(client, "officerecords", { token, params });
}

export function getEvents(client, { token, startIsoDate, endIsoDate } = {}) {
  const params = {};
  if (startIsoDate && endIsoDate) {
    params["$filter"] = dateRangeFilter("EventDate", startIsoDate, endIsoDate);
  }
  return legistarPageAll(client, "events", { token, params });
}

export function getEventItems(client, eventId, { token } = {}) {
  return legistarPageAll(client, `events/${eventId}/eventitems`, { token });
}

export function getMatters(client, { token, startIsoDate, endIsoDate } = {}) {
  const params = {};
  if (startIsoDate && endIsoDate) {
    params["$filter"] = dateRangeFilter("MatterIntroDate", startIsoDate, endIsoDate);
  }
  return legistarPageAll(client, "matters", { token, params });
}

export function getMatterHistories(client, matterId, { token } = {}) {
  return legistarPageAll(client, `matters/${matterId}/histories`, { token });
}

export function getEventItemVotes(client, eventItemId, { token } = {}) {
  return legistarPageAll(client, `eventitems/${eventItemId}/votes`, { token });
}

// The two-hop vote path FEATURES.md documents: find the history row
// recording that `bodyName` took a final action on this matter (a non-null
// MatterHistoryPassedFlag, i.e. it was actually voted rather than just
// referred or read), then fetch the tally attached to that row's own Id as
// an event-item id. Returns null (not []) when no matching history row is
// found — absence here just means "no recorded action by this body on
// this matter yet," never evidence of anything, per FEATURES.md's own
// note that only InSite-public records come back at all.
export async function getVotesForMatterAction(client, matterId, bodyName, { token } = {}) {
  const histories = await getMatterHistories(client, matterId, { token });
  const actedRecord = histories.find(
    (h) => h.MatterHistoryPassedFlag !== null && h.MatterHistoryPassedFlag !== undefined && h.MatterHistoryActionBodyName === bodyName,
  );
  if (!actedRecord) return null;
  return getEventItemVotes(client, actedRecord.Id, { token });
}

// --- Empty-state output ----------------------------------------------------
// Written for every configured client every run, whether or not that run's
// probe succeeded. This is the file the registry entry
// (src/lib/legistarJurisdictions.ts) points UI code at until a follow-up
// PR wires the full persons/bodies/officerecords → Holding[] ingest.
// `holdings` is always [] here — see AGENTS.md §0.3 / §3.1: an honest empty
// array with a documented reason beats any placeholder that could be
// mistaken for coverage.
function buildEmptyState(clientConfig, { status, note, fetchedAt }) {
  return {
    schemaVersion: 1,
    client: clientConfig.client,
    jurisdiction: clientConfig.jurisdiction,
    generatedAt: new Date().toISOString(),
    status, // "probe_ok_pending_ingest" | "unreachable" | "auth_required"
    note,
    provenance: {
      primarySourceUrl: `${LEGISTAR_BASE}/${clientConfig.client}`,
      sourceAgency: clientConfig.jurisdiction,
      documentType: "Legistar Web API",
      documentId: null,
      issuedDate: null,
      fetchedAt,
      licence:
        "Public records served via Legistar InSite; no separate machine-reuse licence published by the host jurisdiction as of this writing.",
      contentHash: null,
    },
    // Holding[] — see src/lib/types.ts. Always empty until the follow-up
    // ingest (persons + bodies + officerecords → Holding) lands.
    holdings: [],
    knownGaps: [
      "Full persons/bodies/officerecords ingest not yet implemented — this file is a Phase 4 scaffold placeholder, not a coverage claim.",
      note,
    ].filter(Boolean),
  };
}

async function writeClientOutput(clientConfig, state) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, `${clientConfig.client}.json`);
  await writeFile(outputPath, JSON.stringify(state, null, 2) + "\n");
  return outputPath;
}

// A light reachability probe — one page of `bodies`, the cheapest resource
// to ask for — so a run can tell "no network / needs a token" apart from
// "API is fine, ingest just isn't wired yet" without pulling any data that
// would need to be discarded.
async function probeClient(clientConfig) {
  const token = resolveToken(clientConfig);
  const bodies = await legistarGet(clientConfig.client, "bodies", { token, params: { "$top": 1 } });
  return Array.isArray(bodies) ? bodies.length : 0;
}

async function main() {
  let anyFailures = false;

  for (const clientConfig of LEGISTAR_CLIENTS) {
    console.log(`[legistar:${clientConfig.client}] probing ${clientConfig.jurisdiction}...`);
    try {
      const sampleCount = await probeClient(clientConfig);
      console.log(`[legistar:${clientConfig.client}] reachable (sample bodies page returned ${sampleCount} row(s)).`);
      const state = buildEmptyState(clientConfig, {
        status: "probe_ok_pending_ingest",
        note: `Connectivity confirmed ${new Date().toISOString()}; full ingest is a follow-up PR.`,
        fetchedAt: new Date().toISOString(),
      });
      const outputPath = await writeClientOutput(clientConfig, state);
      console.log(`[legistar:${clientConfig.client}] wrote empty-state scaffold to ${outputPath}`);
    } catch (err) {
      anyFailures = true;
      const isAuthError = err instanceof LegistarAuthError;
      const reason = isAuthError ? "requires a token this run doesn't have" : "unreachable (network error or unexpected response)";
      console.error(`[legistar:${clientConfig.client}] ${reason}: ${err.message}`);
      const state = buildEmptyState(clientConfig, {
        status: isAuthError ? "auth_required" : "unreachable",
        note: `Probe failed at ${new Date().toISOString()}: ${err.message}`,
        fetchedAt: null,
      });
      const outputPath = await writeClientOutput(clientConfig, state);
      console.log(`[legistar:${clientConfig.client}] left honest empty-state scaffold in place at ${outputPath}`);
    }
  }

  if (anyFailures) {
    console.log(
      "[legistar] one or more clients were unreachable or need a token this run. " +
        "That's a known gap, not a build failure — see the knownGaps entries written above. Exiting cleanly.",
    );
  } else {
    console.log("[legistar] all configured clients reachable. Full ingest still pending a follow-up PR — see scaffold note above.");
  }

  // Always exit 0: per FEATURES.md's scaffolding scope, this script never
  // fails `npm run build` or CI over an upstream API being unreachable —
  // an API is a refresh mechanism, not a runtime dependency (AGENTS.md §3.2).
  process.exit(0);
}

main().catch((err) => {
  // Should be unreachable — every expected failure mode is caught per
  // client above — but if something truly unexpected happens, still don't
  // take the build down with it.
  console.error("[legistar] unexpected top-level error (not fabricating output):", err);
  process.exit(0);
});
