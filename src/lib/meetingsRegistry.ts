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
// as platform "unknown" — it runs a different vendor, LIMS/DataNet, itself
// still blocked on API-key approval per scripts/ingest/lims-minneapolis.mjs
// and LESSONS.md). This registry lists the two clients that actually have
// a wired feed; every other jurisdiction (Minneapolis included) renders
// through UNWIRED_MEETINGS_JURISDICTIONS below instead of being silently
// left out of the page.

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
    jurisdiction: "Minneapolis City Council",
    reason:
      "Minneapolis runs a different meetings platform (LIMS/DataNet, not Legistar). scripts/ingest/lims-minneapolis.mjs " +
      "is blocked pending an approved API key (LESSONS.md) — no meetings/agenda feed is connected for Minneapolis yet.",
    calendarUrl: "https://www.minneapolismn.gov/government/city-council/",
  },
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
export const MEETINGS_COVERAGE_NOTE = `Upcoming meetings and agendas are connected for ${MEETINGS_JURISDICTIONS.map((j) => j.jurisdiction).join(" and ")} only (a rolling 14-days-back/90-days-ahead window from Legistar). No meetings feed is connected for Minneapolis or any other mapped jurisdiction yet.`;
