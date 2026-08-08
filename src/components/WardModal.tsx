"use client";

import { useEffect, useRef, useState } from "react";
import type { BillVote, RepProperties } from "@/lib/types";
import type { AreaOfficials } from "@/lib/officials";
import { officialIdentity, officialSlug } from "@/lib/officials";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { CITY_TIER_EMPTY_NOTE, COUNTY_TIER_EMPTY_NOTE, STATE_TIER_EMPTY_NOTE } from "@/lib/coverage";
import {
  CONTESTED_COLOR,
  CONTESTED_COLOR_SOFT,
  partyColor,
  partyColorSoft,
  TIER_HEADER_BG,
  TIER_HEADER_TEXT,
  PANEL_HEADER_BG,
  PANEL_HEADER_TEXT,
} from "@/lib/cityTheme";
import { isStale } from "@/lib/electionConfig";
// Tiny (few-hundred-byte) bundler-resolved JSON imports — not the full
// {client}-meetings.json feed src/app/meetings/page.tsx reads, which runs
// into the hundreds of KB across both clients' meetings+agendaItems. This
// component ships to every visitor on every hover/click, so it only ever
// carries the one soonest-meeting summary scripts/ingest/legistar.mjs's
// writeNextMeetingTeaser() produces (AGENTS.md §0.7's 3G/old-phone
// budget) — full browsing lives at /meetings, linked below, never
// duplicated here (issue #58: "teaser only, not a duplicate of the full
// view").
import stpaulNextMeeting from "../../public/legistar/stpaul-next-meeting.json";
import hennepinmnNextMeeting from "../../public/legistar/hennepinmn-next-meeting.json";

interface NextMeetingTeaser {
  client: string;
  jurisdiction: string;
  bodyName: string | null;
  isPrimaryBody: boolean;
  date: string | null;
  time: string | null;
  sourceUrl: string | null;
  agendaUrl: string | null;
}

// Keyed by the same city/county display strings RepProperties already
// carries (rep.city / rep.county) — see NEXT_MEETING_TEASERS's two call
// sites below. Only jurisdictions with a real wired Legistar feed appear
// here (src/lib/meetingsRegistry.ts's MEETINGS_JURISDICTIONS); every other
// city/county keeps rendering the existing honest "no feed" copy.
const NEXT_MEETING_TEASERS: Partial<Record<string, NextMeetingTeaser | null>> = {
  "St. Paul": (stpaulNextMeeting as { nextMeeting: NextMeetingTeaser | null }).nextMeeting,
  Hennepin: (hennepinmnNextMeeting as { nextMeeting: NextMeetingTeaser | null }).nextMeeting,
};

function formatTeaserDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// One-line "next meeting" teaser (issue #58, AGENTS.md §0.6 "every record
// ends in an action") — always links to /meetings for the full agenda
// browser rather than rendering any agenda content itself.
function NextMeetingTeaserLine({ teaser }: { teaser: NextMeetingTeaser | null | undefined }) {
  if (!teaser || !teaser.date) return null;
  return (
    <p className="mt-1.5 text-sm">
      Next {teaser.isPrimaryBody ? "meeting" : `meeting (${teaser.bodyName ?? "a related body"})`}:{" "}
      <span className="font-medium text-ink-2">
        {formatTeaserDate(teaser.date)}
        {teaser.time ? `, ${teaser.time}` : ""}
      </span>{" "}
      —{" "}
      <a href="/meetings" className="text-accent underline underline-offset-2">
        see the full agenda
      </a>
      .
    </p>
  );
}

// AGENTS.md §3.2 soft staleness notice ("A record older than a
// configured threshold renders a visible staleness notice"), scoped to
// state legislators — the only role scripts/fetch-*.mjs currently emits
// verifiedAt for (see the field's comment in types.ts). A missing
// verifiedAt is treated the same as a stale one: neither gives a
// resident any assurance the seat still has the person we're naming
// attached to it, so both get the same visible banner rather than the
// absent-field case silently rendering as "fine." Colour is never the
// only signal (AGENTS.md §4) — this pairs an icon and explicit text with
// the amber accent.
//
// Routed through globals.css's --stale/--stale-soft tokens (and
// --vote-yes/--vote-no below) rather than hardcoded hex — unlike
// cityTheme.ts's CONTESTED_COLOR/TIER_HEADER_BG/PANEL_HEADER_BG, these were
// never a brand color matched to an external source, just plain ambers/
// greens/reds with no dark-mode counterpart (PR review, 2026-08-07). A CSS
// custom property works fine as a plain string in a React inline `style`
// value — it resolves against whatever `.dark` (or not) is on `<html>` at
// paint time, same as every `bg-*`/`text-*` Tailwind utility already does.
const STALE_COLOR = "var(--stale)";
const STALE_COLOR_SOFT = "var(--stale-soft)";

// "Voted absent" used to render in the exact same red as "voted no" — the
// badge only ever branched on option === "yes", so anything else (no,
// absent, excused, not voting, other) fell into one shared red styling.
// That's a real accuracy problem, not a cosmetic one: an absent or
// excused member didn't oppose anything, they didn't participate, and a
// red "no"-colored badge tells a resident the opposite of what happened.
// This became a live, shipped case with #57's Legistar votes (St. Paul/
// Hennepin genuinely record "Absent" on the roll) — fetch-state-
// legislature.mjs's own recentVotes never carried anything but yes/no
// (QUALIFYING_OPTIONS there), so the bug was latent until now.
//
// Plain-language labels/glosses per AGENTS.md §0.9 — spelled out for the
// three options a resident could otherwise misread, not just recolored.
// label: the badge text. gloss: shown only for the non-yes/no cases,
// where the plain meaning genuinely isn't obvious from the word alone.
const VOTE_OPTION_DISPLAY: Record<string, { label: string; color: string; colorSoft: string; gloss?: string }> = {
  yes: { label: "Voted Yes", color: "var(--vote-yes)", colorSoft: "var(--vote-yes-soft)" },
  no: { label: "Voted No", color: "var(--vote-no)", colorSoft: "var(--vote-no-soft)" },
  absent: {
    label: "Absent",
    color: STALE_COLOR,
    colorSoft: STALE_COLOR_SOFT,
    gloss: "Wasn't recorded as present for this vote — didn't vote either way.",
  },
  excused: {
    label: "Excused",
    color: STALE_COLOR,
    colorSoft: STALE_COLOR_SOFT,
    gloss: "Formally excused from this vote — sometimes a conflict-of-interest recusal, sometimes a pre-approved absence.",
  },
  "not voting": {
    label: "Present, No Vote",
    color: STALE_COLOR,
    colorSoft: STALE_COLOR_SOFT,
    gloss: "Was present but didn't cast a vote either way.",
  },
};
const DEFAULT_VOTE_OPTION_DISPLAY = {
  label: "Other",
  color: STALE_COLOR,
  colorSoft: STALE_COLOR_SOFT,
  gloss: "Recorded outside the usual yes/no options — see the source record for the specifics.",
};

