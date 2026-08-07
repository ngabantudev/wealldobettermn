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
// SCOPE (updated — full ingest landed): this script now walks each
// client's /bodies, /persons, and /officerecords into Body[]/Person[]/
// Office[]/Holding[] (officerecords is authoritative for
// holding.term_start/term_end per FEATURES.md), then walks a bounded,
// recent window of /matters -> /matters/{id}/histories ->
// /eventitems/{id}/votes for the primary legislative body (City Council /
// County Board) into Meeting[]/AgendaItem[]/VoteEvent[]/Vote[] — see
// ingestClient() below. Every officerecords row is filtered through
// ROLE_TITLE_ALLOWLIST first (AGENTS.md §1b/§1d): only recognized
// officeholder titles survive, so clerks, recording secretaries, and other
// non-supervisory staff mixed into the same feed are dropped, never
// published. The votes window is intentionally bounded (VOTE_WINDOW_DAYS,
// MAX_MATTERS_PER_CLIENT below) rather than a full-term backfill in one
// run — see the knownGaps entry determineVoteWindow() emits for why.
//
// If a client is unreachable, needs a token, or the officeholder filter
// leaves nothing publishable, this falls back to the same honest,
// non-fabricated empty state (AGENTS.md §0.3, §3.1) it always has —
// ingestClient() throws on any failure and main()'s catch block writes
// that fallback rather than a partial or fabricated result.
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
import { createHash } from "node:crypto";
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
// required a token for the read-only endpoints probed below, but the
// field exists because FEATURES.md flags this as a per-client possibility,
// not a per-project one. Confirmed unauthenticated (live GETs, 200s, real
// data, zero token/key) against both clients across the full path this
// module exercises — Bodies, Persons, OfficeRecords, Events, Matters,
// Matters/{id}/Histories, and EventItems/{id}/Votes — on 2026-08-06.
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

// --- Full-ingest configuration (Phase 4 follow-up) ------------------------
//
// Jurisdiction/OCD metadata per client. OCD ids follow the documented Open
// Civic Data naming convention (AGENTS.md §2.4) but have not been
// independently checked against OCD's own boundary service — flagged as a
// knownGaps entry in the output rather than asserted as verified.
const JURISDICTION_META = {
  stpaul: {
    jurisdictionId: "legistar-stpaul",
    ocdId: "ocd-division/country:us/state:mn/place:st_paul",
  },
  hennepinmn: {
    jurisdictionId: "legistar-hennepinmn",
    ocdId: "ocd-division/country:us/state:mn/county:hennepin",
  },
};

// AGENTS.md §1b/§1d structural filter: only officerecords rows whose
// OfficeRecordTitle is a recognized officeholder role are kept. Everything
// else — blank/"None" titles, "Recording Secretary", "Community Advisor",
// and similar — is dropped, never published, per "when in doubt, leave it
// out." Built from live-inspecting both known clients' full title
// vocabularies on 2026-08-06; a future title neither allowed nor already
// seen here is dropped by default (the safe direction) and surfaced via
// knownGaps so a human can decide whether to allowlist it.
const ROLE_TITLE_ALLOWLIST = new Set([
  "Councilmember",
  "City Council President",
  "Commissioner",
  "Chair",
  "Co-chair",
  "Chairperson",
  "Vice Chair",
  "Board Member",
  "Ex-officio Member",
  "Legislative Hearing Officer",
  "Deputy Legislative Hearing Officer",
  "Mayor",
]);

// Defense-in-depth per AGENTS.md §1b: bodies that are internal/clerical
// machinery, not governing bodies, regardless of what title a row carries.
const EXCLUDED_BODY_NAMES = new Set(["Clerk", "Clerk to the Board", "Do not use", "Council Secretary"]);

// Legistar's own VoteValueName strings, normalized to models.ts's VoteValue
// enum. An unrecognized value is dropped (never guessed) and reported via
// knownGaps — see mapVoteValue().
const VOTE_VALUE_MAP = {
  yea: "yea",
  yes: "yea",
  nay: "nay",
  no: "nay",
  absent: "absent",
  abstain: "abstain",
  abstained: "abstain",
};

// Votes are ingested for a recent slice of the current term, not the full
// term back to its start — a multi-year current term (e.g. St. Paul's
// 2024-2028 council term) can carry thousands of matters, and walking all
// of them in one run would mean thousands of extra requests against a
// public, unauthenticated API in a single pass. That's not a good-citizen
// request budget (AGENTS.md §2.2). Each scheduled run instead covers this
// trailing window; running it on a recurring schedule accumulates full
// term coverage over time. Documented as a knownGaps entry on every run.
const VOTE_WINDOW_DAYS = 60;

