"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { RepProperties } from "@/lib/types";
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
  // Which single tier (City/County/State) is on screen right now — starts
  // on City, matching the app's own "who represents me?" question order
  // (AGENTS.md Part 0) and the panel's original top-to-bottom layout.
  // Lives here, not per-tier useState, since WardModal stays mounted
  // across hover/click selection changes (only `officials` itself
  // changes), so the resident's chosen tab persists as they move the
  // cursor around the map instead of resetting to City on every new
  // selection.
  const [activeTier, setActiveTier] = useState<keyof AreaOfficials>("city");
  const activeIndex = TIER_SECTIONS.findIndex((tier) => tier.key === activeTier);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // ARIA Authoring Practices "tabs with automatic activation" pattern:
  // arrow keys both move focus AND select, so there's exactly one
  // tabbable element in the tablist at a time (roving tabindex) instead
  // of tabbing through all three headers like the old disclosure buttons
  // did. Home/End jump to the first/last tab for keyboard completeness
  // per AGENTS.md §4.
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (activeIndex + 1) % TIER_SECTIONS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (activeIndex - 1 + TIER_SECTIONS.length) % TIER_SECTIONS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = TIER_SECTIONS.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextKey = TIER_SECTIONS[nextIndex].key;
    setActiveTier(nextKey);
    tabRefs.current[nextIndex]?.focus();
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
        <h2 className="text-2xl font-extrabold">{panelHeading(officials)}</h2>
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

      {/* True ARIA tabs (role="tablist"/"tab"/"tabpanel") rather than the
          previous three independent disclosure buttons — lets a resident
          jump straight to County or State instead of scrolling past City's
          full card stack first. Automatic-activation pattern per the ARIA
          Authoring Practices: arrow keys move focus and select in one
          step, with roving tabindex (only the active tab is in normal tab
          order) so Tab itself moves straight from the tablist to the
          panel content instead of through all three headers.

          Flat segmented control (rounded-lg track on bg-panel-3, rounded-md
          active cell) instead of the old flush, square, full-bleed strip
          with a border-hair-strong divider underneath — mndatacenter.org's
          own "moderate border-radius on interactive elements" look, and
          matches the same treatment WardMap.tsx's left sidebar tablist
          (sidebarTabRowClass) now uses, so both sidebars read as one
          language. No border: bg-panel-3 (the recessed-surface token) and
          the active cell's own TIER_HEADER_BG fill carry the grouping and
          selection state between them, so a drawn line added no
          information. Inset in its own padded wrapper rather than
          full-bleed, since a rounded track needs room on all sides for its
          own corners. */}
      <div className="px-4 pt-4 pb-1 shrink-0">
        <div role="tablist" aria-label="Representative level" className="flex gap-1 rounded-lg bg-panel-3 p-1">
          {TIER_SECTIONS.map(({ key, label }, index) => {
            const isActive = key === activeTier;
            const tabId = `officials-tier-${key}-tab`;
            const panelId = `officials-tier-${key}-panel`;
            return (
              <button
                key={key}
                ref={(el) => {
                  tabRefs.current[index] = el;
                }}
                type="button"
                role="tab"
                id={tabId}
                aria-selected={isActive}
                aria-controls={panelId}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActiveTier(key)}
                onKeyDown={handleTabKeyDown}
                // min-h-11 (44px): Apple/Google's touch-target guidance for
                // an interactive control on a mobile sheet — this row is
                // rendered identically for the mobile bottom sheet
                // (variant="sheet") and the desktop sidebar, so it needs to
                // hold up as a thumb target, not just a mouse target. Well
                // above WCAG 2.5.8's own 24x24px AA minimum.
                className={`flex-1 min-h-11 rounded-md px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide transition-colors focus:outline-none focus-visible:ring-2 ${
                  // Same `--hover` token the left sidebar's city rows use
                  // (WardMap.tsx's filterListClass rows), applied only to
                  // the inactive tabs — the active tab already has its own
                  // solid fill and shouldn't visually flicker on hover. Not
                  // set via the style prop below: an inline background-color
                  // has higher specificity than any Tailwind class,
                  // including this one's :hover variant, so it would
                  // silently block the hover fill from ever painting.
                  isActive ? "" : "hover:bg-hover"
                }`}
                style={isActive ? { backgroundColor: TIER_HEADER_BG, color: TIER_HEADER_TEXT } : undefined}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-y-auto">
        {TIER_SECTIONS.map(({ key, emptyNote }) => {
          const reps = officials[key];
          const tabId = `officials-tier-${key}-tab`;
          const panelId = `officials-tier-${key}-panel`;
          const isActive = key === activeTier;
          return (
            // `hidden` (not the old CSS accordion) removes inactive
            // panels from the accessibility tree entirely, matching the
            // ARIA Authoring Practices tabs pattern — a screen-reader user
            // tabbing from the tablist lands directly on the active
            // panel's content, not on two other panels' worth of cards
            // first. `aria-labelledby` ties this panel's accessible name
            // back to its tab, so the DOM record stays in sync with what's
            // drawn per AGENTS.md §4 without a redundant repeated label.
            <section key={key} role="tabpanel" id={panelId} aria-labelledby={tabId} hidden={!isActive} tabIndex={0}>
              {reps.length > 0 ? (
                <div className="divide-y divide-hair">
                  {reps.map((rep) => (
                    <OfficialCard key={officialIdentity(rep)} rep={rep} />
                  ))}
                </div>
              ) : (
                <p className="px-4 py-3 text-sm text-ink-3">{emptyNote}</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