function voteOptionDisplay(option: string) {
  return VOTE_OPTION_DISPLAY[option] ?? DEFAULT_VOTE_OPTION_DISPLAY;
}

function isVerificationStale(rep: RepProperties): boolean {
  if (rep.chamber === null) return false; // only state legislature carries verifiedAt today
  if (!rep.verifiedAt) return true; // missing verifiedAt fails the check, same as a stale one
  return isStale(rep.verifiedAt);
}

function formatOfficeSince(iso: string): string {
  // timeZone: "UTC" matters here — these dates are stored as bare
  // YYYY-MM-DD (midnight UTC), and formatting in the browser's local zone
  // rolls them back a day/month for anyone west of UTC.
  return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// Every mapped city's own official council-meetings/agenda calendar
// page, each individually verified live (fetched and confirmed to be a
// real, current meetings/agenda page, not guessed from a URL pattern).
// This is the entire content of the "meetings" section below: AGENTS.md
// §3.1 requires deleting fabricated hearing data outright rather than
// labeling it, so there is no meetings feed here at all, real or
// synthetic — only an honest pointer to where a resident can find one
// themselves. A city missing from this table falls back to a plain-text
// "check your city's website" prompt rather than a guessed link.
const CITY_MEETINGS_URL: Partial<Record<string, string>> = {
  Minneapolis: "https://www.minneapolismn.gov/government/city-council/",
  "St. Paul": "https://www.stpaul.gov/meetings-agendas-and-minutes",
  Bloomington: "https://www.bloomingtonmn.gov/cob/city-meetings-agendas-webcasts-and-documents",
  Plymouth: "https://www.plymouthmn.gov/departments/city-council/meetings-agendas-videos-2406",
  Minnetonka: "https://www.minnetonkamn.gov/government/city-council-mayor/city-council-meetings",
  "St. Louis Park": "https://www.stlouisparkmn.gov/government/city-council/meetings",
  Richfield: "https://richfieldmn.portal.civicclerk.com/",
  Blaine: "https://www.blainemn.gov/AgendaCenter",
  "Brooklyn Park": "https://www.brooklynpark.org/city-council/city-council-documents/",
  "Coon Rapids": "https://www.coonrapidsmn.gov/572/Agendas-Minutes",
};

// St. Paul's source data includes a "Councilmember " prefix in the name
// field; the role/city label above already establishes that, so it's just
// redundant text eating into the truncated name display.
function displayName(name: string | null): string | null {
  return name?.replace(/^councilmember\s+/i, "") ?? null;
}

function initials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Exported for reuse by WardMap's pin markers, which need the same labels
// for their aria-label text as the modal shows.
export function roleLabel(rep: RepProperties): string {
  // Truthy, not `!== null` — mayor pins read straight from the fetched
  // JSON without going through normalizeRepProperties's null-defaulting
  // (see that function's own comment), so a mayor from a fetch script that
  // simply omits wardName would have it as undefined, not null, and
  // undefined !== null is true. A truthy check treats both as "absent."
  if (rep.wardName) return `${rep.wardName} District`;
  if (rep.ward !== null) return `Ward ${rep.ward}`;
  if (rep.district !== null) return `District ${rep.district}`;
  if (rep.stateDistrict !== null) return `District ${rep.stateDistrict}`;
  return "Mayor";
}

// Council members and mayors are identified by city; commissioners by
// county; state legislators by chamber — a Hennepin district covers a lot
// of suburbs "Minneapolis" wouldn't accurately describe, even though it's
// grouped/colored with Minneapolis everywhere else in the app (see the
// note on RepProperties), and a legislative district can straddle both
// cities or neither.
export function areaLabel(rep: RepProperties): string {
  if (rep.chamber === "house") return "MN House";
  if (rep.chamber === "senate") return "MN Senate";
  return rep.county ?? rep.city;
}

// Mirrors rep.isContested (see the field's comment in types.ts for why
// that's a stored flag rather than derived here from candidates.length).
export function isContested(rep: RepProperties): boolean {
  return rep.isContested === true;
}

function IconCalendar() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0">
      <rect x="3" y="4.5" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 8h14M7 2.5v3M13 2.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconPin() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0">
      <path
        d="M10 18s6-5.2 6-9.6A6 6 0 0 0 4 8.4C4 12.8 10 18 10 18Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="8.2" r="2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconMail() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0">
      <rect x="2.5" y="4.5" width="15" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="m3 5.5 7 5.5 7-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPhone() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0">
      <path
        d="M4.5 3.5h2.7l1 3.6-1.8 1.4a9 9 0 0 0 4.6 4.6l1.4-1.8 3.6 1v2.7c0 .8-.7 1.4-1.5 1.3C8.6 15.7 4.3 11.4 3.2 5.6c-.1-.8.5-1.6 1.3-1.6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconBuilding() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0">
      <rect x="4" y="2.5" width="12" height="15" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 6h1.5M11.5 6H13M7 9.5h1.5M11.5 9.5H13M7 13h1.5M11.5 13H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconWarning() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0">
      <path
        d="M10 3.3 17.5 16H2.5L10 3.3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M10 8v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="14" r="0.9" fill="currentColor" />
    </svg>
  );
}

function IconBallot() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0">
      <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="m6.5 10 2 2 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconExternal() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5 shrink-0">
      <path d="M8 5H5.5a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 5.5 15h7a1.5 1.5 0 0 0 1.5-1.5V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M11 4h5v5M15.5 4.5 9 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Recent votes' own disclosure toggle — the only section left with one