// Hard cap on matters processed for votes in a single run, independent of
// the date window, so an unexpectedly high-volume window still can't turn
// into an unbounded request burst.
const MAX_MATTERS_PER_CLIENT = 250;

const SNAPSHOT_DIR = path.join(__dirname, "../../data/snapshots/legistar");

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
// referred or read), then fetch the tally attached to that row's own
// MatterHistoryId, reused directly as an EventItemId. Returns null (not
// []) when no matching history row is found — absence here just means "no
// recorded action by this body on this matter yet," never evidence of
// anything, per FEATURES.md's own note that only InSite-public records
// come back at all.
//
// Live-verified 2026-08-06 against stpaul (MatterId 52530, "RES 26-1263"):
// a MatterHistory row's `MatterHistoryId` and the corresponding
// `EventItemId` are the same value (and share a GUID) — Legistar exposes
// the same underlying row through both resources. There is no third
// correlation query needed; the field is `MatterHistoryId`, not `Id` (the
// field this helper read from until this fix — that typo meant every real
// call here passed `undefined` to `eventitems/{id}/votes` and would have
// silently 404'd or returned nothing once ingest wiring landed).
export async function getVotesForMatterAction(client, matterId, bodyName, { token } = {}) {
  const histories = await getMatterHistories(client, matterId, { token });
  const actedRecord = histories.find(
    (h) => h.MatterHistoryPassedFlag !== null && h.MatterHistoryPassedFlag !== undefined && h.MatterHistoryActionBodyName === bodyName,
  );
  if (!actedRecord) return null;
  return getEventItemVotes(client, actedRecord.MatterHistoryId, { token });
}

// A matter's public InSite record page (what a resident actually lands on
// when they click "View source" — the same page City staff and the local
// press use, not an API response). Not under the webapi.legistar.com/v1
// surface everything above talks to; this is the client's own InSite
// website. There's no documented direct URL for a MatterId — InSite's
// Gateway.aspx?M=L&ID={MatterId} redirect resolves it into the real
// LegislationDetail.aspx?ID={id}&GUID={guid} URL, confirmed live against
// both known MN clients while building #57 (a bare LegislationDetail.aspx
// URL built from MatterId+MatterGuid returns "Invalid parameters!" — the
// ID/GUID pair LegislationDetail.aspx actually wants is a different,
// undocumented internal id the Gateway redirect exposes, not the MatterId/
// MatterGuid pair /matters/{id} returns). Never guessed further than
// this: any failure here (network, unexpected redirect shape, no match)
// returns null rather than a URL that might not resolve — AGENTS.md §3.3
// "Missing Sources: Never fabricate or infer."
const LEGISLATION_DETAIL_PATTERN = /LegislationDetail\.aspx\?ID=(\d+)&(?:amp;)?GUID=([0-9A-Fa-f-]+)/;

