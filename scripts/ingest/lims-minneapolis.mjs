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
// RATE-LIMIT / SCOPE POSTURE: this script is a build-time ingest, not a
// runtime dependency — every visitor to /meetings, WardModal's next-
// meeting teaser, and /recap reads the static JSON this script commits
// to public/lims/, via Cloudflare's ASSETS binding. No site visitor ever
// triggers a live LIMS request; only a maintainer (or a future scheduled
// CI job — none exists yet) running `npm run data:minneapolis-lims`
// does, so user traffic can never approach LIMS's (undocumented) rate
// limit. MIN_REFETCH_INTERVAL_MS below guards the one remaining risk:
// this script itself being re-run repeatedly in a short window (a retry
// loop, a misconfigured cron, running it twice by hand). This key is
// also structurally single-city: BASE_URL is hardcoded to
// lims.minneapolismn.gov, Minneapolis's own LIMS/DataNet deployment —
// unlike Legistar (a SaaS vendor multiple cities separately subscribe to
// under their own {client}.legistar.com subdomain), LIMS isn't shared
// regional infrastructure, so there's no other jurisdiction this key
// could be pointed at even by mistake. public/jurisdiction-platform-
// inventory.json confirms every other tracked city is still platform
// "unknown" (never probed) — none are known to run LIMS.
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
// Two endpoint families (documenting the full confirmed surface, even
// though ENDPOINTS below only lists the two this script actually calls
// — see RATE-LIMIT / SCOPE POSTURE above for why):
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
//   - Per-member Holding/Vote resolution into the canonical models.ts
//     shape (what buildVotesForWindow() does for Legistar): still out of
//     scope for this file's own output — meetings/agendaItems only.
//     scripts/lib/limsRecentVotes.mjs does resolve the raw memberName/
//     value pairs this file writes on each agenda item into
//     RepProperties.recentVotes (surname-matched, same convention
//     scripts/lib/legistarRecentVotes.mjs already uses for St. Paul/
//     Hennepin) — that's real per-councilmember vote data reaching
//     WardModal.tsx, just not yet the canonical models.ts Holding/Vote
//     shape a future roster-diff/holdings pass would need.
//
// Diff-on-refresh (AGENTS.md §0.5) IS implemented, reusing
// scripts/ingest/legistar.mjs's exported diffMeetings() — its
// MEETING_DIFF_FIELDS (date/time/location/agendaStatus/agendaUrl/
// minutesUrl) are exactly the fields mapMeetingCalendarRow() below
// produces, so no LIMS-specific reimplementation was needed.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Shared with the Legistar ingest rather than reimplemented — both are
// plain pure functions with no live-fetch side effects on import (see
// legistar.mjs's own entry-point guard at the bottom of that file).
import {
  slugify,
  addDays as addDaysToDate,
  normalizeTimeTo24h,
  selectMeetingsThisWeek,
  MEETINGS_TEASER_WINDOW_DAYS,
  diffMeetings,
} from "./legistar.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../../public/lims");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "minneapolis-meetings.json");
const MEETINGS_THIS_WEEK_PATH = path.join(OUTPUT_DIR, "minneapolis-meetings-this-week.json");

const CLIENT = "minneapolis";
const JURISDICTION = "Minneapolis City Council";
const SOURCE_AGENCY = "City of Minneapolis, Office of the City Clerk";
const PRIMARY_SOURCE_URL = "https://lims.minneapolismn.gov/";

const BASE_URL = "https://lims.minneapolismn.gov/api/v1";

// Per-file public record page. Unlike Legistar's Gateway.aspx redirect
// (scripts/ingest/legistar.mjs), LIMS's file-record URL is a direct,
// predictable pattern keyed on FileNumber — no API resolution needed.
const FILE_URL_BASE = "https://lims.minneapolismn.gov/File";