// after the rest of the panel dropped its "More details" wrapper (see
// OfficialCard). Unlike the other sections, a seat's roll-call history
// genuinely grows without bound over time (§3.2's Legistar/Open States
// integrations keep adding to it — see #57, #60), so it's the one place
// still worth collapsing by default once it's long enough to be worth
// skimming past, per DEFAULT_OPEN_VOTE_THRESHOLD below.
function IconChevron() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5 shrink-0 transition-transform duration-150 group-open:rotate-180">
      <path d="m5.5 7.5 4.5 5 4.5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Committees section's own header icon — the block below used to render
// with no label at all (just chips), fine when it lived inside a "More
// details" disclosure that named the whole group; now that that wrapper
// is gone (see OfficialCard), every section needs its own heading, same
// as Recent votes/Meetings already had.
function IconUsers() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0">
      <circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 16c.5-3 2.3-4.5 4.5-4.5s4 1.5 4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="14" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12.5 11.3c1.7.3 2.9 1.6 3.3 4.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// Recent votes starts expanded when there isn't much in it yet (today's
// reality for almost every seat — most feeds carry a handful of votes at
// most) and starts collapsed once it's grown past a skim-friendly
// length, so a resident scanning up to six stacked cards for "who
// represents me" isn't forced to scroll past a wall of roll-call history
// for every single one. Nothing here is ever permanently hidden: it's a
// starting state a resident can always open, never a removed feature.
const DEFAULT_OPEN_VOTE_THRESHOLD = 3;