async function resolveLegislationUrl(client, matterId) {
  try {
    const gatewayUrl = `https://${client}.legistar.com/Gateway.aspx?M=L&ID=${matterId}`;
    const res = await fetch(gatewayUrl, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(LEGISLATION_DETAIL_PATTERN);
    if (!match) return null;
    return `https://${client}.legistar.com/LegislationDetail.aspx?ID=${match[1]}&GUID=${match[2]}`;
  } catch {
    return null; // never let a permalink lookup fail the whole ingest run
  }
}

// --- Content hashing (AGENTS.md §2.2 provenance record) -------------------
// Same sha256-hex-of-JSON convention as scripts/ingest/roster-diff.mjs's
// hashRoster() — a fingerprint of the *raw upstream content* a run's
// output was built from, so a later run can tell "upstream data actually
// changed" apart from "we re-fetched and got the same thing." This hashes
// the payload as received, never anything we derived from it.
export function sha256Hex(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// A client's provenance.contentHash is one hash covering every raw
// resource fetched for that run (bodies, persons, officerecords, and — if
// the vote window ran — matters and histories/votes), not just the last
// one. Combining by hashing the sorted {name, hash} list (rather than,
// say, concatenating raw payloads) keeps this cheap even when the raw
// payloads themselves are large, and sorting by name makes the combined
// hash independent of fetch order — same "sort before hashing" approach
// normalizeRoster() uses in roster-diff.mjs.
export function combineSnapshotHashes(entries) {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return sha256Hex(sorted);
}

// --- Snapshot, don't overwrite (AGENTS.md §2.2 / §0.5) --------------------
// Raw upstream payloads are written to disk before any parsing, so a
// schema change or a bug below never loses the original response. Same
// convention as scripts/ingest/state-bills.mjs's snapshotRaw(): gitignored
// (/data/snapshots), regenerated every run, dated by fetch time only.
// Returns the snapshot's own content hash alongside its path so callers
// can fold it into the run's combined provenance.contentHash (see
// combineSnapshotHashes above) instead of hashing the payload twice.
async function snapshotRaw(client, name, payload) {
  const dir = path.join(SNAPSHOT_DIR, client);
  await mkdir(dir, { recursive: true });
  const fetchedAt = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotPath = path.join(dir, `${name}-${fetchedAt}.json`);
  await writeFile(snapshotPath, JSON.stringify(payload, null, 2));
  return { snapshotPath, hash: sha256Hex(payload) };
}

// --- Small pure helpers -----------------------------------------------------

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

// Legistar dates come back as bare "YYYY-MM-DDTHH:mm:ss" with no timezone.
// Slicing the date portion directly avoids any UTC-conversion shift that
// `new Date(...).toISOString()` would introduce.
export function toIsoDate(value) {
  if (typeof value !== "string" || !value) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

// Strips internal bookkeeping fields (prefixed `_`) used to carry Legistar's
// own numeric ids through the join steps below, before anything is written
// to public/. Keeps the public schema exactly the shape models.ts declares.
export function stripInternal(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!key.startsWith("_")) out[key] = value;
  }
  return out;
}

export function mapVoteValue(voteValueName) {
  if (!voteValueName) return null;
  return VOTE_VALUE_MAP[voteValueName.trim().toLowerCase()] ?? null;
}

// --- Persons + Offices + Holdings from /officerecords ----------------------
//
// /officerecords is authoritative for holding.term_start/term_end per
// FEATURES.md. Persons and Offices are both *derived* from the surviving
// officerecords rows — see the file-level filter above — so a person or
// office with no attributed official act never gets a record (AGENTS.md
// §1d).
export function buildOfficesPersonsHoldings(clientConfig, officeRecordsRaw, jurisdictionId, runIso, officeRecordsSourceUrl) {
  const offices = new Map();
  const persons = new Map();
  const holdings = [];
  const droppedTitles = new Set();
  const droppedBodies = new Set();
  let droppedNoStartDate = 0;

  for (const rec of officeRecordsRaw) {
    const title = (rec.OfficeRecordTitle || "").trim();
    const bodyName = (rec.OfficeRecordBodyName || "").trim();

    if (EXCLUDED_BODY_NAMES.has(bodyName)) {
      droppedBodies.add(bodyName || "(blank)");
      continue;
    }
    if (!title || !ROLE_TITLE_ALLOWLIST.has(title)) {
      droppedTitles.add(title || "(blank)");
      continue;
    }
    if (!rec.OfficeRecordPersonId || !rec.OfficeRecordBodyId) continue;

    const termStart = toIsoDate(rec.OfficeRecordStartDate);
    if (!termStart) {
      droppedNoStartDate += 1;
      continue;
    }
    const termEnd = toIsoDate(rec.OfficeRecordEndDate);

    const officeKey = `${rec.OfficeRecordBodyId}::${slugify(title)}`;
    if (!offices.has(officeKey)) {
      offices.set(officeKey, {
        id: `legistar-${clientConfig.client}-office-${rec.OfficeRecordBodyId}-${slugify(title)}`,
        jurisdiction_id: jurisdictionId,
        name: `${bodyName} — ${title}`,
        seat_label: title,
        // Not a real per-seat OCD id (Legistar exposes body membership, not
        // individual ward/district seats, for these two clients) — see the
        // knownGaps entry emitted alongside this in ingestClient().
        ocd_id: `ocd-division/country:us/legistar:${clientConfig.client}/body:${rec.OfficeRecordBodyId}/office:${slugify(title)}`,
        _bodyId: rec.OfficeRecordBodyId,
      });
    }
    const office = offices.get(officeKey);

    const personId = `legistar-${clientConfig.client}-person-${rec.OfficeRecordPersonId}`;
    if (!persons.has(personId)) {
      const officialName =
        rec.OfficeRecordFullName || `${rec.OfficeRecordFirstName || ""} ${rec.OfficeRecordLastName || ""}`.trim();
      persons.set(personId, {
        id: personId,
        official_name: officialName,
        slug: slugify(officialName || String(rec.OfficeRecordPersonId)),
        photo_url: null,
        _legistarPersonId: rec.OfficeRecordPersonId,
      });
    }

    holdings.push({
      id: `legistar-${clientConfig.client}-holding-${rec.OfficeRecordId}`,
      office_id: office.id,
      person_id: personId,
      term_start: termStart,
      term_end: termEnd, // null only if Legistar itself reports no end date
      source_url: `${LEGISTAR_BASE}/${clientConfig.client}/officerecords/${rec.OfficeRecordId}`,
      first_seen: runIso,
      last_seen: runIso,
      verifiedAt: runIso,
      verifiedAgainst: officeRecordsSourceUrl,
      _legistarPersonId: rec.OfficeRecordPersonId,
      _bodyId: rec.OfficeRecordBodyId,
    });
  }

  return {
    offices: [...offices.values()],
    persons: [...persons.values()],
    holdings,
    droppedTitles: [...droppedTitles],
    droppedBodies: [...droppedBodies],
    droppedNoStartDate,
  };
}

// Finds the current council/board term's primary legislative body and its
// start date from the surviving holdings, to bound the votes window below.
// "Current" = a holding on that body whose term_end is null or on/after the
// run date.
export function determineVoteWindow(clientConfig, holdings, bodyMetaList, runDate) {
  const knownGaps = [];
  const runIso = runDate.toISOString().slice(0, 10);
  const primaryBody = bodyMetaList.find((b) => b.BodyTypeName === "Primary Legislative Body" && b.BodyActiveFlag === 1);

  if (!primaryBody) {
    knownGaps.push(
      `No body with BodyTypeName "Primary Legislative Body" found for ${clientConfig.client}; vote ingest skipped for this run.`,
    );
    return { primaryBodyId: null, primaryBodyName: null, windowStartIso: null, knownGaps };
  }

  let termStart = null;
  for (const h of holdings) {
    if (h._bodyId !== primaryBody.BodyId) continue;
    if (!(h.term_end === null || h.term_end >= runIso)) continue;
    if (!termStart || h.term_start < termStart) termStart = h.term_start;
  }

  const windowStartIso = addDays(runDate, -VOTE_WINDOW_DAYS);
  knownGaps.push(
    termStart
      ? `Votes ingested only for the most recent ${VOTE_WINDOW_DAYS} days (from ${windowStartIso}) — the current term on ` +
        `${primaryBody.BodyName} began ${termStart}, but a full-term backfill was not run in this pass to stay within a ` +
        `good-citizen request budget (AGENTS.md §2.2). Run this ingest on a recurring schedule to accumulate full-term ` +
        `coverage incrementally.`
      : `Votes ingested only for the most recent ${VOTE_WINDOW_DAYS} days (from ${windowStartIso}); could not determine a ` +
        `current term start date for ${primaryBody.BodyName} from officerecords, so no wider bound was attempted.`,
  );

  return { primaryBodyId: primaryBody.BodyId, primaryBodyName: primaryBody.BodyName, windowStartIso, knownGaps };
}

export function findHoldingForVote(holdings, legistarPersonId, bodyId, actionDateIso) {
  const candidates = holdings.filter(
    (h) =>
      h._legistarPersonId === legistarPersonId &&
      h._bodyId === bodyId &&
      h.term_start <= actionDateIso &&
      (h.term_end === null || h.term_end >= actionDateIso),
  );
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.term_start < a.term_start ? -1 : 1));
  return candidates[0];
}

