"use client";

import { useState } from "react";
import type { RepProperties } from "@/lib/types";
import type { AreaOfficials } from "@/lib/officials";
import { officialIdentity } from "@/lib/officials";
import { CITY_TIER_EMPTY_NOTE, COUNTY_TIER_EMPTY_NOTE, STATE_TIER_EMPTY_NOTE } from "@/lib/coverage";
import { CONTESTED_COLOR, CONTESTED_COLOR_SOFT, partyColor, partyColorSoft } from "@/lib/cityTheme";
import { isStale } from "@/lib/electionConfig";

// mn.gov's own header treatment (mn.gov/portal/css/core.css:
// .header_formatting{background:#003865;border-bottom:1px solid #9bcbeb}),
// matched exactly rather than approximated — same navy the mn.gov masthead
// itself uses, with the same light-blue hairline it pairs underneath. A
// fixed brand color, not a themed one — same reasoning as CONTESTED_COLOR/
// STALE_COLOR below: it should read the same in light and dark mode.
// Unlike the accent green this replaced, white text on this navy is a
// clean ~12.7:1 contrast — mn.gov's own white-on-#003865 header text holds
// up fine here, so no departure from the reference needed this time.
const TIER_HEADER_BG = "#003865";
const TIER_HEADER_TEXT = "#FFFFFF";
const TIER_HEADER_BORDER = "#9BCBEB";

// The panel-level "Representatives for this location" bar (below), in
// mn.gov's own accent green rather than its header navy — deliberately a
// different color from the City/County/State bars above so the one panel
// title reads as a distinct level from the three sections under it, not a
// fourth one. Same live-sourced value as the tier headers' original green
// (mn.gov/portal/css/core.css's .btn-success/.label-success).
//
// Text color was picked by contrast ratio, not eyeballed: plain white
// against this green is only ~2.3:1 (WCAG AA needs 4.5:1 for text this
// size), plain black clears it at ~9.19:1 but reads flat/harsh against a
// saturated brand color. This near-black, faintly green-tinted value
// clears WCAG AAA (7:1, the stricter of the two standards) at ~7.9:1 while
// still visually belonging to the same green rather than looking like an
// unrelated black label dropped on top of it — the same "tint your dark
// text toward the background hue instead of using pure black" move most
// professional design systems make for text on a saturated color.
const PANEL_HEADER_BG = "#78BE21";
const PANEL_HEADER_TEXT = "#0B1A08";

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
const STALE_COLOR = "#B45309";
const STALE_COLOR_SOFT = "#FEF3C7";

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

