"use client";

import { useEffect, useRef, useState } from "react";
import type { BillVote, RepProperties } from "@/lib/types";
import type { AreaOfficials } from "@/lib/officials";
import { officialIdentity, officialSlug } from "@/lib/officials";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { touchTargetClass } from "@/lib/variantClasses";
import Gloss from "@/components/Gloss";
import type { GlossaryKey } from "@/lib/glossary";
import { CITY_TIER_EMPTY_NOTE, COUNTY_TIER_EMPTY_NOTE, STATE_TIER_EMPTY_NOTE } from "@/lib/coverage";
import {
  CONTESTED_COLOR,
  CONTESTED_COLOR_SOFT,
  partyColor,
  partyColorSoft,
  TIER_HEADER_BG,
  TIER_HEADER_TEXT,
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
// Plain-language labels per AGENTS.md §0.9 — spelled out for the three
// options a resident could otherwise misread, not just recolored. label/
// color/colorSoft stay local here (presentation, not glossary data — see
// glossary.ts's header comment on that split); the gloss *text* itself
// now lives once in src/lib/glossary.ts's GLOSSARY, keyed by
// `glossaryKey` below, so this table and Gloss.tsx's other two call
// sites (meetings/bills pages) can never drift apart on wording. yes/no
// carry no `glossaryKey` at all — no gloss is shown for them, same as
// before.
const VOTE_OPTION_DISPLAY: Record<string, { label: string; color: string; colorSoft: string; glossaryKey?: GlossaryKey }> = {
  yes: { label: "Voted Yes", color: "var(--vote-yes)", colorSoft: "var(--vote-yes-soft)" },
  no: { label: "Voted No", color: "var(--vote-no)", colorSoft: "var(--vote-no-soft)" },
  absent: { label: "Absent", color: STALE_COLOR, colorSoft: STALE_COLOR_SOFT, glossaryKey: "vote-absent" },
  excused: { label: "Excused", color: STALE_COLOR, colorSoft: STALE_COLOR_SOFT, glossaryKey: "vote-excused" },
  "not voting": { label: "Present, No Vote", color: STALE_COLOR, colorSoft: STALE_COLOR_SOFT, glossaryKey: "vote-not-voting" },
};
const DEFAULT_VOTE_OPTION_DISPLAY = {
  label: "Other",
  color: STALE_COLOR,
  colorSoft: STALE_COLOR_SOFT,
  glossaryKey: "vote-other" as GlossaryKey,
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

// Renders whatever the current term entry actually knows, per issue #96 —
// never a guess, never the old officeSince sentinel. termsOfService always
// has exactly one entry today (historical backfill is a separate issue,
// #98), but this still looks it up by `current` rather than assuming
// index 0, since that's the field that actually means "this one."
function currentTermLabel(rep: RepProperties): string {
  // Array.isArray guard is rollout safety, not a type workaround:
  // public/state-legislature.geojson is refreshed by a script that needs
  // a real OPEN_STATES_API_KEY (AGENTS.md §3.2 — "cache the response,
  // commit the derived output"), so a build can genuinely ship this
  // component before that file has been regenerated onto the new
  // termsOfService shape. Falling through to the "not published" label
  // for that stale-shape case beats a hard crash on every state
  // legislator's panel — see LESSONS.md's node:fs incident for why a
  // static-data assumption that's true today but not yet true everywhere
  // is exactly the class of bug that takes down a whole route.
  const currentTerm = Array.isArray(rep.termsOfService) ? rep.termsOfService.find((term) => term.current) : undefined;
  const termStart = currentTerm?.termStart ?? null;
  const termEnd = currentTerm?.termEnd ?? null;
  if (termStart && termEnd) {
    return `${rep.repParty} · current term: ${formatOfficeSince(termStart)} – ${formatOfficeSince(termEnd)}`;
  }
  if (termEnd) {
    return `${rep.repParty} · current term expires ${formatOfficeSince(termEnd)} (start date not published)`;
  }
  if (termStart) {
    return `${rep.repParty} · in office since ${formatOfficeSince(termStart)} (term-end date not published)`;
  }
  return `${rep.repParty} · in office — term dates not published by the city`;
}

// Every mapped city's own official council-meetings/agenda calendar
// page, each individually verified live (fetched and confirmed to be a
// real, current meetings/agenda page, not guessed from a URL pattern).
// This is the entire content of the "meetings" section below: AGENTS.md
// §3.1 requires deleting fabricated hearing data outright rather than
// labeling it, so there is no meetings feed here at all, real or
// synthetic — only an honest pointer to where a resident can find one
// themselves. A city missing from this table falls back to
// CITY_OFFICIAL_WEBSITE_URL below (the city's general homepage, verified
// but not a specific meetings/agenda page), and only falls further than
// that — a plain-text "check your city's website" prompt with no link at
// all — for a city missing from both, which shouldn't happen for any
// currently covered city (every one of CITIES has a verified homepage as
// of 2026-08-09; see that table's own comment) but is kept as the honest
// floor for whatever gap shows up next, per this file's "never guess a
// link" rule.
const CITY_MEETINGS_URL: Partial<Record<string, string>> = {
  Minneapolis: "https://lims.minneapolismn.gov/Calendar/all/upcoming",
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

// Every covered city's general official government homepage — a lower,
// honestly-labeled fallback tier under CITY_MEETINGS_URL above: when this
// app hasn't (yet) pinned down a city's specific meetings/agenda sub-page,
// pointing to nothing at all ("check your city's website," no link) is a
// weaker action than it needs to be, per AGENTS.md §0.6 ("every record
// ends in an action"). The label on this tier says "official website,"
// never "meeting calendar" — it would be dishonest to imply this link
// lands a resident on an agenda page when it's only confirmed to be the
// homepage.
//
// Every entry verified live on 2026-08-09 — each domain confirmed via a
// real fetch (page title, official branding/seal, and a city-hall address
// matching the jurisdiction) to be that city's own current government
// site, not a chamber of commerce, real-estate listing, or Wikipedia
// mirror; a legacy domain still redirecting to the URL listed here
// (several MN cities have migrated ci.<name>.mn.us → <name>mn.gov in
// recent years) counted as corroboration, not the source itself. Medina
// and Brooklyn Center block automated fetchers at the network layer
// (Akamai bot protection, 403 on every path) — for those two only, the
// live 301 redirect from each city's own legacy domain plus independent
// corroboration (search index + Wikipedia's infobox) stood in for a
// direct page load. Most cities already in CITY_MEETINGS_URL above also
// have an entry here (harmless — that table always wins when both exist)
// so this table stays a complete, reusable "every covered city's own
// homepage" reference rather than only the leftover cities.
const CITY_OFFICIAL_WEBSITE_URL: Partial<Record<string, string>> = {
  Champlin: "https://www.champlinmn.gov/",
  Crystal: "https://www.crystalmn.gov/",
  Robbinsdale: "https://www.robbinsdalemn.gov/",
  Fridley: "https://www.fridleymn.gov/",
  Ramsey: "https://www.cityoframseymn.gov/",
  Woodbury: "https://www.woodburymn.gov/",
  Eagan: "https://cityofeagan.com/",
  Lakeville: "https://www.lakevillemn.gov/",
  "Maple Grove": "https://www.maplegrovemn.gov/",
  "Apple Valley": "https://www.applevalleymn.gov/",
  Burnsville: "https://www.burnsvillemn.gov/",
  Edina: "https://www.edinamn.gov/",
  "Eden Prairie": "https://www.edenprairiemn.gov/",
  Rochester: "https://www.rochestermn.gov/",
  Duluth: "https://duluthmn.gov/",
  "St. Cloud": "https://www.ci.stcloud.mn.us/",
  "Golden Valley": "https://www.goldenvalleymn.gov/",
  "New Hope": "https://www.newhopemn.gov/",
  "Columbia Heights": "https://www.columbiaheightsmn.gov/",
  Dayton: "https://www.daytonmn.gov/",
  Hopkins: "https://www.hopkinsmn.com/",
  Deephaven: "https://deephaven.gov/",
  Medina: "https://www.medinamn.gov/",
  Hilltop: "https://www.hilltopmn.gov/",
  Wayzata: "https://www.wayzata.org/",
  Corcoran: "https://www.corcoranmn.gov/",
  "Brooklyn Center": "https://www.brooklyncentermn.gov/",
  Loretto: "https://lorettomn.gov/",
  Woodland: "https://cityofwoodlandmn.gov/",
};

// State-chamber equivalent of CITY_MEETINGS_URL above — same honest-link
// pattern (AGENTS.md §3.1: no fabricated feed, just a verified pointer to
// the chamber's own calendar), keyed by rep.chamber rather than rep.city.
// Neither chamber has a wired Legistar-style feed the way St. Paul/
// Hennepin do, so this always falls through to the plain-link branch, not
// the NextMeetingTeaserLine one — there is no NEXT_MEETING_TEASERS entry
// for "house"/"senate" and none should be added until a real feed exists.
const STATE_CHAMBER_MEETINGS_URL: Record<"house" | "senate", string> = {
  house: "https://www.house.mn.gov/schedules/dayonfloor",
  senate: "https://www.senate.mn/schedule/senate/upcoming-all",
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
  // wardName is the complete override label, used as-is — not just a name
  // with " District" appended here, which assumed every city's own term
  // reads as "{name} District" (true for Brooklyn Park's "Central District"
  // etc., false for Duluth's "District 1", which reads the other way
  // round). fetch-wards.mjs now bakes the full label in at the source
  // instead (2026-08 Duluth batch) — see its own comment on this.
  if (rep.wardName) return rep.wardName;
  if (rep.ward !== null) return `Ward ${rep.ward}`;
  if (rep.district !== null) return `District ${rep.district}`;
  if (rep.stateDistrict !== null) return `District ${rep.stateDistrict}`;
  // No locator field at all: a Mayor (city-wide by definition, no locator
  // needed) or an at-large Council Member (city-wide seat, same absence of
  // a locator for the same reason) — the two are indistinguishable by
  // locator fields alone, so fall back to `rep.role`, which every
  // RepProperties always carries. Previously fell through to "Mayor"
  // unconditionally, which mislabeled every at-large Council Member across
  // every fully-at-large city (Woodbury, Eagan, Lakeville, Maple Grove,
  // Apple Valley, Burnsville, Edina, Eden Prairie) as "Mayor" in this badge
  // — found while scoping mixed ward + at-large councils (Rochester,
  // Duluth, St. Cloud), where the same fallback would otherwise mislabel
  // every at-large seat sitting alongside real ward seats too.
  return rep.role === "Mayor" ? "Mayor" : "At-Large";
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
// still worth a collapsible disclosure at all.
function IconChevron() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5 shrink-0 transition-transform duration-150 group-open:rotate-180">
      <path d="m5.5 7.5 4.5 5 4.5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Recent votes always starts collapsed — city view (WardMap.tsx's
// enterCityView/resolveAllCityOfficials) can stack every one of a city's
// council members in this panel at once now, not just whichever one a
// point happened to resolve to, and almost none of them have any recorded
// votes yet (most seats' feeds are still empty), so an auto-expand-when-
// short heuristic here used to mean N nearly-identical "not tracked yet"
// blocks expanded back to back — exactly the wall-of-content-to-scroll-
// past this disclosure exists to avoid, just inverted. Nothing here is
// ever permanently hidden: it's a starting state a resident can always
// open per card, never a removed feature.

// One recent-votes row. The plain-language gloss for a non-yes/no option
// (see VOTE_OPTION_DISPLAY, and the shared gloss text it now points into,
// src/lib/glossary.ts) is real information, but printing it on every row
// unconditionally reads as clutter once a card has 5 of these stacked —
// most residents scanning the list already read "Absent" as "wasn't
// there" without help. Hidden by default, revealed on hover (the badge's
// native `title` tooltip, via Gloss's own default) or tap/click/keyboard
// (Gloss's toggle, since touch has no hover state to fall back on) — same
// "info available on demand, not forced on everyone" shape as before,
// generalized into Gloss.tsx per AGENTS.md §0.9. yes/no rows have no
// glossaryKey at all, so they stay a plain, non-interactive span exactly
// as before.
function VoteRow({ vote, accent }: { vote: BillVote; accent: string }) {
  const display = voteOptionDisplay(vote.option);
  const badgeClassName = "text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset";
  const badgeStyle = { color: display.color, backgroundColor: display.colorSoft };

  return (
    <li className="text-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-ink">{vote.identifier}</span>
        {display.glossaryKey ? (
          <Gloss term={display.glossaryKey} className={badgeClassName} style={badgeStyle} glossClassName="block text-xs italic text-ink-3">
            {display.label}
          </Gloss>
        ) : (
          <span className={badgeClassName} style={badgeStyle}>
            {display.label}
          </span>
        )}
      </div>
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
          {/* Name leads the card, title trails it on the same line
              ("Kaohly Her - ST. PAUL MAYOR") — a resident scanning up to
              six stacked cards is looking for a person first, the office
              badge second (PR review, 2026-08-09). */}
          <h4 className="text-lg font-bold text-ink leading-tight">
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
            {" "}
            <span
              className="text-[11px] font-semibold uppercase tracking-wide align-middle"
              style={{ color: accent }}
            >
              - {areaLabel(rep)} {roleLabel(rep)}
            </span>
          </h4>
          <div className="text-xs text-ink-3 mt-1">{currentTermLabel(rep)}</div>
        </div>
      </div>

      {/* Committees render in their own full-width row below the avatar/
          name row, not nested in the name column beside the avatar — a
          long committee list wrapped inside that narrower column before
          (PR review, 2026-08-09). This div spans the card's full width and
          never truncates, so every committee/title is always fully
          readable, not just whichever fit in the avatar-constrained
          column. Mayors' `committees` field is really just a restated
          title ("Mayor of Saint Paul" — see scripts/fetch-mayors.mjs), not
          a real committee assignment, and that title already renders in
          the heading above — showing it again here would be a duplicated,
          meaningless "committee," so this excludes Mayor only; every
          other role's committees array is real seat/committee
          membership. */}
      {committees.length > 0 && rep.role !== "Mayor" && (
        <div className="px-4 pb-3 flex flex-wrap gap-1.5">
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
      {(rep.repEmail || rep.repPhone || rep.officeRoom) && (
        <div className="px-4 pb-3 space-y-2">
          {(rep.repEmail || rep.repPhone) && (
            <div className="flex items-center gap-2">
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
          {/* Office address now lives with Email/Phone — all three are the
              same "how do I reach this person" action (AGENTS.md §0.6) —
              rather than in its own section down past committees/votes/
              meetings, where it used to sit alongside neighborhoods (a
              different kind of fact entirely: what the seat covers, not
              how to contact it). Neighborhoods keeps its own section below,
              unchanged. */}
          {rep.officeRoom && (
            <div className="flex items-start gap-1.5 text-xs text-ink-3">
              <span className="mt-0.5">
                <IconBuilding />
              </span>
              <span>{rep.officeRoom}</span>
            </div>
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
            <summary> disclosure (see the comment above it) rather than
            always-open like everything else here — a growing roll-call
            history is the one part of this card that doesn't have a
            natural skim-friendly length, unlike a fixed committee-
            membership list or a single meetings note. Always starts
            closed (see that same comment). */}
        {rep.role !== "Mayor" && (
          <details className="group border-t border-hair">
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
            feed relabeled as real.

            Lives on the Mayor's card only, not every Council Member's —
            NEXT_MEETING_TEASERS/CITY_MEETINGS_URL are keyed by rep.city,
            never by ward or member, because a city council has exactly
            one meeting calendar. This used to gate on isWard instead
            (every ward Council Member got an identical copy, the Mayor
            got none at all) — harmless in a single-card view, but city
            view (WardMap.tsx's enterCityView/resolveAllCityOfficials) can
            now stack every one of a city's council members in this panel
            at once, and N byte-identical "see the city's own calendar"
            blocks in a row is a resident scrolling past pure repetition,
            not information. The Mayor's card is the one place per city
            this can render exactly once — present for every city model,
            including a fully at-large one with no ward-based seats at
            all (Woodbury, Eagan, ...), which the old isWard gate quietly
            never showed this section for either. If a genuinely
            per-member meetings fact ever exists (attendance at a
            specific meeting, say), that's a new fact belonging next to
            Recent votes below — not a reason to keep re-rendering this
            same citywide link on every card in the meantime. */}
        {rep.role === "Mayor" && (
          <details className="group border-t border-hair">
            <summary className="flex list-none items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none hover:bg-sidebar-hover [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">
                <IconCalendar />
                Meetings
              </span>
              <IconChevron />
            </summary>
            <div className="px-4 pb-3">
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
              {/* Three tiers, in honesty order: a verified specific
                  meetings/agenda page, then a verified general homepage
                  (CITY_OFFICIAL_WEBSITE_URL's own comment), then — only
                  for a city missing from both, which shouldn't happen for
                  anything currently covered — unlinked plain text. The
                  label changes with the tier: "meeting calendar" is only
                  ever claimed for a link actually confirmed to be one. */}
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
              ) : CITY_OFFICIAL_WEBSITE_URL[rep.city] ? (
                <a
                  href={CITY_OFFICIAL_WEBSITE_URL[rep.city]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium hover:underline mt-1"
                  style={{ color: accent }}
                >
                  Visit {rep.city}&rsquo;s official website
                  <IconExternal />
                </a>
              ) : (
                <p className="text-xs text-ink-4 mt-1">Check {rep.city}&rsquo;s official website for upcoming meetings.</p>
              )}
            </div>
          </details>
        )}

        {/* County tier equivalent of the block above — Hennepin County
            Board also has a wired Legistar feed (issue #58). No
            "no feed" fallback copy here (unlike the city block): a county
            commissioner card with nothing to show for a county
            meetingsRegistry.ts doesn't cover just renders nothing, same
            as this card did for every county before this feed existed. */}
        {!isWard && rep.county && NEXT_MEETING_TEASERS[rep.county] && (
          <details className="group border-t border-hair">
            <summary className="flex list-none items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none hover:bg-sidebar-hover [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">
                <IconCalendar />
                Meetings
              </span>
              <IconChevron />
            </summary>
            <div className="px-4 pb-3">
              <NextMeetingTeaserLine teaser={NEXT_MEETING_TEASERS[rep.county]} />
            </div>
          </details>
        )}

        {/* State-chamber equivalent of the City/County Meetings blocks
            above (issue: state cards had no Meetings section at all,
            unlike City/County). Same honest-link pattern as the City
            block — always renders, no NextMeetingTeaserLine branch, since
            neither chamber has a wired feed the way St. Paul/Hennepin do
            (see STATE_CHAMBER_MEETINGS_URL's own comment). */}
        {rep.chamber !== null && (
          <details className="group border-t border-hair">
            <summary className="flex list-none items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none hover:bg-sidebar-hover [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">
                <IconCalendar />
                Meetings
              </span>
              <IconChevron />
            </summary>
            <div className="px-4 pb-3">
              <p className="text-sm text-ink-3">
                No meetings feed connected yet for the MN {rep.chamber === "house" ? "House" : "Senate"}.
              </p>
              <a
                href={STATE_CHAMBER_MEETINGS_URL[rep.chamber]}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium hover:underline mt-1"
                style={{ color: accent }}
              >
                See the {rep.chamber === "house" ? "House" : "Senate"}&rsquo;s own schedule
                <IconExternal />
              </a>
            </div>
          </details>
        )}

        {neighborhoods.length > 0 && (
          <div className="border-t border-hair px-4 py-3 text-xs text-ink-3">
            <div className="flex items-start gap-1.5">
              <span className="mt-0.5">
                <IconPin />
              </span>
              <span>{neighborhoods.join(", ")}</span>
            </div>
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
          history) — the color change from the header down to the panel's
          own background is already the seam, matching mndatacenter.org's
          flatter chrome.
          "band-sub" — a dark neutral charcoal (globals.css's `.band-sub`
          token overrides), not the navy-field flag treatment SiteHeader.tsx's
          masthead uses. Used to be a flat PANEL_HEADER_BG green fill
          (cityTheme.ts), then briefly the full navy `.band` flag treatment
          — walked back off navy for the same reason WardMap.tsx's left
          "Filters" header moved off it: this is the masthead's subordinate,
          not a second identity bar competing with it, and the reference
          implementation (mndatacenter.org) draws that same line between its
          own `.band` masthead and a separate neutral `.band-sub` strip.
          Water Blue stays as the accent color here — see `.band-sub`'s own
          comment in globals.css for why that isn't neutralized too.
          `.band-sub` is light-mode only by design (falls back to the
          workspace's own near-black in dark mode, matching `.band`) — see
          that class's own comment in globals.css. */}
      <div className="band-sub flex items-center justify-between gap-2 px-4 pt-2 pb-2 sm:pt-4 shrink-0 bg-panel text-ink">
        <h2 className="text-2xl font-extrabold">{panelHeading(officials, hoveredCityName)}</h2>
        {/* Visible circle stays h-9 w-9 (36px) — larger reads heavy against
            the heading's own line height — but touchTargetClass grows the
            tappable hit area to the AGENTS.md §4 44px floor on mobile; this
            is the surface a resident is most likely to dismiss with a
            thumb (mobile's raised sheet), so it gets the same floor
            AreaFilterList/CoverageNotice's controls do rather than being
            exempt as "just a modal chrome button." Collapses back to the
            circle's own box at sm+, where this modal is a centered dialog,
            not a sheet. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={`shrink-0 -mr-1 h-9 w-9 flex items-center justify-center rounded-full hover:bg-black/10 active:bg-black/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${touchTargetClass(36)}`}
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