const sleepBriefly = () => sleep(75); // light inter-request pacing, on top of legistarGet's own 429 backoff

// The two-hop vote walk, bounded to one recent window on one body (the
// primary legislative body — City Council / County Board), per
// determineVoteWindow() above. Builds Meeting/AgendaItem/VoteEvent/Vote
// records directly from Matters + MatterHistories, with no extra /events
// calls needed (MatterHistoryActionDate and MatterHistoryEventId already
// carry what a minimal Meeting record needs).
async function buildVotesForWindow(clientConfig, token, { primaryBodyId, primaryBodyName, windowStartIso, windowEndIso, holdings }) {
  const knownGaps = [];
  const contentHashEntries = [];
  const matters = await getMatters(clientConfig.client, { token, startIsoDate: windowStartIso, endIsoDate: windowEndIso });
  const mattersSnapshot = await snapshotRaw(clientConfig.client, "matters-window", {
    windowStartIso,
    windowEndIso,
    count: matters.length,
    matters,
  });
  contentHashEntries.push({ name: "matters-window", hash: mattersSnapshot.hash });

  let workingMatters = matters;
  if (matters.length > MAX_MATTERS_PER_CLIENT) {
    workingMatters = [...matters]
      .sort((a, b) => (b.MatterIntroDate || "").localeCompare(a.MatterIntroDate || ""))
      .slice(0, MAX_MATTERS_PER_CLIENT);
    knownGaps.push(
      `${matters.length} matter(s) found in the ${windowStartIso}–${windowEndIso} window for ${clientConfig.client}; capped ` +
        `to the most recent ${MAX_MATTERS_PER_CLIENT} to bound this run's request volume.`,
    );
  }

  const meetings = new Map();
  const agendaItems = [];
  const voteEvents = [];
  const votes = [];
  const unmatchedVoters = new Set();
  const unmappedVoteValues = new Set();
  const unresolvedLegislationUrls = new Set();
  const rawHistoriesAndVotes = [];

  for (const matter of workingMatters) {
    let histories;
    try {
      histories = await getMatterHistories(clientConfig.client, matter.MatterId, { token });
    } catch (err) {
      knownGaps.push(`Failed to fetch histories for matter ${matter.MatterId} (${clientConfig.client}): ${err.message}`);
      continue;
    }
    await sleepBriefly();

    const actedRecord = histories.find(
      (h) =>
        h.MatterHistoryPassedFlag !== null &&
        h.MatterHistoryPassedFlag !== undefined &&
        h.MatterHistoryActionBodyName === primaryBodyName,
    );
    if (!actedRecord) continue;

    let rawVotes;
    try {
      rawVotes = await getEventItemVotes(clientConfig.client, actedRecord.MatterHistoryId, { token });
    } catch (err) {
      knownGaps.push(
        `Failed to fetch votes for matter ${matter.MatterId} history ${actedRecord.MatterHistoryId} (${clientConfig.client}): ${err.message}`,
      );
      continue;
    }
    await sleepBriefly();
    rawHistoriesAndVotes.push({ matterId: matter.MatterId, history: actedRecord, votes: rawVotes });
    if (!rawVotes.length) continue;

    const actionDate = toIsoDate(actedRecord.MatterHistoryActionDate) ?? toIsoDate(matter.MatterIntroDate);
    if (!actionDate) continue;

    // Only resolved for matters that make it this far (a real recorded
    // vote) — bounds the extra request volume to what's actually going to
    // be cited, not every matter in the window.
    const legislationUrl = await resolveLegislationUrl(clientConfig.client, matter.MatterId);
    if (!legislationUrl) unresolvedLegislationUrls.add(String(matter.MatterId));
    await sleepBriefly();

    const meetingId = `legistar-${clientConfig.client}-meeting-${actedRecord.MatterHistoryEventId}`;
    if (!meetings.has(meetingId)) {
      meetings.set(meetingId, {
        id: meetingId,
        body_id: `legistar-${clientConfig.client}-body-${primaryBodyId}`,
        date: actionDate,
        agenda_url: null,
        minutes_url: null,
        video_url: null,
      });
    }

    const agendaItemId = `legistar-${clientConfig.client}-agendaitem-${actedRecord.MatterHistoryId}`;
    agendaItems.push({
      id: agendaItemId,
      meeting_id: meetingId,
      title: matter.MatterTitle || matter.MatterName || matter.MatterFile || `Matter ${matter.MatterId}`,
      file_number: matter.MatterFile || null,
      external_id: String(matter.MatterId),
      // The public InSite record page for this matter — see
      // resolveLegislationUrl() above. Null (never guessed) when
      // resolution failed; see unresolvedLegislationUrls's knownGaps entry.
      source_url: legislationUrl,
    });

    const voteEventId = `legistar-${clientConfig.client}-voteevent-${actedRecord.MatterHistoryId}`;
    voteEvents.push({
      id: voteEventId,
      agenda_item_id: agendaItemId,
      result: actedRecord.MatterHistoryPassedFlagName || String(actedRecord.MatterHistoryPassedFlag),
      date: actionDate,
    });

    for (const v of rawVotes) {
      const value = mapVoteValue(v.VoteValueName);
      if (!value) {
        unmappedVoteValues.add(v.VoteValueName ?? "(null)");
        continue;
      }
      const holding = findHoldingForVote(holdings, v.VotePersonId, primaryBodyId, actionDate);
      if (!holding) {
        unmatchedVoters.add(`${v.VotePersonName} (Legistar PersonId ${v.VotePersonId})`);
        continue;
      }
      votes.push({
        id: `legistar-${clientConfig.client}-vote-${v.VoteId}`,
        vote_event_id: voteEventId,
        holding_id: holding.id,
        value,
      });
    }
  }

  const historiesSnapshot = await snapshotRaw(clientConfig.client, "histories-and-votes-window", rawHistoriesAndVotes);
  contentHashEntries.push({ name: "histories-and-votes-window", hash: historiesSnapshot.hash });

  if (unmappedVoteValues.size) {
    knownGaps.push(
      `Unmapped Legistar VoteValueName value(s) dropped from Vote[] for ${clientConfig.client} (not counted toward any ` +
        `tally): ${[...unmappedVoteValues].join(", ")}.`,
    );
  }
  if (unmatchedVoters.size) {
    knownGaps.push(
      `${unmatchedVoters.size} distinct voter(s) on ${clientConfig.client} matters in this window could not be matched to ` +
        `a current officerecords-derived holding on ${primaryBodyName} and were dropped from Vote[]: ` +
        `${[...unmatchedVoters].slice(0, 10).join("; ")}${unmatchedVoters.size > 10 ? ", …" : ""}.`,
    );
  }
  if (unresolvedLegislationUrls.size) {
    knownGaps.push(
      `Could not resolve a public InSite source_url for ${unresolvedLegislationUrls.size} matter(s) on ${clientConfig.client} ` +
        `(agendaItem.source_url is null for these — the record itself still ingested): ` +
        `${[...unresolvedLegislationUrls].slice(0, 10).join(", ")}${unresolvedLegislationUrls.size > 10 ? ", …" : ""}.`,
    );
  }

  return {
    meetings: [...meetings.values()],
    agendaItems,
    voteEvents,
    votes,
    knownGaps,
    mattersFound: matters.length,
    mattersProcessed: workingMatters.length,
    contentHashEntries,
  };
}

