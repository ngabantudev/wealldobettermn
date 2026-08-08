"use client";

import { useEffect, useRef, useState } from "react";
import type { BillVote, RepProperties } from "@/lib/types";
import type { AreaOfficials } from "@/lib/officials";
import { officialIdentity } from "@/lib/officials";
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

function IconChevron() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5 shrink-0 transition-transform duration-150 group-open:rotate-180">
      <path d="m5.5 7.5 4.5 5 4.5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A card's committees/party-unity/recent-votes/meetings/office-details
// block starts expanded when there isn't much in it yet (today's reality
// for almost every seat — most feeds carry a handful of votes at most)
// and starts collapsed once it's grown past a skim-friendly length, so a
// resident scanning up to six stacked cards for "who represents me" isn't
// forced to scroll past a wall of roll-call history for every single one.
// Threshold is on recentVotes specifically — the section §3.2's Legistar/
// Open States integrations are actively growing over time (see #57, #60),
// not on committees or the static office-details fields, which don't grow
// on their own. Nothing here is ever permanently hidden: it's a starting
// state a resident can always open, never a removed feature.
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
          <h4 className="text-lg font-bold text-ink leading-tight truncate">{repName ?? "Vacant / TBD"}</h4>
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
          unity, recent votes, meetings, office/profile links — is the
          "go deeper" material, collapsed behind a single native
          <details>/<summary> disclosure rather than each having its own
          always-rendered block. Unlike the City/County/State tiers this
          replaced tabs for, hiding this doesn't hide *who represents you*
          — name, role, party, and how to reach them are all already
          visible above, unconditionally. This only compresses the
          receipts a resident can choose to go read, per AGENTS.md §0.2 —
          they're still one click away, not removed.
          Starts open when there's not much here yet (DEFAULT_OPEN_VOTE_
          THRESHOLD, see that constant's own comment) so today's sparse
          feeds cost zero extra clicks; starts closed once a seat's vote
          history has actually grown enough to be worth collapsing. */}
      <details open={recentVotes.length <= DEFAULT_OPEN_VOTE_THRESHOLD} className="group border-t border-hair">
        <summary
          className="flex list-none items-center justify-between gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-3 cursor-pointer select-none hover:bg-sidebar-hover [&::-webkit-details-marker]:hidden"
        >
          More details
          <IconChevron />
        </summary>

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
          <div className="border-t border-hair px-4 py-3 flex flex-wrap gap-1.5">
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
            tie-breaking votes as one. */}
        {rep.role !== "Mayor" && (
          <div className="border-t border-hair px-4 py-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2.5">
              <IconBallot />
              Recent votes
            </div>
            {recentVotes.length > 0 ? (
              <ul className="space-y-2.5">
                {recentVotes.map((vote) => (
                  <VoteRow key={vote.voteId} vote={vote} accent={accent} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">No voting record connected yet for {areaLabel(rep)}.</p>
            )}
          </div>
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
            <p className="text-sm text-ink-3">No meetings feed connected yet for {rep.city}.</p>
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

        {(rep.officeRoom || neighborhoods.length > 0 || rep.profileUrl) && (
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
            {rep.profileUrl && (
              <a
                href={rep.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium hover:underline pt-0.5"
                style={{ color: accent }}
              >
                View official profile
                <IconExternal />
              </a>
            )}
          </div>
        )}
      </details>
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

// Drives the "stacking" scroll effect on the City/County/State sections:
// each tier's <h2> docks via plain CSS `position: sticky` at an offset equal
// to however many headers are already stacked above it (index * headerH),
// which is what makes County's header park directly under City's, then
// State's under County's, as the user scrolls — no JS needed for that part.
//
// What *does* need JS is collapsing a tier's content once it's been fully
// scrolled underneath the header stack: sticky alone leaves that content
// sitting there, invisible but still occupying scroll height, so a resident
// keeps scrolling through empty space to reach the next tier. An
// IntersectionObserver per non-first header watches the line each header
// docks at (root margin shrunk from the top by index * headerH). When a
// header crosses that line, the tier above it collapses; scrolling back up
// past the line un-collapses it, so the motion is symmetric in both
// directions, matching how sticky headers behave natively.
//
// Deliberately does not touch the DOM presence of collapsed content — no
// `hidden`, no `aria-hidden`. Collapsing only changes a CSS grid track to
// 0fr and clips it with `overflow-hidden`; the section, its <h2>, and its
// officials remain in the accessibility tree exactly as before. That's the
// same reason #53's tab version got reverted (see the comment above
// TIER_SECTIONS's render below) — this is a scroll-driven compaction, not a
// click-gated hide, so it doesn't reintroduce that tradeoff.
function useStackedTierCollapse(sectionCount: number) {
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const headerRefs = useRef<Array<HTMLHeadingElement | null>>([]);
  const [collapsed, setCollapsed] = useState<boolean[]>(() => Array(sectionCount).fill(false));
  // Measured once from the first header, then reused as every header's
  // `top` offset (index * headerHeight) — all three tier headers share the
  // same classes, so one measurement is enough for the whole stack.
  const [headerHeight, setHeaderHeight] = useState(0);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;

    const firstHeader = headerRefs.current[0];
    const measuredHeight = firstHeader?.getBoundingClientRect().height ?? 0;
    if (!measuredHeight) return;
    setHeaderHeight(measuredHeight);

    // One observer per header that has a predecessor to collapse — header 0
    // (City) never collapses anything above it.
    const observers: IntersectionObserver[] = [];
    for (let i = 1; i < sectionCount; i += 1) {
      const header = headerRefs.current[i];
      if (!header) continue;
      const observer = new IntersectionObserver(
        ([entry]) => {
          setCollapsed((prev) => {
            if (prev[i - 1] === !entry.isIntersecting) return prev;
            const next = [...prev];
            next[i - 1] = !entry.isIntersecting;
            return next;
          });
        },
        { root, rootMargin: `-${Math.round(i * measuredHeight)}px 0px 0px 0px`, threshold: 0 },
      );
      observer.observe(header);
      observers.push(observer);
    }
    return () => observers.forEach((o) => o.disconnect());
    // sectionCount only ever changes with TIER_SECTIONS, which is a static
    // module-level constant — this effect re-measures on every mount, which
    // is the only time header layout can change.
  }, [sectionCount]);

  return { scrollRootRef, headerRefs, collapsed, headerHeight };
}

export interface WardModalProps {
  officials: AreaOfficials;
  onClose: () => void;
  // Which city-limit polygon the cursor/click is actually inside, per
  // WardMap's SelectedArea.hoveredCityName — see that field's own comment.
  // Only ever consulted by panelHeading, and only when `officials.city`
  // came back empty.
  hoveredCityName?: string | null;
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
export default function WardModal({ officials, onClose, hoveredCityName = null, variant = "sheet" }: WardModalProps) {
  const { scrollRootRef, headerRefs, collapsed, headerHeight } = useStackedTierCollapse(TIER_SECTIONS.length);

  // Both variants now scroll from the same div (the tier list below) rather
  // than sidebar additionally scrolling its own outer wrapper — the sticky
  // headers and the IntersectionObserver above both need one unambiguous
  // scrolling ancestor to dock/collapse against, not two nested
  // overflow-y-auto regions that only one of ever actually engages.
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

  return (
    <div className={wrapperClass} {...dialogProps}>
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
      <div ref={scrollRootRef} className="flex-1 min-h-0 overflow-y-auto">
        {TIER_SECTIONS.map(({ key, label, emptyNote }, index) => {
          const reps = officials[key];
          const headingId = `officials-tier-${key}-heading`;
          const isCollapsed = collapsed[index] ?? false;
          return (
            <section key={key} aria-labelledby={headingId}>
              {/* Sticky, not fixed: each header docks at a `top` offset
                  equal to the ones already stacked above it, so City parks
                  at the very top of the scroll region, County slides up and
                  parks directly under it, then State under County — plain
                  CSS position:sticky stacking, no JS involved in the
                  docking itself. */}
              <h2
                ref={(el) => {
                  headerRefs.current[index] = el;
                }}
                id={headingId}
                className="sticky z-10 px-4 py-2 text-xs font-semibold uppercase tracking-wide"
                style={{ top: `${index * headerHeight}px`, backgroundColor: TIER_HEADER_BG, color: TIER_HEADER_TEXT }}
              >
                {label}
              </h2>
              {/* Collapses to 0 height once this tier has scrolled fully
                  under the header stack (see useStackedTierCollapse above)
                  and re-expands scrolling back up past that point — a CSS
                  grid-track animation rather than max-height, since it
                  doesn't need a hardcoded/guessed content height. The
                  content itself is never removed from the DOM or marked
                  aria-hidden, so heading navigation still reaches every
                  tier's officials regardless of collapsed state. */}
              <div
                className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
                  isCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
                }`}
              >
                <div className="overflow-hidden">
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
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
