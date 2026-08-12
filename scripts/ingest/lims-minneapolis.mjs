#!/usr/bin/env node
// scripts/ingest/lims-minneapolis.mjs
//
// Minneapolis meetings/agenda ingest — LIMS API v1 (lims.minneapolismn.gov).
// Issue #102: Minneapolis runs LIMS/DataNet, not Legistar, so it needs its
// own ingest script rather than an extra client in scripts/ingest/
// legistar.mjs. Writes public/lims/minneapolis-meetings.json in the same
// MeetingsFeed shape src/lib/meetingsRegistry.ts declares (Meeting[] /
// MeetingAgendaItem[]), so src/app/(content)/meetings/page.tsx can render
// it exactly like the St. Paul and Hennepin County Legistar feeds — see
// that file's own comment on why the import path has to be a literal
// string kept in sync with MEETINGS_JURISDICTIONS by hand.
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
// CONFIRMED LIVE 2026-08-11 (first registered key, cross-checked against
// LIMS's own published docs at lims.minneapolismn.gov/v2/api — that page
// sits behind a Cloudflare managed JS challenge no scripted client can
// solve, see LESSONS.md; a maintainer read it in a browser and pasted the
// route list back). Base URL is lowercase `/api/v1` (FEATURES.md's
// `/API/v1` 403s — looks like an auth failure, is actually routing). Auth
// is a plain `Authorization: Bearer <key>` header, not an `api_key` query
// param and not `Ocp-Apim-Subscription-Key`. See LESSONS.md's LIMS entry
// for the full path-guessing history this superseded.
//
// Two endpoint families:
//   - referenceList/* — GET, no request body. CouncilMembers, CouncilTerm
//     (singular — CouncilTerms 404s), MeetingBodies, FileItemStatus,
//     FileTypes.
//   - search/* — POST, JSON request body, year-scoped. meetingCalendar
//     (meetings by CalendarYear, 2017+), FileItemSearch (agenda items by
//     CalendarYear, 2014+, each with embedded LegislativeHistory +
//     VotingInformation), CouncilMemberVotingRecord (per-member, not used
//     here — FileItemSearch's embedded voting info already covers what
//     the meetings page needs without a second per-member fetch loop),
//     OrdinancesIntroductions / LatestEnactedOrdinances (last-30-days,
//     no year param — not used here; the meetings/agenda page needs the
//     year-scoped feeds, not a rolling 30-day ordinance list).
//
// NOT IMPLEMENTED YET, left as known gaps rather than guessed at:
//   - Consent-agenda flagging: LIMS's FileItemSearch response has no
//     field structurally equivalent to Legistar's EventItemConsent. Every
//     agenda item here ships isConsent: false rather than a guess — same
//     honesty call St. Paul/Hennepin's own registry coverage note makes
//     for "no discussion" / "no public comment" flags neither has either.
//   - Diff-on-refresh (AGENTS.md §0.5): scripts/ingest/legistar.mjs's
//     diffMeetings() is real engineering against a shape this script
//     doesn't share closely enough to reuse directly. Follow-up, not
//     silently skipped — flagged in knownGaps on every live run.
//   - Per-member Holding/Vote resolution into the canonical models.ts
//     shape (what buildVotesForWindow() does for Legistar): out of scope
//     for the meetings/agenda page itself, which only needs Meeting[] and
//     MeetingAgendaItem[].

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Shared with the Legistar ingest rather than reimplemented — both are
// plain pure functions with no live-fetch side effects on import (see
// legistar.mjs's own entry-point guard at the bottom of that file).
import { slugify, addDays as addDaysToDate, selectNextMeeting as selectNextMeetingFor } from "./legistar.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../../public/lims");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "minneapolis-meetings.json");
const NEXT_MEETING_PATH = path.join(OUTPUT_DIR, "minneapolis-next-meeting.json");