// One recent-votes row. The plain-language gloss for a non-yes/no option
// (see VOTE_OPTION_DISPLAY) is real information, but printing it on every
// row unconditionally reads as clutter once a card has 5 of these stacked
// — most residents scanning the list already read "Absent" as "wasn't
// there" without help. Hidden by default, revealed on hover (the badge's
// native `title` tooltip, free) or tap/click/keyboard (this component's
// own toggle, since touch has no hover state to fall back on) — same
// "info available on demand, not forced on everyone" shape as the rest of
// this file's disclosure patterns. yes/no rows have no gloss at all, so
// they stay a plain, non-interactive span exactly as before.
function VoteRow({ vote, accent }: { vote: BillVote; accent: string }) {
  const display = voteOptionDisplay(vote.option);
  const [showGloss, setShowGloss] = useState(false);
  const glossId = display.gloss ? `vote-gloss-${vote.voteId}` : undefined;

  return (
    <li className="text-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-ink">{vote.identifier}</span>
        {display.gloss ? (
          <button
            type="button"
            onClick={() => setShowGloss((shown) => !shown)}
            aria-expanded={showGloss}
            aria-describedby={glossId}
            title={display.gloss}
            className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset"
            style={{ color: display.color, backgroundColor: display.colorSoft }}
          >
            {display.label}
          </button>
        ) : (
          <span
            className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0"
            style={{ color: display.color, backgroundColor: display.colorSoft }}
          >
            {display.label}
          </span>
        )}
      </div>
      {display.gloss && showGloss && (
        <div id={glossId} className="text-xs italic text-ink-3">
          {display.gloss}
        </div>
      )}
      <div className="text-xs text-ink-3">{vote.title}</div>
      {vote.sourceUrl && (
        <a
          href={vote.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium hover:underline"
          style={{ color: accent }}
        >
          View bill
        </a>
      )}
    </li>
  );
}

// One officeholder's full profile — name, contact, committees, votes, the
// works. Reused up to six times per panel (Mayor + Council Member for
// City, County Commissioner for County, State Rep + State Senator for
// State), so nothing here owns the close button or the panel's own
// scroll/height — those are WardModal's job now, not each card's. No
// `role="dialog"` here: per-card dialog semantics made sense when this was
// the whole panel's content, but stamping it onto every one of up to six
// cards in one panel is an accessibility anti-pattern (nested dialogs).
// The panel-level `<section>`/heading structure below carries the
// landmark navigation instead.
function OfficialCard({ rep }: { rep: RepProperties }) {
  const repName = displayName(rep.repName);
  const accent = partyColor(rep.repParty);
  const accentSoft = partyColorSoft(rep.repParty);
  const isWard = rep.ward !== null;
  // Defends against a browser-cached wards.geojson response from before
  // these fields existed (fetch is cache: "no-store" now, but a tab left
  // open from before that change could still be holding one in memory).
  const committees = Array.isArray(rep.committees) ? rep.committees : [];
  const neighborhoods = Array.isArray(rep.neighborhoods) ? rep.neighborhoods : [];
  const candidates = Array.isArray(rep.candidates) ? rep.candidates : [];
  const recentVotes = Array.isArray(rep.recentVotes) ? rep.recentVotes : [];

  const avatar = rep.repPhotoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={rep.repPhotoUrl}
      alt={repName ?? "Representative photo"}
      className="h-full w-full rounded-full object-cover shrink-0 bg-panel-3"
    />
  ) : (
    <div
      className="h-full w-full rounded-full shrink-0 flex items-center justify-center font-semibold text-ink-3"
      style={{ backgroundColor: accentSoft }}
    >
      {initials(repName)}
    </div>
  );

  return (
    <div>
      <div className="flex items-start gap-3 px-4 pt-3 pb-3">
        <div className="h-16 w-16 text-xl">{avatar}</div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div
            className="inline-block text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full mb-1"
            style={{ color: accent, backgroundColor: accentSoft }}
          >
            {areaLabel(rep)} &middot; {roleLabel(rep)}
          </div>
          <h4 className="text-lg font-bold text-ink leading-tight truncate">
            {repName && rep.profileUrl ? (
              <a
                href={rep.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {repName}
              </a>
            ) : (
              repName ?? "Vacant / TBD"
            )}
          </h4>
          <div className="text-xs text-ink-3 mt-0.5">
            {rep.repParty} &middot; in office since {formatOfficeSince(rep.officeSince)}
          </div>
        </div>
      </div>

      {isVerificationStale(rep) && (
        <div
          className="border-t border-hair px-4 py-2.5 flex items-center gap-1.5 text-xs font-semibold"
          style={{ color: STALE_COLOR, backgroundColor: STALE_COLOR_SOFT }}
        >
          <IconWarning />
          <span>
            {rep.verifiedAt
              ? `Not re-verified since ${formatOfficeSince(rep.verifiedAt)} — may be out of date.`
              : "No verification date on record for this seat — may be out of date."}
          </span>
        </div>
      )}

      {/* Contact stays outside the collapsible block below, along with the
          header and the staleness banner above — per AGENTS.md §0.6
          ("every record ends in an action"), how to reach this person has
          to survive collapsing the card down to its shortest state, not
          live inside the "more detail" a resident might never open. */}
      {(rep.repEmail || rep.repPhone) && (
        <div className="px-4 pb-3 flex items-center gap-2">
          {rep.repEmail && (
            <a
              href={`mailto:${rep.repEmail}`}
              // hover:bg-sidebar-hover, not hover:bg-hover: this chip is
              // one of the sidebar's own interactive rows (this card
              // renders inside WardMap's right `<aside>` in the
              // "sidebar" variant) — see --sidebar-hover's comment in
              // globals.css for why the generic token barely shows.
              className="flex items-center gap-1.5 text-xs font-medium text-ink-2 border border-hair rounded-full px-3 py-1.5 hover:bg-sidebar-hover active:bg-hair-strong"
            >
              <IconMail />
              Email
            </a>
          )}
          {rep.repPhone && (
            <a
              href={`tel:${rep.repPhone.replace(/[^\d+]/g, "")}`}
              className="flex items-center gap-1.5 text-xs font-medium text-ink-2 border border-hair rounded-full px-3 py-1.5 hover:bg-sidebar-hover active:bg-hair-strong"
            >
              <IconPhone />
              {rep.repPhone}
            </a>
          )}
        </div>
      )}

      {/* Everything below — contested-race candidates, committees, party
          unity, recent votes, meetings, office/profile links — used to
          live behind a single "More details" <details>/<summary>
          disclosure. Removed: with committees/votes/meetings each
          already carrying their own heading, the wrapper's toggle wasn't
          hiding a meaningful unit of content, just adding a click before
          a resident could see it. Every section below now always
          renders, same as Recent votes/Meetings already did — an absent
          feed is still an honest gap stated inline (AGENTS.md §3.1), not
          content a resident has to expand to find. */}
      <div className="border-t border-hair">
        {isContested(rep) && (
          <div className="border-t border-hair px-4 py-3" style={{ backgroundColor: CONTESTED_COLOR_SOFT }}>
            <div
              className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide mb-2.5"
              style={{ color: CONTESTED_COLOR }}
            >
              <IconBallot />
              Contested seat &middot; {candidates.length} on the ballot
            </div>
            <ul className="space-y-2">
              {candidates.map((candidate) => (
                <li key={candidate.name} className="text-sm">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium text-ink">{candidate.name}</span>
                    {candidate.isIncumbent && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3 bg-panel-2/70 px-1.5 py-0.5 rounded">
                        Incumbent
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink-3">{candidate.party}</div>
                  {candidate.endorsements.length > 0 && (
                    <div className="text-xs text-ink-3">Endorsed by {candidate.endorsements.join(", ")}</div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {committees.length > 0 && (
          <div className="border-t border-hair px-4 py-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2.5">
              <IconUsers />
              Committees
            </div>
            <div className="flex flex-wrap gap-1.5">
              {committees.map((role) => (
                <span
                  key={role}
                  className="text-[11px] font-medium px-2 py-1 rounded-full border"
                  style={{ color: accent, borderColor: accentSoft, backgroundColor: accentSoft }}
                >
                  {role}
                </span>
              ))}
            </div>
          </div>
        )}

        {rep.partyUnityPercent !== null && (
          <div className="border-t border-hair px-4 py-3">
            <div className="flex items-center justify-between text-xs text-ink-3 mb-1">
              <span>Votes with own party</span>
              <span className="font-semibold" style={{ color: partyColor(rep.repParty) }}>
                {rep.partyUnityPercent}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-panel-3 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${rep.partyUnityPercent}%`, backgroundColor: partyColor(rep.repParty) }}
              />
            </div>
          </div>
        )}

        {/* Always renders, data or not — matching the Meetings section
            below rather than the old silent omission when recentVotes was
            empty. AGENTS.md §3.1: an absent feed is an honest gap to say
            out loud, not a section that just quietly doesn't appear.
            scripts/fetch-state-legislature.mjs populates this from Open
            States rollcalls; scripts/lib/legistarRecentVotes.mjs (#57)
            joins it in for St. Paul Council Members and Hennepin County
            Commissioners from public/legistar/{client}.json's already-
            resolved holding→vote records. Every other Council Member/
            County Commissioner seat (Minneapolis, Ramsey — neither is a
            Legistar client) still renders the honest gap note below until
            a feed exists for them. Skipped for Mayor: strong-mayor
            systems don't cast the kind of roll-call vote this section
            models, and no upstream source scoped here tracks mayoral
            tie-breaking votes as one.

            The one section in this card still behind its own <details>/
            <summary> disclosure (see DEFAULT_OPEN_VOTE_THRESHOLD's own
            comment) rather than always-open like everything else here —
            a growing roll-call history is the one part of this card that
            doesn't have a natural skim-friendly length, unlike a fixed
            committee-membership list or a single meetings note. */}
        {rep.role !== "Mayor" && (
          <details open={recentVotes.length <= DEFAULT_OPEN_VOTE_THRESHOLD} className="group border-t border-hair">
            <summary className="flex list-none items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none hover:bg-sidebar-hover [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">
                <IconBallot />
                Recent votes
              </span>
              <IconChevron />
            </summary>
            <div className="px-4 pb-3 space-y-3">
              {/* "Next scheduled vote" per #57's own reference shape
                  ("My Rep" view). Deliberately always the honest-gap
                  copy below, never a real date: neither Legistar producer
                  wired in here (scripts/lib/legistarRecentVotes.mjs) nor
                  the Open States roll-call feed
                  (scripts/fetch-state-legislature.mjs) exposes a
                  scheduled-but-not-yet-voted agenda item — every record
                  either source carries is a completed roll call. Adding a
                  "next vote" field that always renders empty would still
                  be a lie if it ever silently guessed instead; per
                  AGENTS.md §3.1 this stays a plain, explicit gap note
                  until a real upcoming-agenda feed exists to back it. */}
              <p className="text-xs text-ink-3">
                <span className="font-semibold text-ink-2">Next scheduled vote: </span>
                not tracked yet — no source connected here publishes scheduled-but-unvoted
                agenda items.
              </p>
              {recentVotes.length > 0 ? (
                <>
                  <ul className="space-y-2.5">
                    {recentVotes.map((vote) => (
                      <VoteRow key={vote.voteId} vote={vote} accent={accent} />
                    ))}
                  </ul>
                  {/* Per #57: a link out to a full per-official history,
                      not built as its own page in this PR — that page is
                      deliberately deferred until this recent-slice tab
                      itself proves the list needs one (AGENTS.md §0.8 —
                      build the thing that's needed, not ahead of need).
                      /officials/[slug] doesn't exist yet, so this 404s by
                      design; see officialSlug()'s own comment in
                      src/lib/officials.ts. */}
                  <a
                    href={`/officials/${officialSlug(rep)}/votes`}
                    className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
                    style={{ color: accent }}
                  >
                    View full voting record
                    <IconExternal />
                  </a>
                </>
              ) : (
                <p className="text-sm text-ink-3">No recorded votes on file yet for {areaLabel(rep)}.</p>
              )}
            </div>
          </details>
        )}

        {/* This used to be a per-ward hearing/meeting schedule — deleted
            outright (not hidden behind a flag, not left as a fallback)
            per AGENTS.md §3.1: it was fabricated, deterministic mock
            data, and a resident who missed a real hearing because this
            site invented a fake one would have been actively harmed.
            An honest "we don't have this yet" with a real link to the
            city's own calendar is the correct replacement, not a fake
            feed relabeled as real. The mayor's office doesn't get this
            section at all (isWard) — there's no ward-level "meetings
            feed" concept to honestly say we lack for a citywide role. */}
        {isWard && (
          <div className="border-t border-hair px-4 py-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2.5">
              <IconCalendar />
              Meetings
            </div>
            {/* St. Paul (issue #58) has a real wired Legistar feed now —
                every other city in CITY_MEETINGS_URL still gets the honest
                "no feed connected" copy below; NEXT_MEETING_TEASERS only
                has an entry for jurisdictions meetingsRegistry.ts actually
                lists. */}
            {NEXT_MEETING_TEASERS[rep.city] !== undefined ? (
              <NextMeetingTeaserLine teaser={NEXT_MEETING_TEASERS[rep.city]} />
            ) : (
              <p className="text-sm text-ink-3">No meetings feed connected yet for {rep.city}.</p>
            )}
            {CITY_MEETINGS_URL[rep.city] ? (
              <a
                href={CITY_MEETINGS_URL[rep.city]}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium hover:underline mt-1"
                style={{ color: accent }}
              >
                See {rep.city}&rsquo;s own meeting calendar
                <IconExternal />
              </a>
            ) : (
              <p className="text-xs text-ink-4 mt-1">Check {rep.city}&rsquo;s official website for upcoming meetings.</p>
            )}
          </div>
        )}

        {/* County tier equivalent of the block above — Hennepin County
            Board also has a wired Legistar feed (issue #58). No
            "no feed" fallback copy here (unlike the city block): a county
            commissioner card with nothing to show for a county
            meetingsRegistry.ts doesn't cover just renders nothing, same
            as this card did for every county before this feed existed. */}
        {!isWard && rep.county && NEXT_MEETING_TEASERS[rep.county] && (
          <div className="border-t border-hair px-4 py-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2.5">
              <IconCalendar />
              Meetings
            </div>
            <NextMeetingTeaserLine teaser={NEXT_MEETING_TEASERS[rep.county]} />
          </div>
        )}

        {(rep.officeRoom || neighborhoods.length > 0) && (
          <div className="border-t border-hair px-4 py-3 space-y-1.5 text-xs text-ink-3">
            {rep.officeRoom && (
              <div className="flex items-start gap-1.5">
                <span className="mt-0.5">
                  <IconBuilding />
                </span>
                <span>{rep.officeRoom}</span>
              </div>
            )}
            {neighborhoods.length > 0 && (
              <div className="flex items-start gap-1.5">
                <span className="mt-0.5">
                  <IconPin />
                </span>
                <span>{neighborhoods.join(", ")}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface TierSection {
  key: keyof AreaOfficials;
  label: string;
  emptyNote: string;
}

// Order matches the app's own "who represents me?" question order (AGENTS.md
// Part 0): city first, then county, then state.
const TIER_SECTIONS: TierSection[] = [
  { key: "city", label: "City", emptyNote: CITY_TIER_EMPTY_NOTE },
  { key: "county", label: "County", emptyNote: COUNTY_TIER_EMPTY_NOTE },
  { key: "state", label: "State", emptyNote: STATE_TIER_EMPTY_NOTE },
];

// Drives the "stacking" scroll effect on the City/County/State sections.
// Each tier's <h2> is `position: sticky`, docked at an offset equal to
// however many headers are already stacked above it (index * headerHeight).
// That single fact is what produces the whole interaction, natively, with
// no scroll listener:
//
//   - City's header docks at the very top of the scroll region (top: 0)
//     the moment it would otherwise scroll past it, and stays there.
//   - County keeps scrolling up in normal flow, *carrying its own full
//     content with it* — nothing about County is collapsed or pinned yet —
//     until County's header reaches the bottom edge of City's now-docked
//     header (top: headerHeight). At that exact point it, too, locks in
//     place, immediately below City's.
//   - Same for State relative to County (top: 2 * headerHeight).
//
// Each already-docked header is opaque and painted above ordinary content
// (a shared z-index beats content's default z-index:auto regardless of DOM
// order), so as a tier's content keeps scrolling upward past a header
// that's already stuck, it visually disappears underneath it — the
// "collapses into the stickied section" effect the panel now has — without
// any JS touching layout/height. That matters: collapsing height via JS
// (an earlier version of this did, via IntersectionObserver + a 0fr grid
// track) removes already-scrolled-past space from the document *while the
// user is mid-scroll*, which shifts what `scrollTop` points at and reads as
// a jump/glitch. Pure sticky positioning never has that problem, because
// nothing's height ever changes — content just scrolls under a header that
// doesn't move.
//
// Content is never removed from the DOM or marked `hidden`/`aria-hidden` —
// only visually covered once its section is scrolled past. Heading
// navigation still reaches every tier's officials regardless of scroll
// position, same as before this feature existed — see the comment above
// TIER_SECTIONS's render below for why that matters (#53/9665be0).
function useTierStack() {
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const headerRefs = useRef<Array<HTMLHeadingElement | null>>([]);
  const lastContentRef = useRef<HTMLDivElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [spacerHeight, setSpacerHeight] = useState(0);

  useEffect(() => {
    const measure = () => {
      const height = headerRefs.current[0]?.getBoundingClientRect().height ?? 0;
      if (height) setHeaderHeight(height);
    };
    measure();
    // Headers share one set of classes, so only the first needs measuring —
    // but re-measure on resize since text can reflow at narrow widths.
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Sizes the trailing spacer (rendered below the whole tier stack) to
  // exactly the shortfall between the scroll room State's own content
  // naturally provides and the room it actually needs to reach its dock
  // line — never more. A fixed `100% - stackHeight` spacer (the prior
  // version of this) reserved that shortfall for the *worst case* (State
  // has ~0 content) unconditionally, so a State section with real content
  // ended up with a wall of blank space below it — worse the more content
  // State already had. Measuring State's actual rendered height and
  // subtracting it fixes that, and re-measuring on resize means it stays
  // correct live as the panel's own width (and therefore each card's
  // wrapped-text height) changes.
  useEffect(() => {
    const scrollRoot = scrollRootRef.current;
    const lastContent = lastContentRef.current;
    if (!scrollRoot || !lastContent || !headerHeight) return;

    const recompute = () => {
      const stackHeight = TIER_SECTIONS.length * headerHeight;
      const needed = scrollRoot.clientHeight - stackHeight - lastContent.getBoundingClientRect().height;
      setSpacerHeight(Math.max(0, needed));
    };
    recompute();

    const observer = new ResizeObserver(recompute);
    observer.observe(scrollRoot);
    observer.observe(lastContent);
    return () => observer.disconnect();
  }, [headerHeight]);

  // Both exposed as callbacks rather than the ref objects themselves —
  // TierNode is a child component, and mutating a ref received as a prop
  // trips the project's react-hooks/immutability lint rule (props are
  // meant to be read-only from the child's side). Routing the writes
  // through these closures keeps the mutation local to the hook that owns
  // the refs.
  const onHeaderRef = (index: number, el: HTMLHeadingElement | null) => {
    headerRefs.current[index] = el;
  };
  const onContentRef = (index: number, el: HTMLDivElement | null) => {
    if (index === TIER_SECTIONS.length - 1) lastContentRef.current = el;
  };

  // Scrolls so tier `index`'s header sits exactly at its own dock line
  // (index * headerHeight — see this hook's file comment) with its
  // content right below, i.e. "reveal this tier," not just "this tier's
  // header is somewhere on screen." Deliberately not
  // `header.scrollIntoView()`: that aligns the header's *current* (often
  // already-sticky-shifted) rect flush with the scroll container's own
  // top edge, which would scroll past the dock offset every
  // still-stacked header above it is entitled to and bury them under the
  // target section instead of leaving them stacked above it.
  //
  // Reads the header's parent `<section>` rect, not the `<h2>` itself,
  // for the "natural," not-yet-stuck position: `position: sticky` only
  // ever repositions the sticky element's own painted box, never its
  // non-sticky parent's — the section's top edge is exactly where its
  // header would sit if it weren't sticky at all, and stays that way
  // whether or not the header is currently docked.
  const scrollToTier = (index: number) => {
    const scrollRoot = scrollRootRef.current;
    const header = headerRefs.current[index];
    const section = header?.parentElement;
    if (!scrollRoot || !section) return;
    const targetTop =
      section.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top + scrollRoot.scrollTop - index * headerHeight;
    const maxScrollTop = scrollRoot.scrollHeight - scrollRoot.clientHeight;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollRoot.scrollTo({
      top: Math.min(Math.max(0, targetTop), Math.max(0, maxScrollTop)),
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  };

  return { scrollRootRef, onHeaderRef, onContentRef, headerHeight, spacerHeight, scrollToTier };
}

interface TierNodeProps {
  index: number;
  officials: AreaOfficials;
  onHeaderRef: (index: number, el: HTMLHeadingElement | null) => void;
  onContentRef: (index: number, el: HTMLDivElement | null) => void;
  headerHeight: number;
}

// Each tier nests the rest of the stack *inside* itself — County's
// <section> sits inside City's, State's inside County's — rather than
// beside it as a sibling. That nesting is load-bearing, not cosmetic: a
// sticky element only stays docked while its own containing block (its
// nearest ancestor — here, its own <section>) is still on screen. With
// siblings, City's <section> would end exactly where City's own content
// ends, i.e. the moment County arrives, so City would unstick right as
// County tried to dock beneath it instead of the two stacking together for
// the rest of the scroll (the bug this replaced — see the commit history
// on this file). Nesting County, and inside County, State, inside City's
// <section> extends City's containing block all the way to the bottom of
// the list, so City stays docked for as long as anything below it is still
// scrolling — each header, once stuck, stays stuck for the remainder of
// the scroll, only ever adding to the stack, never dropping out of it.
function TierNode({ index, officials, onHeaderRef, onContentRef, headerHeight }: TierNodeProps) {
  if (index >= TIER_SECTIONS.length) return null;
  const { key, label, emptyNote } = TIER_SECTIONS[index];
  const reps = officials[key];
  const headingId = `officials-tier-${key}-heading`;
  return (
    <section aria-labelledby={headingId}>
      <h2
        ref={(el) => onHeaderRef(index, el)}
        id={headingId}
        className="sticky z-10 border-t border-b border-hair px-4 py-2 text-xs font-semibold uppercase tracking-wide shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
        style={{ top: `${index * headerHeight}px`, backgroundColor: TIER_HEADER_BG, color: TIER_HEADER_TEXT }}
      >
        {label}
      </h2>
      {/* Only the last tier's wrapper is actually measured (see
          useTierStack's onContentRef) — every tier gets one regardless, so
          expanding which tier is last (were a 4th ever added) doesn't need
          this markup to change too. */}
      <div ref={(el) => onContentRef(index, el)}>
        {reps.length > 0 ? (
          <div className="divide-y divide-hair">
            {reps.map((rep) => (
              <OfficialCard key={officialIdentity(rep)} rep={rep} />
            ))}
          </div>
        ) : (
          <p className="px-4 pb-3 text-sm text-ink-3">{emptyNote}</p>
        )}
      </div>
      <TierNode
        index={index + 1}
        officials={officials}
        onHeaderRef={onHeaderRef}
        onContentRef={onContentRef}
        headerHeight={headerHeight}
      />
    </section>
  );
}

export interface WardModalProps {
  officials: AreaOfficials;
  onClose: () => void;
  // Which city-limit polygon the cursor/click is actually inside, per
  // WardMap's SelectedArea.hoveredCityName — see that field's own comment.
  // Only ever consulted by panelHeading, and only when `officials.city`
  // came back empty.
  hoveredCityName?: string | null;
  // Which tier (per WardMap's SelectedArea.jumpToTier, same "city" |
  // "county" | "state" keys as AreaOfficials/TIER_SECTIONS) the
  // cursor/click currently over the map actually corresponds to. When
  // this changes, the panel auto-scrolls that tier's section into view —
  // so hovering a state legislative district while the panel is still
  // scrolled to a previously-hovered ward's City section jumps straight
  // to the State card, rather than leaving a resident to notice the
  // header changed and scroll down themselves. null when nothing on the
  // map is currently hovered/selected (nothing to jump to).
  jumpToTier?: keyof AreaOfficials | null;
  // Per WardMap's SelectedArea.selectionKey — the same officialIdentity()
  // (or "at-large:<city>"/"city-boundary:<name>") string that call site
  // already computes for its own reasons. jumpToTier alone can't tell
  // "hovered a new ward" apart from "hovered a different ward in the same
  // city tier" (both are just "city"), so the auto-scroll effect below
  // keys on this instead — it changes on every genuinely new hover/click,
  // even within the same tier, and stays put when `officials` is rebuilt
  // for an unrelated reason (WardMap's toggleCity filtering, for one).
  selectionKey?: string | null;
  // "sheet" (the default): this component owns its own card chrome — a
  // rounded, bordered, shadowed surface meant to float over the map or
  // MapLibre's dimmed scrim. That's mobile's bottom sheet and (previously)
  // desktop's own floating bottom-left card.
  // "sidebar": this component is mounted inside WardMap's persistent right
  // `<aside>` instead, which already supplies the panel background, the
  // left border, and the scrolling — a second card nested inside that
  // column would just double up borders/shadows around content that's
  // already framed by the sidebar itself. Content is identical either way;
  // only the outer wrapper changes.
  variant?: "sheet" | "sidebar";
}

// The panel's visible heading, per-location instead of a fixed string —
// "{City} - Ward {n}" (or "{City} - {wardName} District" for the handful of
// cities that name rather than number their districts, same as roleLabel
// above) so a resident scanning a panel that stays mounted across
// hover/click can tell at a glance which location it's now showing,
// without reading down into the City section's OfficialCards. Falls back
// to just the city name for a Mayor-only match (city-wide, no ward), and
// to the previous static copy when the point falls outside every mapped
// city (§3.3 coverage honesty — no city officials resolved is not an
// error, just nothing to name).
function panelHeading(officials: AreaOfficials, hoveredCityName?: string | null): string {
  const wardRep = officials.city.find((rep) => rep.role === "Council Member");
  if (wardRep) return `${wardRep.city} - ${roleLabel(wardRep)}`;
  const cityRep = officials.city[0];
  if (cityRep) return cityRep.city;
  // No officials resolved at this point — most of the state, since the
  // city-limits backdrop layer (#72) is statewide but the officials layers
  // only cover the handful of cities in cities.ts. Name whichever city
  // limit the cursor/click actually landed inside anyway (passed down from
  // WardMap's hover/click handlers — see SelectedArea.hoveredCityName's own
  // comment) rather than falling through to the generic copy below: a
  // resident hovering Duluth should see "Duluth," not a location-less
  // placeholder, even though this site has no representatives for it yet.
  if (hoveredCityName) return hoveredCityName;
  return "Representatives for this location";
}

// The panel-level container: owns the one close button, the mobile
// drag-handle, and the outer scroll/height for the whole panel — none of
// which belong to any single official now that a panel can hold up to six
// of them. Always renders all three tiers (City/County/State) as stacked,
// always-visible sections — not tabs (see git history: #53 briefly made
// these ARIA tabs, reasoning that a resident would otherwise "scroll past
// City's full card stack" to reach County/State; reverted because the
// actual stack per AGENTS.md §Part 0's own resolveOfficialsAtPoint caps at
// ~6 cards total across all three tiers, not a stack worth avoiding, and
// AGENTS.md §0.1 — "Connection is the product... every detail panel
// answers 'what is this connected to' before 'what is this?'" — means the
// site's own #1 question, "who represents me?", should never require an
// extra click to see the county or state answer). Each tier renders either
// its official(s) or an honest "not covered here" note (AGENTS.md §3.3),
// regardless of which single LayerMode is toggled on the map: resolution
// happens in src/lib/officials.ts's resolveOfficialsAtPoint, independent
// of what's currently drawn on the map — the left sidebar's mode switcher
// and this panel are answering two different questions ("what's drawn on
// the map" vs. "who represents this specific point"), not the same one
// twice.
export default function WardModal({
  officials,
  onClose,
  hoveredCityName = null,
  jumpToTier = null,
  selectionKey = null,
  variant = "sheet",
}: WardModalProps) {
  const { scrollRootRef, onHeaderRef, onContentRef, headerHeight, spacerHeight, scrollToTier } = useTierStack();

  // Auto-scrolls to whichever tier the map's own hover/click just
  // resolved to (see WardModalProps.jumpToTier's own comment). Keyed on
  // selectionKey, not jumpToTier: two different wards both resolve to the
  // same jumpToTier ("city"), so keying on jumpToTier alone would only
  // ever fire when a hover crosses a *tier* boundary, not every time the
  // hovered feature actually changes within the same tier — selectionKey
  // is the one value that changes on every genuinely new hover/click (see
  // its own comment on WardModalProps). Skipped while headerHeight is
  // still 0 (not yet measured on first mount) since scrollToTier's math
  // needs it; the header-measuring effect in useTierStack re-renders once
  // it resolves, which re-runs this one too for a selection that arrived
  // before that first measurement landed.
  useEffect(() => {
    if (!jumpToTier || !selectionKey || !headerHeight) return;
    const index = TIER_SECTIONS.findIndex((tier) => tier.key === jumpToTier);
    if (index === -1) return;
    scrollToTier(index);
    // scrollToTier and jumpToTier are read for their current values, not
    // to decide *whether* to re-run — selectionKey alone already
    // uniquely identifies "the hover/click target changed," and
    // including the other two would either re-run this on every render
    // (scrollToTier is a fresh closure each time) or fire it twice for
    // one selection change (jumpToTier and selectionKey always update
    // together, from the same setSelected/selectPinned call).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, headerHeight]);

  // Both variants now scroll from the same div (the tier list below) rather
  // than sidebar additionally scrolling its own outer wrapper — sticky
  // positioning needs one unambiguous scrolling ancestor to dock against,
  // not two nested overflow-y-auto regions that only one of ever actually
  // engages.
  const wrapperClass =
    variant === "sidebar"
      ? "pointer-events-auto flex h-full w-full flex-col overflow-hidden"
      : "pointer-events-auto w-full sm:w-[380px] max-h-[75vh] sm:max-h-[80vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-hair bg-panel-2 shadow-2xl shadow-(color:--shadow-panel) overflow-hidden";

  // "sidebar": no role here — it's mounted inside WardMap's own persistent
  // `<aside aria-label="Representatives for this location">`, which already
  // carries the landmark naming; a second one on this inner div would be
  // redundant. "sheet": this variant IS the floating, dismissible overlay
  // (mobile bottom sheet), closer to true dialog semantics than the
  // sidebar's persistent column — unlike the removed per-OfficialCard
  // `role="dialog"` (an anti-pattern to repeat up to six times in one
  // panel), there's exactly one of these per panel, so it's the correct
  // place for it.
  const dialogProps =
    variant === "sheet" ? { role: "dialog" as const, "aria-label": "Representatives for this location" } : {};

  // Focus-trap gap fix (issue #79): "sheet" is the one variant of this
  // component that behaves like a true dialog — mounted/unmounted with the
  // selection, floating over MapLibre's scrim, closeable by Escape or the
  // close button above. Per AGENTS.md §4 "Keyboard Complete," a keyboard
  // user must not be able to Tab past it into whatever's behind it (the
  // map, or — on mobile — MobileNav's own tab bar). "sidebar" never gets
  // this: it's a persistent, always-mounted column, not a transient
  // overlay, so trapping focus in it would trap a keyboard user on every
  // hover, not just an explicit open. `active` no-ops the hook entirely
  // for that variant, so it's safe to call unconditionally here.
  const { containerRef, onKeyDown } = useFocusTrap<HTMLDivElement>(variant === "sheet");

  return (
    <div ref={containerRef} onKeyDown={onKeyDown} className={wrapperClass} {...dialogProps}>
      {/* Drag-handle affordance — bottom-sheet convention, mobile only */}
      <div className="sm:hidden flex justify-center pt-2 pb-1 shrink-0">
        <div className="h-1 w-9 rounded-full bg-hair-strong" />
      </div>

      {/* No border under the header fill (a prior pass added one; see git
          history) — the color change from PANEL_HEADER_BG down to the
          panel's own background is already the seam, matching
          mndatacenter.org's flatter chrome and WardMap.tsx's left
          "Filters" sidebar header, which dropped the same line for the
          same reason. */}
      <div
        className="flex items-center justify-between gap-2 px-4 pt-2 pb-2 sm:pt-4 shrink-0"
        style={{ backgroundColor: PANEL_HEADER_BG, color: PANEL_HEADER_TEXT }}
      >
        <h2 className="text-2xl font-extrabold">{panelHeading(officials, hoveredCityName)}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 -mr-1 h-9 w-9 flex items-center justify-center rounded-full hover:bg-black/10 active:bg-black/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Three stacked, always-visible sections (City/County/State, in the
          app's own question order — AGENTS.md Part 0) rather than tabs.
          Each section header is a real <h2> naming its tier, so a
          screen-reader user can jump straight to "County" or "State" via
          heading navigation without anything being hidden from the
          accessibility tree first — the keyboard-completeness goal #53's
          tablist chased, without #53's tradeoff of hiding two-thirds of a
          resident's own representation behind a click. No `role`/`hidden`
          bookkeeping needed: every section renders all the time, so
          there's no active/inactive state to keep in sync.

          Full-width navy band (the old active-tab fill, repurposed) rather
          than an inline pill: a resident scrolling through up to six
          stacked cards needs the City→County→State boundary to register
          at a glance, the same way the tab row's selected cell used to
          jump out — a small rounded badge sitting in open whitespace did
          that job far more weakly once there was no longer a tab strip
          drawing the eye to this row in the first place. */}
      <div ref={scrollRootRef} className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
        <TierNode index={0} officials={officials} onHeaderRef={onHeaderRef} onContentRef={onContentRef} headerHeight={headerHeight} />
        {/* Reserves exactly enough extra scroll room for State's header to
            reach its dock line — no more. Sized in useTierStack from
            State's own measured height (`viewport - stackHeight -
            stateContentHeight`, floored at 0), not a fixed formula: a
            constant `100% - stackHeight` spacer (an earlier version of
            this) reserved the worst case unconditionally, leaving a wall
            of blank space below State once it had real content. This
            shrinks live as State's content grows via the ResizeObserver
            in that hook. */}
        <div aria-hidden style={{ height: `${spacerHeight}px` }} />
      </div>
    </div>
  );
}