// Full per-client ingest: bodies + persons/offices/holdings (from
// officerecords) + a bounded votes window on the primary legislative body.
// Throws on any failure — callers fall back to the honest empty-state
// output per AGENTS.md §0.3/§3.1, never a partial or fabricated one.
async function ingestClient(clientConfig) {
  const token = resolveToken(clientConfig);
  const runDate = new Date();
  const runIso = runDate.toISOString().slice(0, 10);
  const jurisdictionMeta = JURISDICTION_META[clientConfig.client] ?? {
    jurisdictionId: `legistar-${clientConfig.client}`,
    ocdId: null,
  };
  const knownGaps = [];
  if (!jurisdictionMeta.ocdId) {
    knownGaps.push(`No OCD division id on record for client "${clientConfig.client}" — jurisdiction_id is a repo-local key only.`);
  } else {
    knownGaps.push(
      `jurisdiction ocd_id (${jurisdictionMeta.ocdId}) follows the documented OCD naming convention but has not been ` +
        `independently checked against OCD's own boundary/division service.`,
    );
  }

  const bodiesRaw = await getBodies(clientConfig.client, { token });
  const personsRaw = await getPersons(clientConfig.client, { token });
  const officeRecordsRaw = await getOfficeRecords(clientConfig.client, { token });
  const bodiesSnapshot = await snapshotRaw(clientConfig.client, "bodies", bodiesRaw);
  const personsSnapshot = await snapshotRaw(clientConfig.client, "persons", personsRaw);
  const officeRecordsSnapshot = await snapshotRaw(clientConfig.client, "officerecords", officeRecordsRaw);
  const contentHashEntries = [
    { name: "bodies", hash: bodiesSnapshot.hash },
    { name: "persons", hash: personsSnapshot.hash },
    { name: "officerecords", hash: officeRecordsSnapshot.hash },
  ];

  const officeRecordsSourceUrl = `${LEGISTAR_BASE}/${clientConfig.client}/officerecords`;

  const bodyMeta = bodiesRaw.map((b) => ({
    BodyId: b.BodyId,
    BodyName: b.BodyName,
    BodyTypeName: b.BodyTypeName,
    BodyActiveFlag: b.BodyActiveFlag,
  }));

  const bodies = bodiesRaw
    .filter((b) => !EXCLUDED_BODY_NAMES.has((b.BodyName || "").trim()))
    .map((b) => ({
      id: `legistar-${clientConfig.client}-body-${b.BodyId}`,
      jurisdiction_id: jurisdictionMeta.jurisdictionId,
      name: b.BodyName,
    }));

  const { offices, persons, holdings, droppedTitles, droppedBodies, droppedNoStartDate } = buildOfficesPersonsHoldings(
    clientConfig,
    officeRecordsRaw,
    jurisdictionMeta.jurisdictionId,
    runIso,
    officeRecordsSourceUrl,
  );

  if (droppedTitles.length) {
    knownGaps.push(
      `officerecords rows dropped for lacking a recognized officeholder title (staff/clerk/unclassified roles, per ` +
        `AGENTS.md §1b) — titles seen and dropped: ${droppedTitles.join(", ")}.`,
    );
  }
  if (droppedBodies.length) {
    knownGaps.push(`officerecords rows dropped for belonging to a non-governing/internal body: ${droppedBodies.join(", ")}.`);
  }
  if (droppedNoStartDate > 0) {
    knownGaps.push(`${droppedNoStartDate} officerecords row(s) dropped for missing a start date (no Holding without one).`);
  }
  knownGaps.push(
    "Office here models 'membership in a Legistar body under a given title', not a per-seat/ward electoral district — " +
      "these two clients' officerecords endpoint does not expose per-seat identifiers. See wards.geojson / " +
      "commissioners.geojson for seat-level geography.",
  );

  if (!offices.length || !holdings.length) {
    throw new Error(
      `No holdings survived the officeholder filter for ${clientConfig.client} — refusing to write an output claiming coverage.`,
    );
  }

  const { primaryBodyId, primaryBodyName, windowStartIso, knownGaps: windowGaps } = determineVoteWindow(
    clientConfig,
    holdings,
    bodyMeta,
    runDate,
  );
  knownGaps.push(...windowGaps);

  const windowEndIso = addDays(runDate, 1); // dateRangeFilter's end bound is exclusive ('lt')

  let voteResult = {
    meetings: [],
    agendaItems: [],
    voteEvents: [],
    votes: [],
    knownGaps: [],
    mattersFound: 0,
    mattersProcessed: 0,
    contentHashEntries: [],
  };
  if (primaryBodyId && windowStartIso) {
    voteResult = await buildVotesForWindow(clientConfig, token, {
      primaryBodyId,
      primaryBodyName,
      windowStartIso,
      windowEndIso,
      holdings,
    });
  }
  knownGaps.push(...voteResult.knownGaps);
  contentHashEntries.push(...voteResult.contentHashEntries);

  return {
    jurisdictionId: jurisdictionMeta.jurisdictionId,
    bodies,
    persons: persons.map(stripInternal),
    offices: offices.map(stripInternal),
    holdings: holdings.map(stripInternal),
    meetings: voteResult.meetings,
    agendaItems: voteResult.agendaItems,
    voteEvents: voteResult.voteEvents,
    votes: voteResult.votes,
    knownGaps,
    voteWindow: {
      primaryBodyName,
      windowStartIso,
      windowEndIso,
      mattersFound: voteResult.mattersFound,
      mattersProcessed: voteResult.mattersProcessed,
    },
    // One combined hash over every raw resource this run actually fetched
    // (bodies/persons/officerecords always; matters-window and
    // histories-and-votes-window too, when the vote walk ran) — see
    // combineSnapshotHashes() above. Threaded into buildIngestedState()'s
    // provenance.contentHash instead of the `null` placeholder it used to
    // ship with even when real data had been ingested.
    contentHash: combineSnapshotHashes(contentHashEntries),
  };
}