// The full City Council (as opposed to a committee/subcommittee/board) —
// mirrors legistar.mjs's primaryBodyName concept for selectNextMeeting()
// below, and WardModal.tsx's NEXT_MEETING_TEASERS isPrimaryBody labeling.
const PRIMARY_BODY_NAME = "City Council";

const CLIENT = "minneapolis";
const JURISDICTION = "Minneapolis City Council";
const SOURCE_AGENCY = "City of Minneapolis, Office of the City Clerk";
const PRIMARY_SOURCE_URL = "https://lims.minneapolismn.gov/";

const BASE_URL = "https://lims.minneapolismn.gov/api/v1";

const ENDPOINTS = {
  councilMembers: "/referenceList/CouncilMembers",
  councilTerm: "/referenceList/CouncilTerm",
  meetingBodies: "/referenceList/MeetingBodies",
  fileItemStatus: "/referenceList/FileItemStatus",
  fileTypes: "/referenceList/FileTypes",
  meetingCalendar: "/search/meetingCalendar",
  fileItemSearch: "/search/FileItemSearch",
};

// AGENTS.md §2.2 Good-Citizen Fetcher — descriptive User-Agent + contact.
const USER_AGENT =
  "wealldobettermn-ingest/1.0 (+https://github.com/ngabantudev/wealldobettermn; civic transparency data pull, low volume, contact via repo issues)";

// Same rolling-window convention as scripts/ingest/legistar.mjs's
// MEETINGS_LOOKBACK_DAYS/MEETINGS_LOOKAHEAD_DAYS — kept in sync by
// comment, not by import, since the two scripts don't share a module.
const LOOKBACK_DAYS = 14;
const LOOKAHEAD_DAYS = 90;

// meetingCalendar/FileItemSearch are scoped by whole calendar year, so a
// day-precision window can straddle a year boundary (e.g. a lookback into
// December from early January). Collects every year touched by the
// window rather than assuming "this year" is enough.
function yearsInWindow(windowStartIso, windowEndIso) {
  const startYear = Number(windowStartIso.slice(0, 4));
  const endYear = Number(windowEndIso.slice(0, 4));
  const years = [];
  for (let y = startYear; y <= endYear; y += 1) years.push(y);
  return years;
}

// legistar.mjs's addDays() takes a Date, not an ISO string — this repo's
// two ingest scripts' window math differs by that one input type.
function addDays(dateIso, days) {
  return addDaysToDate(new Date(`${dateIso}T00:00:00Z`), days);
}

/**
 * GET a referenceList endpoint.
 * @param {string} pathname
 * @param {string} apiKey
 */
async function getLims(pathname, apiKey) {
  // Not `new URL(pathname, base)` — a leading "/" in pathname resolves
  // absolute-from-origin and silently drops BASE_URL's "/api/v1", which
  // 403s in a way that looks like an auth failure rather than a routing
  // bug (cost real debugging time before this comment existed).
  const url = new URL(`${BASE_URL}${pathname}`);
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!res.ok) {
    throw new Error(`LIMS GET failed: ${res.status} ${res.statusText} — ${url}`);
  }
  return res.json();
}

/**
 * POST a search endpoint with a JSON body.
 * @param {string} pathname
 * @param {string} apiKey
 * @param {Record<string, unknown>} body
 */
async function postLims(pathname, apiKey, body) {
  const url = new URL(`${BASE_URL}${pathname}`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LIMS POST failed: ${res.status} ${res.statusText} — ${url} — ${text}`);
  }
  return res.json();
}

/**
 * meetingCalendar rows include non-meeting calendar placeholders (city
 * holidays, "Select Meeting Type" rows with AgendaURL pointing at file id
 * 0 and no MembersList) — these are LIMS's own calendar noise, not real
 * meetings, and are dropped rather than rendered as fake meetings
 * (AGENTS.md §3.1).
 */
function isRealMeeting(row) {
  if (row.MeetingType === "Select Meeting Type" && (row.MembersList ?? []).length === 0) return false;
  return true;
}

function normalizeUrl(url) {
  if (!url || typeof url !== "string") return null;
  // Placeholder AgendaURL/MinutesPDFURL values end in "/0" (no real file
  // id behind them) — same reasoning as isRealMeeting() above.
  if (/\/0$/.test(url)) return null;
  return url;
}

async function writeNextMeetingTeaser(nextMeeting) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(NEXT_MEETING_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), nextMeeting }, null, 2)}\n`, "utf8");
}