// Points down when a section is expanded, rotated to point right (via the
// caller's className) when collapsed — same single-glyph-plus-rotation
// approach as WardMap's own IconChevron, kept local here rather than
// imported since WardMap.tsx already imports *from* this file and a
// reverse import would be circular.
function IconChevronDown({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none ${className}`}
    >
      <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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

      {rep.partyUnityPercent !== null && (
        <div className="px-4 pb-3">
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

      {recentVotes.length > 0 && (
        <div className="border-t border-hair px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2.5">
            <IconBallot />
            Recent votes
          </div>
          <ul className="space-y-2.5">
            {recentVotes.map((vote) => (
              <li key={vote.voteId} className="text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-ink">{vote.identifier}</span>
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0"
                    style={
                      vote.option === "yes"
                        ? { color: "#166534", backgroundColor: "#DCFCE7" }
                        : { color: "#991B1B", backgroundColor: "#FEE2E2" }
                    }
                  >
                    Voted {vote.option}
                  </span>
                </div>
                <div className="text-xs text-ink-3">{vote.title}</div>
                {vote.openstatesUrl && (
                  <a
                    href={vote.openstatesUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium hover:underline"
                    style={{ color: accent }}
                  >
                    View bill
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(rep.repEmail || rep.repPhone) && (
        <div className="px-4 pb-3 flex items-center gap-2">
          {rep.repEmail && (
            <a
              href={`mailto:${rep.repEmail}`}
              className="flex items-center gap-1.5 text-xs font-medium text-ink-2 border border-hair rounded-full px-3 py-1.5 hover:bg-hover active:bg-hair-strong"
            >
              <IconMail />
              Email
            </a>
          )}
          {rep.repPhone && (
            <a
              href={`tel:${rep.repPhone.replace(/[^\d+]/g, "")}`}
              className="flex items-center gap-1.5 text-xs font-medium text-ink-2 border border-hair rounded-full px-3 py-1.5 hover:bg-hover active:bg-hair-strong"
            >
              <IconPhone />
              {rep.repPhone}
            </a>
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

export interface WardModalProps {
  officials: AreaOfficials;
  onClose: () => void;
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
function panelHeading(officials: AreaOfficials): string {
  const wardRep = officials.city.find((rep) => rep.role === "Council Member");
  if (wardRep) return `${wardRep.city} - ${roleLabel(wardRep)}`;
  const cityRep = officials.city[0];
  if (cityRep) return cityRep.city;
  return "Representatives for this location";
}

// The panel-level container: owns the one close button, the mobile
// drag-handle, and the outer scroll/height for the whole panel — none of
// which belong to any single official now that a panel can hold up to six
// of them. Always renders all three tiers (City/County/State), each either
// its official(s) or an honest "not covered here" note (AGENTS.md §3.3),
// regardless of which single LayerMode is toggled on the map: resolution
// happens in src/lib/officials.ts's resolveOfficialsAtPoint, independent
// of what's currently drawn.
export default function WardModal({ officials, onClose, variant = "sheet" }: WardModalProps) {
  // Which tier headers the resident has collapsed, by tapping/clicking
  // them — starts empty (every section expanded), matching the panel's
  // original always-show-everything behavior. Lives here, not per-tier
  // useState, since WardModal stays mounted across hover/click selection
  // changes (only `officials` itself changes), so a collapse choice
  // persists as the resident moves the cursor around the map instead of
  // resetting on every new selection.
  const [collapsedTiers, setCollapsedTiers] = useState<ReadonlySet<keyof AreaOfficials>>(() => new Set());
  const toggleTier = (key: keyof AreaOfficials) => {
    setCollapsedTiers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const wrapperClass =
    variant === "sidebar"
      ? "pointer-events-auto flex h-full w-full flex-col overflow-y-auto"
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

      <div
        className="flex items-center justify-between gap-2 px-4 pt-2 pb-2 sm:pt-4 shrink-0"
        style={{ backgroundColor: PANEL_HEADER_BG, color: PANEL_HEADER_TEXT }}
      >
        <h2 className="text-lg font-extrabold">{panelHeading(officials)}</h2>
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

      <div className="overflow-y-auto">
        {TIER_SECTIONS.map(({ key, label, emptyNote }) => {
          const reps = officials[key];
          const headingId = `officials-tier-${key}`;
          const contentId = `officials-tier-${key}-content`;
          const isCollapsed = collapsedTiers.has(key);
          return (
            <section key={key} aria-labelledby={headingId}>
              {/* h3 wraps the button (standard accessible-disclosure
                  pattern) rather than being the clickable element itself,
                  so the section still has a real heading in the
                  accessibility tree regardless of expanded/collapsed
                  state. */}
              <h3>
                <button
                  type="button"
                  onClick={() => toggleTier(key)}
                  aria-expanded={!isCollapsed}
                  aria-controls={contentId}
                  className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-inset"
                  style={{
                    backgroundColor: TIER_HEADER_BG,
                    color: TIER_HEADER_TEXT,
                    // Without this, three collapsed headers in a row are
                    // one unbroken navy rectangle with no visible seam
                    // between City/County/State — this border is what
                    // still reads as three sections rather than one.
                    borderTop: `1px solid ${TIER_HEADER_BORDER}`,
                    borderBottom: `1px solid ${TIER_HEADER_BORDER}`,
                  }}
                >
                  <span id={headingId}>{label}</span>
                  <IconChevronDown className={isCollapsed ? "-rotate-90" : ""} />
                </button>
              </h3>
              {/* Pure-CSS accordion (grid-template-rows 0fr/1fr + a
                  height-0-capable overflow-hidden child) instead of a
                  JS-measured max-height — animates open/closed without
                  ever needing to read the content's actual height. */}
              <div
                id={contentId}
                className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
                style={{ gridTemplateRows: isCollapsed ? "0fr" : "1fr" }}
              >
                <div className="overflow-hidden">
                  {reps.length > 0 ? (
                    <div className="divide-y divide-hair">
                      {reps.map((rep) => (
                        <OfficialCard key={officialIdentity(rep)} rep={rep} />
                      ))}
                    </div>
                  ) : (
                    <p className="px-4 py-3 text-sm text-ink-3">{emptyNote}</p>
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
