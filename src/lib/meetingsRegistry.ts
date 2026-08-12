// Registry entry for the per-body meetings/agenda layer (issue #58),
// following the two-file pattern in AGENTS.md §2.1: scripts/ingest/
// legistar.mjs's ingestMeetingsForClient()/buildMeetingsForWindow() is the
// fetch side, this file is the registry side. src/app/meetings/page.tsx
// reads MEETINGS_JURISDICTIONS from here — it does not hardcode a client
// list or a data path of its own, same convention billsRegistry.ts /
// src/app/bills/page.tsx already establish for the bills layer.
//
// SCOPE (as actually shipped, not as originally assumed): the task brief
// that opened this file assumed Minneapolis + St. Paul. That's wrong for
// this repo as it stands — src/lib/legistarJurisdictions.ts's own
// LEGISTAR_CLIENTS is St. Paul City Council (`stpaul`) and the Hennepin
// County Board (`hennepinmn`); Minneapolis has never had a working
// Legistar client here (LESSONS.md's probe-legistar entry, and this repo's
// own public/jurisdiction-platform-inventory.json, both show Minneapolis
// as platform "unknown" — it runs a different vendor, LIMS/DataNet). #102
// wired Minneapolis's own feed via scripts/ingest/lims-minneapolis.mjs
// instead — this registry now lists all three clients that have a wired
// feed; every other jurisdiction renders through
// UNWIRED_MEETINGS_JURISDICTIONS below instead of being silently left out
// of the page.

export interface MeetingsJurisdiction {
  // Legistar's own client path segment (webapi.legistar.com/v1/{client}) —
  // matches LEGISTAR_CLIENTS in legistarJurisdictions.ts.
  client: string;
  jurisdiction: string;
  // Public path scripts/ingest/legistar.mjs's writeClientMeetingsOutput()
  // writes to every run. Always present, always valid JSON — falls back to
  // an honest empty-state shape (meetings: [], agendaItems: []) rather than
  // a partial or fabricated result if that run's fetch failed; see that
  // script's buildMeetingsEmptyState().
  dataPath: string;
  // The jurisdiction's own public meetings/agenda page — rendered as the
  // fallback link whenever the feed above is empty, stale, or unreachable
  // for a given build (AGENTS.md §3.1: an honest link, never a placeholder
  // date, is always available even when the live feed isn't).
  calendarUrl: string;
  coverage: string;
}

export const MEETINGS_JURISDICTIONS: readonly MeetingsJurisdiction[] = [
  {
    client: "stpaul",
    jurisdiction: "St. Paul City Council",
    dataPath: "/legistar/stpaul-meetings.json",
    calendarUrl: "https://www.stpaul.gov/meetings-agendas-and-minutes",
    coverage:
      "Every body Legistar returns for this client (City Council, its committees, Legislative Hearings, the HRA, etc.), " +
      "not just the full Council — a rolling window from 14 days back to 90 days ahead. Consent-agenda items are flagged " +
      "from Legistar's own EventItemConsent field; 'no discussion' / 'no public comment' are not flagged — no comparably " +
      "reliable field exists for either.",
  },
  {
    client: "hennepinmn",
    jurisdiction: "Hennepin County Board",
    dataPath: "/legistar/hennepinmn-meetings.json",
    calendarUrl: "https://www.hennepincounty.gov/government/board-meetings",
    coverage:
      "Every body Legistar returns for this client (the full Board and its standing committees), same rolling window and " +
      "consent-only flagging as St. Paul above.",
  },
  {
    client: "minneapolis",
    jurisdiction: "Minneapolis City Council",
    dataPath: "/lims/minneapolis-meetings.json",
    calendarUrl: "https://lims.minneapolismn.gov/Calendar/all/upcoming",
    coverage:
      "Every body LIMS's meetingCalendar returns (Council, its committees and subcommittees, boards and commissions), " +
      "same 14-days-back/90-days-ahead rolling window and diff-on-refresh as St. Paul and Hennepin County. One gap vs. " +
      "the Legistar feeds above, explicit in this feed's own knownGaps on every run rather than silently absent: no " +
      "consent-agenda flagging — LIMS has no field equivalent to Legistar's EventItemConsent, so isConsent is always " +
      "false here, not a guess.",
  },
] as const;

// Bodies this page structurally cannot see a real feed for. Rendered as an
// honest empty state with a link to the body's own public calendar
// (AGENTS.md §3.1) — never a placeholder date, never silently omitted.
// `calendarUrl` values are hand-verified live pages, same standard
// WardModal.tsx's CITY_MEETINGS_URL already holds itself to.
export interface UnwiredMeetingsJurisdiction {
  jurisdiction: string;
  reason: string;
  calendarUrl: string;
}