function mapMeetingCalendarRow(row) {
  const dateIso = typeof row.MeetingDateTime === "string" ? row.MeetingDateTime.slice(0, 10) : null;
  const bodyId = `lims-${CLIENT}-body-${slugify(row.MeetingBody)}`;
  const id = `lims-${CLIENT}-meeting-${slugify(row.MeetingBody)}-${row.MeetingDateTime}`;
  return {
    id,
    body_id: bodyId,
    bodyName: row.MeetingBody || null,
    date: dateIso,
    time: typeof row.MeetingDateTime === "string" ? row.MeetingDateTime.slice(11, 16) || null : null,
    location: null, // not present in meetingCalendar's response
    agendaStatus: row.IsCancelled ? "Cancelled" : null,
    agendaUrl: normalizeUrl(row.AgendaURL),
    minutesUrl: normalizeUrl(row.MinutesPDFURL),
    videoStatus: null, // not present in meetingCalendar's response
    sourceUrl: normalizeUrl(row.AgendaURL),
    lastModifiedUtc: null, // not present in meetingCalendar's response
  };
}

/**
 * Builds a lookup from (committee name, action date) to a real meeting id
 * from the already-ingested meetings list, so FileItemSearch's
 * LegislativeHistory rows — which carry a committee name + date but no
 * meeting id of their own — link to the right Meeting record. Falls back
 * to a synthesized meeting id (never a fabricated one — same
 * name+date-derived id a real meetingCalendar row for that committee/date
 * would have gotten) when no matching row was in this run's meeting
 * window, which is flagged in knownGaps rather than silently dropped.
 */
// meetingCalendar's MeetingBody and FileItemSearch's CommitteeName are
// both free-text names from the same underlying LIMS body records, but
// nothing guarantees byte-identical strings between the two endpoints —
// normalizing "&" to "and" and collapsing whitespace/case catches the one
// inconsistency actually observed in LIMS's own data without attempting
// a full alias table for a mismatch that hasn't been confirmed to exist
// beyond this.
function normalizeBodyName(name) {
  return String(name)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\s+/g, " ")
    .trim();
}

function buildMeetingLookup(meetings) {
  const byKey = new Map();
  for (const m of meetings) {
    if (!m.bodyName || !m.date) continue;
    byKey.set(`${normalizeBodyName(m.bodyName)}|${m.date}`, m.id);
  }
  return byKey;
}

// LIMS returns free-text fields (ItemTitle, FileSubject, Action) with
// literal HTML entities still encoded ("Mayor&#39;s nomination",
// "Council&rsquo;s legislative process") rather than decoded text —
// confirmed live against a full year of FileItemSearch data (26/225
// in-window agenda items affected). React text nodes don't decode HTML
// entities (that's the correct, safe default — text content isn't parsed
// as markup), so left as-is these would render as the literal
// "&#39;"/"&rsquo;" characters instead of an apostrophe/quote. Named-
// entity table covers what's actually been observed; numeric entities
// (decimal and hex) are decoded generically since LIMS's source system
// is evidently passing through whatever its own rich-text editor stored.
const HTML_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

function decodeHtmlEntities(value) {
  if (typeof value !== "string" || !value.includes("&")) return value;
  return value.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === "#") {
      const codePoint = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return HTML_ENTITIES[entity] ?? match; // unrecognized named entity — leave as-is, never guess
  });
}