function buildIngestedState(clientConfig, ingest) {
  return {
    schemaVersion: 1,
    client: clientConfig.client,
    jurisdiction: clientConfig.jurisdiction,
    generatedAt: new Date().toISOString(),
    status: "ingested",
    note:
      `Full ingest: ${ingest.holdings.length} holding(s) across ${ingest.offices.length} office(s) and ` +
      `${ingest.persons.length} person(s), from officerecords. Votes windowed to ` +
      `${ingest.voteWindow.windowStartIso}–${ingest.voteWindow.windowEndIso} on ` +
      `"${ingest.voteWindow.primaryBodyName ?? "unknown body"}": ${ingest.voteWindow.mattersProcessed}/` +
      `${ingest.voteWindow.mattersFound} matter(s) processed, ${ingest.voteEvents.length} vote event(s), ` +
      `${ingest.votes.length} vote(s).`,
    provenance: {
      primarySourceUrl: `${LEGISTAR_BASE}/${clientConfig.client}`,
      sourceAgency: clientConfig.jurisdiction,
      documentType: "Legistar Web API",
      documentId: null,
      issuedDate: null,
      fetchedAt: new Date().toISOString(),
      licence:
        "Public records served via Legistar InSite; no separate machine-reuse licence published by the host jurisdiction as of this writing.",
      // sha256 over every raw resource this run fetched (bodies, persons,
      // officerecords, and the votes-window resources when that ran) — see
      // combineSnapshotHashes() / ingestClient() above. A later run
      // producing the same hash means upstream hasn't actually changed;
      // this is the one thing that lets that be verified without diffing
      // full raw snapshots by hand.
      contentHash: ingest.contentHash,
    },
    jurisdiction_id: ingest.jurisdictionId,
    // Body[] / Person[] / Office[] / Holding[] / Meeting[] / AgendaItem[] /
    // VoteEvent[] / Vote[] — see src/lib/models.ts. VoteEvent/Vote here
    // follow models.ts's holding_id-attached shape (not types.ts's Phase 2
    // HoldingRef-based shape) — see this file's own header and models.ts's
    // "NOTE (2026-08-06)" comment for why the two aren't merged.
    bodies: ingest.bodies,
    persons: ingest.persons,
    offices: ingest.offices,
    holdings: ingest.holdings,
    meetings: ingest.meetings,
    agendaItems: ingest.agendaItems,
    voteEvents: ingest.voteEvents,
    votes: ingest.votes,
    knownGaps: ingest.knownGaps,
  };
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
      // Genuinely null here, not a gap: this is the probe/failure path
      // (see buildIngestedState() for the success path's real hash) — a
      // reachability probe or a failed run fetched no substantive raw
      // content, so there's nothing honest to hash.
      contentHash: null,
    },
    // Holding[] — see src/lib/models.ts. Always empty until the follow-up
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
      console.log(`[legistar:${clientConfig.client}] reachable (sample bodies page returned ${sampleCount} row(s)). Starting full ingest...`);

      const ingest = await ingestClient(clientConfig);
      const state = buildIngestedState(clientConfig, ingest);
      const outputPath = await writeClientOutput(clientConfig, state);
      console.log(
        `[legistar:${clientConfig.client}] ingested ${ingest.holdings.length} holding(s), ${ingest.voteEvents.length} ` +
          `vote event(s), ${ingest.votes.length} vote(s). Wrote ${outputPath}`,
      );
    } catch (err) {
      anyFailures = true;
      const isAuthError = err instanceof LegistarAuthError;
      const reason = isAuthError ? "requires a token this run doesn't have" : "ingest failed (network error, unexpected response, or filter left nothing publishable)";
      console.error(`[legistar:${clientConfig.client}] ${reason}: ${err.message}`);
      const state = buildEmptyState(clientConfig, {
        status: isAuthError ? "auth_required" : "unreachable",
        note: `Full-ingest run failed at ${new Date().toISOString()}: ${err.message}`,
        fetchedAt: null,
      });
      const outputPath = await writeClientOutput(clientConfig, state);
      console.log(`[legistar:${clientConfig.client}] left honest empty-state scaffold in place at ${outputPath}`);
    }
  }

  if (anyFailures) {
    console.log(
      "[legistar] one or more clients failed full ingest this run. " +
        "That's a known gap, not a build failure — see the knownGaps/note fields written above. Exiting cleanly.",
    );
  } else {
    console.log("[legistar] all configured clients ingested successfully.");
  }

  // Always exit 0: an upstream API being unreachable, rate-limited, or
  // requiring a token this run doesn't have is a refresh-mechanism failure,
  // never a build failure (AGENTS.md §0.8/§3.2).
  process.exit(0);
}

// Entry-point guard: only run the live ingest when this file is executed
// directly (`node scripts/ingest/legistar.mjs`, i.e. `npm run data:legistar`),
// never as a side effect of `import`ing it. Without this, legistar.test.mjs
// importing the pure helpers below would trigger a full live run — hundreds
// of paginated requests against the real Legistar API and an overwrite of
// public/legistar/*.json — every time `node --test` runs, which is both bad
// citizenship (AGENTS.md §2.2) toward an upstream API and not what a unit
// test file should ever do as a side effect of importing its module.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // Should be unreachable — every expected failure mode is caught per
    // client above — but if something truly unexpected happens, still don't
    // take the build down with it.
    console.error("[legistar] unexpected top-level error (not fabricating output):", err);
    process.exit(0);
  });
}