// Only the two endpoints the shipped meetings/agenda feature needs —
// see the file header's RATE-LIMIT / SCOPE POSTURE note for why the
// confirmed-live referenceList/* endpoints (CouncilMembers, CouncilTerm,
// MeetingBodies, FileItemStatus, FileTypes) aren't called here. Revisit
// this list when a future PR maps them into holdings.
const ENDPOINTS = {
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

// Refuses a live re-fetch within this long of the previous successful
// run — the "run it twice by hand" / "misconfigured cron" guard the file
// header's RATE-LIMIT / SCOPE POSTURE note describes. 30 minutes is
// generous relative to how often this data actually changes (agenda
// items publish ~2 hours after a meeting per FEATURES.md's own Phase 3
// notes) while still letting a maintainer force a near-immediate re-run
// by deleting/renaming the output file if they genuinely need to.
const MIN_REFETCH_INTERVAL_MS = 30 * 60 * 1000;

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
 * POST a search endpoint with a JSON body.
 * @param {string} pathname
 * @param {string} apiKey
 * @param {Record<string, unknown>} body
 */
async function postLims(pathname, apiKey, body) {
  // Not `new URL(pathname, base)` — a leading "/" in pathname resolves
  // absolute-from-origin and silently drops BASE_URL's "/api/v1", which
  // 403s in a way that looks like an auth failure rather than a routing
  // bug (cost real debugging time before this comment existed).
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

async function writeMeetingsThisWeekTeaser(meetingsThisWeek) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(
    MEETINGS_THIS_WEEK_PATH,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), meetingsThisWeek }, null, 2)}\n`,
    "utf8",
  );
}

function mapMeetingCalendarRow(row) {
  const dateIso = typeof row.MeetingDateTime === "string" ? row.MeetingDateTime.slice(0, 10) : null;
  const bodyId = `lims-${CLIENT}-body-${slugify(row.MeetingBody)}`;
  const id = `lims-${CLIENT}-meeting-${slugify(row.MeetingBody)}-${row.MeetingDateTime}`;
  // LIMS's MeetingDateTime slice is already zero-padded 24-hour
  // ("15:30"), but routed through the same normalizer legistar.mjs's
  // mapEventToMeeting() uses for Legistar's 12-hour "3:30 PM" strings —
  // one shared normalization point rather than trusting each upstream's
  // raw format independently, so a sort or display bug in one vendor's
  // data can't reappear unnoticed in the other's.
  const rawTime = typeof row.MeetingDateTime === "string" ? row.MeetingDateTime.slice(11, 16) || null : null;
  // LIMS's own membership roster for this meeting — who serves on the
  // body, not a confirmed-attendance record (LIMS doesn't track actual
  // attendance any more than Legistar does). Empty array (never omitted)
  // when MembersList is absent/empty, so consumers can rely on it always
  // being an array rather than checking for undefined too.
  const members = (row.MembersList ?? [])
    .filter((m) => m.MemberId && m.MemberName)
    .map((m) => ({ id: m.MemberId, name: m.MemberName, type: m.MemberType || null }));
  return {
    id,
    body_id: bodyId,
    bodyName: row.MeetingBody || null,
    date: dateIso,
    time: normalizeTimeTo24h(rawTime),
    location: null, // not present in meetingCalendar's response
    agendaStatus: row.IsCancelled ? "Cancelled" : null,
    agendaUrl: normalizeUrl(row.AgendaURL),
    minutesUrl: normalizeUrl(row.MinutesPDFURL),
    videoStatus: null, // not present in meetingCalendar's response
    sourceUrl: normalizeUrl(row.AgendaURL),
    lastModifiedUtc: null, // not present in meetingCalendar's response
    members,
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

/**
 * Keyed by (body, date) only — FileItemSearch's LegislativeHistory rows
 * carry a date but no time, so a same-day second session for the same
 * body (a recessed/continued meeting — real, if uncommon) can't be
 * disambiguated from the agenda-item side no matter how this lookup is
 * keyed. What this function controls is which of the colliding meetings
 * wins the lookup slot: `meetings` is sorted by time first, so the
 * earliest same-day session wins deterministically (arbitrary but
 * reproducible) rather than "whichever the API happened to return last"
 * silently overwriting. Collisions are counted and returned so the
 * caller can flag them in knownGaps rather than let the ambiguity pass
 * unnoticed.
 */
function buildMeetingLookup(meetings) {
  const byKey = new Map();
  let collisions = 0;
  const sorted = [...meetings].sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  for (const m of sorted) {
    if (!m.bodyName || !m.date) continue;
    const key = `${normalizeBodyName(m.bodyName)}|${m.date}`;
    if (byKey.has(key)) {
      collisions += 1;
      continue; // keep the earlier (already-stored) session for this body/date
    }
    byKey.set(key, m.id);
  }
  return { byKey, collisions };
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
    // would reference a meeting outside meetings[], bloating the output
    // with agenda items the page can never actually attach to a
    // rendered meeting.
    if (actionDateIso < windowStartIso || actionDateIso > windowEndIso) return;

    const lookupKey = `${normalizeBodyName(historyRow.CommitteeName)}|${actionDateIso}`;
    const meetingId = meetingLookup.get(lookupKey);
    if (!meetingId) {
      // No real Meeting record for this (committee, date) — a committee-
      // name mismatch between meetingCalendar and FileItemSearch, or a
      // meeting the calendar endpoint simply didn't return. Per AGENTS.md
      // §3.1 ("no placeholder data ships as fact"), this item is dropped
      // rather than given a synthesized meeting_id that would look
      // exactly like a real one in the committed JSON with nothing
      // marking it synthetic — a synthesized foreign key is itself a
      // small fabrication, and every consumer (meetings/recap pages)
      // already null-checks a missing meeting, so dropping degrades
      // gracefully instead of rendering "date unknown, no source link"
      // for what may be a real, dated action. Counted for knownGaps.
      unmatchedMeetings.add(`${historyRow.CommitteeName} (${actionDateIso})`);
      return;
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
      // The bill's own public record page — not the meeting agenda it was
      // heard at. See FILE_URL_BASE comment above.
      fileUrl: item.FileNumber ? `${FILE_URL_BASE}/${item.FileNumber}` : null,
      // Raw member-name + vote-value pairs, kept as LIMS reports them
      // (confirmed vocabulary: Aye/Nay/Absent/Abstain — see LESSONS.md) —
      // normalization into this site's shared BillVote option vocabulary
      // happens in scripts/lib/limsRecentVotes.mjs, same layering
      // scripts/ingest/legistar.mjs's raw VoteValueName + scripts/lib/
      // legistarRecentVotes.mjs's second mapping pass already use. Empty
      // array (never omitted) when this history row has no roll call.
      votes: (historyRow.VotingInformation?.Votes ?? [])
        .filter((v) => v.MemberName && v.Vote)
        .map((v) => ({ memberName: v.MemberName, value: v.Vote })),
    });
  });
  return agendaItems;
}

/**
 * Reads and parses OUTPUT_PATH's previous run, or null if it doesn't
 * exist / isn't valid JSON. Shared by writeEmptyState()'s overwrite
 * guard, main()'s refetch-interval guard, and the diff-on-refresh step
 * below — one disk read per script invocation, not three.
 */
async function readExistingState() {
  try {
    const raw = await readFile(OUTPUT_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null; // file doesn't exist yet, or isn't valid JSON
  }
}

/**
 * True if OUTPUT_PATH already holds a real ingested run — status
 * "ingested" alone, deliberately NOT also requiring meetings.length > 0:
 * a genuinely empty rolling window (a council recess) is a valid
 * ingested result, not "no real data" — requiring a nonzero meetings
 * count here would let writeEmptyState() overwrite exactly that valid
 * result the next time LIMS_API_KEY goes missing, discarding real
 * provenance/knownGaps for a false "never completed a live fetch" state.
 * Guards writeEmptyState() from silently wiping known-good data if this
 * script ever runs again without LIMS_API_KEY set (secret rotation
 * glitch, env var typo) after a previous run succeeded — same "never
 * overwrite known-good data with a worse result" rule the catch block in
 * main() already follows for a failed live fetch.
 */
function isRealIngestedState(parsed) {
  return parsed?.status === "ingested" && Array.isArray(parsed?.meetings);
}

async function writeEmptyState(reason) {
  const existing = await readExistingState();
  if (isRealIngestedState(existing)) {
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
  await writeMeetingsThisWeekTeaser([]);
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

  const previous = await readExistingState();

  // MIN_REFETCH_INTERVAL_MS guard — see file header's RATE-LIMIT / SCOPE
  // POSTURE note. Only skips a genuinely-ingested previous run; an
  // "auth_required" empty state or a run more than the interval old
  // still triggers a live fetch normally.
  if (isRealIngestedState(previous) && typeof previous.generatedAt === "string") {
    const ageMs = Date.now() - new Date(previous.generatedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < MIN_REFETCH_INTERVAL_MS) {
      console.log(
        `[lims-minneapolis] last live fetch was ${Math.round(ageMs / 1000)}s ago, under the ` +
          `${MIN_REFETCH_INTERVAL_MS / 1000}s minimum refetch interval — skipping this run rather than ` +
          "hitting LIMS again. Delete public/lims/minneapolis-meetings.json first if you genuinely need an " +
          "immediate re-run.",
      );
      return;
    }
  }

  console.log("[lims-minneapolis] LIMS_API_KEY present — starting live fetch.");

  const today = new Date().toISOString().slice(0, 10);
  const windowStartIso = addDays(today, -LOOKBACK_DAYS);
  const windowEndIso = addDays(today, LOOKAHEAD_DAYS);
  const years = yearsInWindow(windowStartIso, windowEndIso);
  const knownGaps = [
    "Consent-agenda flagging not implemented — LIMS has no field structurally equivalent to Legistar's " +
      "EventItemConsent; every agenda item ships isConsent: false rather than a guess.",
  ];

  try {
    // Sequential, not parallel, across years and across the two
    // endpoints within a year — no documented LIMS rate-limit policy to
    // design a concurrency budget against (AGENTS.md §2.2 Good-Citizen
    // Fetcher / LESSONS.md's Legistar rate-limit entry, same caution
    // applied to a new API). Only the two endpoints the shipped
    // meetings/agenda feature actually needs are called — the five
    // referenceList/* endpoints (CouncilMembers, CouncilTerm,
    // MeetingBodies, FileItemStatus, FileTypes) aren't fetched here at
    // all: they'd be four extra requests per run powering nothing
    // downstream (meetingCalendar's own MeetingBody string is what
    // mapMeetingCalendarRow() uses, not a separate MeetingBodies lookup),
    // which is exactly the kind of request volume §2.2 asks scripts to
    // avoid. Revisit when a future PR actually maps them into holdings.
    const allMeetingRows = [];
    const allFileItems = [];
    for (const year of years) {
      const calendarRows = await postLims(ENDPOINTS.meetingCalendar, apiKey, { CalendarYear: year });
      if (Array.isArray(calendarRows)) {
        allMeetingRows.push(...calendarRows);
      } else {
        knownGaps.push(`meetingCalendar for ${year} returned a non-array response — treated as 0 rows, not silently ignored.`);
      }
      const fileItems = await postLims(ENDPOINTS.fileItemSearch, apiKey, { CalendarYear: year });
      if (Array.isArray(fileItems)) {
        allFileItems.push(...fileItems);
      } else {
        knownGaps.push(`FileItemSearch for ${year} returned a non-array response — treated as 0 rows, not silently ignored.`);
      }
    }
    console.log(
      `[lims-minneapolis] fetched ${allMeetingRows.length} calendar row(s) and ${allFileItems.length} file item(s) ` +
        `across year(s) ${years.join(", ")}.`,
    );

    const meetings = allMeetingRows
      .filter(isRealMeeting)
      .map(mapMeetingCalendarRow)
      .filter((m) => m.date && m.date >= windowStartIso && m.date <= windowEndIso);

    const { byKey: meetingLookup, collisions } = buildMeetingLookup(meetings);
    if (collisions) {
      knownGaps.push(
        `${collisions} same-day, same-body meeting collision(s) in this window — FileItemSearch's LegislativeHistory ` +
          "carries a date but no time, so a second same-day session for the same body can't be disambiguated; the " +
          "earliest session for each colliding (body, date) pair was used.",
      );
    }
    const unmatchedMeetings = new Set();
    const agendaItems = allFileItems.flatMap((item, itemIndex) =>
      mapFileItemToAgendaItems(item, itemIndex, meetingLookup, unmatchedMeetings, windowStartIso, windowEndIso),
    );

    if (unmatchedMeetings.size) {
      knownGaps.push(
        `${unmatchedMeetings.size} agenda item legislative-history row(s) referenced a committee/date not present in ` +
          `this run's meeting window and were dropped rather than given a fabricated meeting link (AGENTS.md §3.1): ` +
          `${[...unmatchedMeetings].slice(0, 10).join("; ")}${unmatchedMeetings.size > 10 ? ", …" : ""}.`,
      );
    }

    // Diff-on-refresh (AGENTS.md §0.5) — reuses legistar.mjs's
    // diffMeetings() directly; mapMeetingCalendarRow()'s output shares
    // every field MEETING_DIFF_FIELDS compares (date/time/location/
    // agendaStatus/agendaUrl/minutesUrl).
    const diff = isRealIngestedState(previous) ? diffMeetings(previous.meetings, meetings) : null;
    const previousGeneratedAt = previous?.generatedAt ?? null;

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
      diff,
      previousGeneratedAt,
      knownGaps,
    };

    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    // Cancelled meetings are included, not filtered out —
    // selectMeetingsThisWeek() derives isCancelled from agendaStatus and
    // WardModal.tsx renders it explicitly, so a resident sees "this one's
    // cancelled" instead of the meeting silently vanishing with no
    // explanation.
    //
    // MEETINGS_TEASER_WINDOW_DAYS (30), not a literal 7 — see that
    // constant's own comment in legistar.mjs. The real "this week" slice
    // is computed dynamically at render time by WardModal.tsx's
    // filterMeetingsThisWeek(), against the actual current date, not baked
    // in here at ingest time.
    const meetingsThisWeek = selectMeetingsThisWeek(
      { client: CLIENT, jurisdiction: JURISDICTION },
      meetings,
      today,
      MEETINGS_TEASER_WINDOW_DAYS,
    );
    await writeMeetingsThisWeekTeaser(meetingsThisWeek);
    console.log(
      `[lims-minneapolis] wrote ${OUTPUT_PATH}. meetings teaser (${MEETINGS_TEASER_WINDOW_DAYS}-day window): ${meetingsThisWeek.length}. Wrote ${MEETINGS_THIS_WEEK_PATH}`,
    );
  } catch (err) {
    console.error("[lims-minneapolis] live fetch did not complete:", err instanceof Error ? err.message : err);
    console.error(
      "[lims-minneapolis] leaving the existing public/lims/minneapolis-meetings.json untouched " +
        "rather than overwriting known-good (or honestly empty) data with a partial result.",
    );
    // Not process.exitCode = 1: an unreachable/erroring upstream API is a
    // refresh-mechanism failure, never a build failure (AGENTS.md §0.8/
    // §3.2) — same convention scripts/ingest/legistar.mjs's own
    // per-client catch follows, explicit in that file's own comment.
  }
}

main().catch((err) => {
  // Should be unreachable — every expected failure mode is caught in
  // main()'s own try/catch above — but if something truly unexpected
  // happens (e.g. writeEmptyState()'s mkdir/writeFile throwing on a
  // permissions or disk-space issue before that block's own try starts),
  // still don't take the build down with it. Mirrors legistar.mjs's
  // matching top-level guard.
  console.error("[lims-minneapolis] unexpected top-level error (not fabricating output):", err);
  process.exit(0);
});