function toIsoFromMdY(value) {
  // LegislativeHistory's ActionDate comes back "M/D/YYYY" — different
  // format from meetingCalendar's ISO MeetingDateTime.
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, m, d, y] = match;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function mapFileItemToAgendaItems(item, itemIndex, meetingLookup, unmatchedMeetings, windowStartIso, windowEndIso) {
  const agendaItems = [];
  const history = Array.isArray(item.LegislativeHistory) ? item.LegislativeHistory : [];
  history.forEach((historyRow, index) => {
    if (!historyRow.CommitteeName) return; // e.g. "Published" rows carry no committee/vote — not agenda items
    const actionDateIso = toIsoFromMdY(historyRow.ActionDate);
    if (!actionDateIso) return;
    // FileItemSearch is fetched for the whole calendar year (its own
    // filter granularity), but meetings[] only covers the rolling
    // LOOKBACK_DAYS/LOOKAHEAD_DAYS window — without this, most items
    // would get a synthesized meeting_id that never matches a real
    // Meeting record, bloating the output with agenda items the page can
    // never actually attach to a rendered meeting.
    if (actionDateIso < windowStartIso || actionDateIso > windowEndIso) return;

    const lookupKey = `${normalizeBodyName(historyRow.CommitteeName)}|${actionDateIso}`;
    let meetingId = meetingLookup.get(lookupKey);
    if (!meetingId) {
      meetingId = `lims-${CLIENT}-meeting-${slugify(historyRow.CommitteeName)}-${actionDateIso}T00:00:00`;
      unmatchedMeetings.add(`${historyRow.CommitteeName} (${actionDateIso})`);
    }

    agendaItems.push({
      // Not FileNumber alone: FileItemSearch returns multiple distinct
      // items sharing one FileNumber (e.g. several officer-election
      // resolutions all filed under the same organizational-meeting file
      // number) — itemIndex (this item's position in the full response)
      // plus the history-row index is what's actually unique per item.
      id: `lims-${CLIENT}-fileitem-${itemIndex}-${index}`,
      meeting_id: meetingId,
      sequence: null, // not present in FileItemSearch's response
      agendaNumber: item.ActNumber || null,
      title: decodeHtmlEntities(item.ItemTitle || item.FileSubject || `File ${item.FileNumber}`),
      // Not implemented — see file header. Left false, never guessed.
      isConsent: false,
      actionName: decodeHtmlEntities(historyRow.Action) || null,
      passedFlagName: historyRow.VotingInformation?.VoteResult || null,
      matterFile: item.FileNumber || null,
      matterId: null, // LIMS exposes FileNumber (string), not a numeric matter id
      matterType: item.FileType || null,
    });
  });
  return agendaItems;
}

/**
 * True if OUTPUT_PATH already holds a real ingested run. Guards
 * writeEmptyState() from silently wiping known-good data if this script
 * ever runs again without LIMS_API_KEY set (secret rotation glitch, env
 * var typo) after a previous run succeeded — same "never overwrite
 * known-good data with a worse result" rule the catch block in main()
 * already follows for a failed live fetch.
 */