export const UNWIRED_MEETINGS_JURISDICTIONS: readonly UnwiredMeetingsJurisdiction[] = [
  {
    jurisdiction: "Ramsey County Board",
    reason: "No Legistar (or other structured) feed identified for Ramsey County as of this writing.",
    calendarUrl: "https://www.ramseycounty.us/your-government/leadership/county-board",
  },
  {
    jurisdiction: "Every other mapped city and county",
    reason:
      "Meetings/agenda coverage on this site is currently limited to the two Legistar clients above. Every other city and " +
      "county this app has ward, mayor, or commissioner data for has no meetings feed connected.",
    calendarUrl: "https://www.leg.mn.gov/",
  },
] as const;

// --- Wire shape written by scripts/ingest/legistar.mjs's
// writeClientMeetingsOutput() / buildMeetingsIngestedState() /
// buildMeetingsEmptyState() ------------------------------------------------
// Mirrors that script's output exactly (field names, nullability) rather
// than a reshaped ideal — src/app/meetings/page.tsx reads this file's
// JSON import directly, so a mismatch here would be a silent type lie, not
// a caught error.

export interface Meeting {
  id: string;
  body_id: string;
  bodyName: string | null;
  date: string | null; // ISO date, or null for a malformed upstream record — never fabricated
  time: string | null;
  location: string | null;
  agendaStatus: string | null;
  agendaUrl: string | null;
  minutesUrl: string | null;
  videoStatus: string | null;
  sourceUrl: string | null;
  lastModifiedUtc: string | null;
  // Optional: populated only by scripts/ingest/lims-minneapolis.mjs, from
  // LIMS's meetingCalendar MembersList — the body's roster as of this
  // meeting (who serves on it, not a confirmed-attendance record; neither
  // upstream tracks actual per-meeting attendance). Legistar's own
  // /events object has no equivalent field (confirmed live against the
  // full response shape) — St. Paul/Hennepin meetings just omit this
  // rather than a required array every producer would need to populate.
  members?: { id: number; name: string; type: string | null }[];
}

export interface MeetingAgendaItem {
  id: string;
  meeting_id: string;
  sequence: number | null;
  agendaNumber: string | null;
  title: string;
  isConsent: boolean;
  actionName: string | null;
  passedFlagName: string | null;
  matterFile: string | null;
  matterId: number | null;
  matterType: string | null;
  // Optional: populated only by scripts/ingest/lims-minneapolis.mjs (LIMS
  // embeds the per-member roll call directly on each agenda item).
  // Legistar's own agendaItems don't carry this field at all — that vote
  // data lives in public/legistar/{client}.json's separate votes[]/
  // voteEvents[] tables instead, joined via scripts/lib/
  // legistarRecentVotes.mjs — so this can't be a required array without
  // breaking the `as MeetingsFeed` cast on every already-committed
  // Legistar JSON file. Raw memberName/value as the upstream API reports
  // them, never normalized here — scripts/lib/limsRecentVotes.mjs does
  // that mapping. LIMS's own producer always writes an empty array
  // (never omits the field) when an item had no roll call.
  votes?: { memberName: string; value: string }[];
}

export interface MeetingsProvenance {
  primarySourceUrl: string;
  sourceAgency: string;
  documentType: string;
  documentId: string | null;
  issuedDate: string | null;
  fetchedAt: string | null;
  licence: string;
  contentHash: string | null;
}

export interface MeetingsDiff {
  addedIds: string[];
  removedIds: string[];
  changed: { id: string; field: string; from: unknown; to: unknown }[];
}

export interface MeetingsFeed {
  schemaVersion: number;
  client: string;
  jurisdiction: string;
  generatedAt: string;
  status: "ingested" | "unreachable" | "auth_required";
  note: string;
  provenance: MeetingsProvenance;
  window: { startIso: string; endIso: string } | null;
  meetings: Meeting[];
  agendaItems: MeetingAgendaItem[];
  diff: MeetingsDiff | null;
  previousGeneratedAt: string | null;
  knownGaps: string[];
}

// Plain-language summary for coverage.ts's CoverageNotice (AGENTS.md §3.3)
// — derived from the lists above rather than hand-typed a second time, so
// this can't drift from what MEETINGS_JURISDICTIONS actually lists.
function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export const MEETINGS_COVERAGE_NOTE = `Upcoming meetings and agendas are connected for ${joinWithAnd(MEETINGS_JURISDICTIONS.map((j) => j.jurisdiction))} only (a rolling 14-days-back/90-days-ahead window). No meetings feed is connected for any other mapped jurisdiction yet.`;