async function hasExistingRealData() {
  try {
    const raw = await readFile(OUTPUT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed.status === "ingested" && Array.isArray(parsed.meetings) && parsed.meetings.length > 0;
  } catch {
    return false; // file doesn't exist yet, or isn't valid JSON — safe to write the empty state
  }
}

async function writeEmptyState(reason) {
  if (await hasExistingRealData()) {
    console.log(
      `[lims-minneapolis] LIMS_API_KEY is not set, but ${OUTPUT_PATH} already holds a real ingested run — ` +
        "leaving it untouched rather than overwriting known-good data with an empty state.",
    );
    return null;
  }
  const emptyState = {
    schemaVersion: 1,
    client: CLIENT,
    jurisdiction: JURISDICTION,
    generatedAt: new Date().toISOString(),
    status: "auth_required",
    note: reason,
    provenance: {
      primarySourceUrl: PRIMARY_SOURCE_URL,
      sourceAgency: SOURCE_AGENCY,
      documentType: "LIMS API v1 — meetingCalendar/FileItemSearch",
      documentId: null,
      issuedDate: null,
      fetchedAt: new Date().toISOString(),
      licence: "Public records served via the City of Minneapolis LIMS API; no separate machine-reuse licence published as of this writing.",
      contentHash: null,
    },
    window: null,
    meetings: [],
    agendaItems: [],
    diff: null,
    previousGeneratedAt: null,
    knownGaps: [reason],
  };
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(emptyState, null, 2)}\n`, "utf8");
  await writeNextMeetingTeaser(null);
  return emptyState;
}

async function main() {
  const apiKey = process.env.LIMS_API_KEY;

  if (!apiKey) {
    console.log(
      "[lims-minneapolis] LIMS_API_KEY is not set — skipping live fetch.\n" +
        "  Register a key at https://lims.minneapolismn.gov/ and set LIMS_API_KEY " +
        "to run a live fetch.\n" +
        `  Writing an honest empty state to ${OUTPUT_PATH} (AGENTS.md §3.1) unless it already holds a real ` +
        "ingested run, instead of failing the build or fabricating meeting/agenda data.",
    );
    await writeEmptyState("No LIMS_API_KEY provisioned — this run has never completed a live fetch.");
    return;
  }

  console.log("[lims-minneapolis] LIMS_API_KEY present — starting live fetch.");

  const today = new Date().toISOString().slice(0, 10);
  const windowStartIso = addDays(today, -LOOKBACK_DAYS);
  const windowEndIso = addDays(today, LOOKAHEAD_DAYS);
  const years = yearsInWindow(windowStartIso, windowEndIso);
  const knownGaps = [
    "Consent-agenda flagging not implemented — LIMS has no field structurally equivalent to Legistar's " +
      "EventItemConsent; every agenda item ships isConsent: false rather than a guess.",
    "Diff-on-refresh (AGENTS.md §0.5) not implemented yet for this feed — roster/meeting changes between " +
      "runs aren't surfaced the way St. Paul/Hennepin's Legistar feed does.",
  ];

  try {
    // Fetched to confirm connectivity/shape and logged below, but not
    // written to public/lims/minneapolis-meetings.json: this is
    // officeholder/roster data (AGENTS.md §1d/§3.2 require verifiedAt +
    // sourceUrl per record, and the UI to surface the verification date,
    // before a person record ships anywhere public) — mapping these into
    // real Holding rows is the follow-up this file's header already flags
    // as not implemented, not something to half-ship unverified.
    const [councilMembers, councilTerm, meetingBodies, fileItemStatus, fileTypes] = await Promise.all([
      getLims(ENDPOINTS.councilMembers, apiKey),
      getLims(ENDPOINTS.councilTerm, apiKey),
      getLims(ENDPOINTS.meetingBodies, apiKey),
      getLims(ENDPOINTS.fileItemStatus, apiKey),
      getLims(ENDPOINTS.fileTypes, apiKey),
    ]);
    const countOf = (value) => (Array.isArray(value) ? value.length : "?");
    console.log(
      `[lims-minneapolis] reference lists: ${countOf(councilMembers)} council member(s), ${countOf(councilTerm)} term(s), ` +
        `${countOf(meetingBodies)} meeting body(ies), ${countOf(fileItemStatus)} file item status(es), ${countOf(fileTypes)} file type(s).`,
    );

    // Sequential, not parallel, across years — no documented LIMS
    // rate-limit policy to design a concurrency budget against (AGENTS.md
    // §2.2 Good-Citizen Fetcher / LESSONS.md's Legistar rate-limit entry,
    // same caution applied to a new API).
    const allMeetingRows = [];
    const allFileItems = [];
    for (const year of years) {
      const calendarRows = await postLims(ENDPOINTS.meetingCalendar, apiKey, { CalendarYear: year });
      if (Array.isArray(calendarRows)) allMeetingRows.push(...calendarRows);
      const fileItems = await postLims(ENDPOINTS.fileItemSearch, apiKey, { CalendarYear: year });
      if (Array.isArray(fileItems)) allFileItems.push(...fileItems);
    }
    console.log(
      `[lims-minneapolis] fetched ${allMeetingRows.length} calendar row(s) and ${allFileItems.length} file item(s) ` +
        `across year(s) ${years.join(", ")}.`,
    );

    const meetings = allMeetingRows
      .filter(isRealMeeting)
      .map(mapMeetingCalendarRow)
      .filter((m) => m.date && m.date >= windowStartIso && m.date <= windowEndIso);

    const meetingLookup = buildMeetingLookup(meetings);
    const unmatchedMeetings = new Set();
    const agendaItems = allFileItems.flatMap((item, itemIndex) =>
      mapFileItemToAgendaItems(item, itemIndex, meetingLookup, unmatchedMeetings, windowStartIso, windowEndIso),
    );

    if (unmatchedMeetings.size) {
      knownGaps.push(
        `${unmatchedMeetings.size} agenda item legislative-history row(s) referenced a committee/date not present in ` +
          `this run's meeting window; a synthesized meeting id was used for these so the agenda items still render: ` +
          `${[...unmatchedMeetings].slice(0, 10).join("; ")}${unmatchedMeetings.size > 10 ? ", …" : ""}.`,
      );
    }

    const state = {
      schemaVersion: 1,
      client: CLIENT,
      jurisdiction: JURISDICTION,
      generatedAt: new Date().toISOString(),
      status: "ingested",
      note: `${meetings.length} meeting(s) and ${agendaItems.length} agenda item(s) ingested for ${windowStartIso}–${windowEndIso}.`,
      provenance: {
        // Not a raw ENDPOINTS URL: search/meetingCalendar is POST-only and
        // needs a bearer token, so it 404s/401s for anyone who clicks the
        // "raw feed" link the meetings/recap pages render from this field
        // (AGENTS.md §3.3: "a citation that 404s in eighteen months is not
        // a citation" — this one would 404 immediately, not eighteen
        // months from now). PRIMARY_SOURCE_URL is the public LIMS site.
        primarySourceUrl: PRIMARY_SOURCE_URL,
        sourceAgency: SOURCE_AGENCY,
        documentType: "LIMS API v1 — meetingCalendar/FileItemSearch",
        documentId: null,
        issuedDate: null,
        fetchedAt: new Date().toISOString(),
        licence: "Public records served via the City of Minneapolis LIMS API; no separate machine-reuse licence published as of this writing.",
        contentHash: null,
      },
      window: { startIso: windowStartIso, endIso: windowEndIso },
      meetings,
      agendaItems,
      diff: null,
      previousGeneratedAt: null,
      knownGaps,
    };

    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    // Never promote a cancelled meeting (LIMS's IsCancelled ->
    // agendaStatus "Cancelled") to the teaser WardModal.tsx renders as
    // "Next meeting" — a resident reading that card has no other
    // cancellation signal, and this feed's UI doesn't surface
    // agendaStatus anywhere else (same gap Legistar's own agendaStatus
    // field has site-wide, but the next-meeting teaser is the one spot
    // that actively tells someone to show up).
    const nextMeetingCandidates = meetings.filter((m) => m.agendaStatus !== "Cancelled");
    const nextMeeting = selectNextMeetingFor({ client: CLIENT, jurisdiction: JURISDICTION }, nextMeetingCandidates, today, PRIMARY_BODY_NAME);
    await writeNextMeetingTeaser(nextMeeting);
    console.log(
      `[lims-minneapolis] wrote ${OUTPUT_PATH}. next meeting: ${nextMeeting ? nextMeeting.date : "none upcoming"}. ` +
        `Wrote ${NEXT_MEETING_PATH}`,
    );
  } catch (err) {
    console.error("[lims-minneapolis] live fetch did not complete:", err instanceof Error ? err.message : err);
    console.error(
      "[lims-minneapolis] leaving the existing public/lims/minneapolis-meetings.json untouched " +
        "rather than overwriting known-good (or honestly empty) data with a partial result.",
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
