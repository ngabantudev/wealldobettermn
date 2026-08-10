"use client";

// The AGENTS.md §2.6 community-contribution entry point — shown in
// WardModal's City tier in place of the generic "no officials data" note,
// but only for a real, named city (hoveredCityName is set — see
// WardModalProps' own comment on exactly when that's true and when it
// isn't) with zero officials resolved. County and State keep the plain
// coverage.ts empty-note text unconditionally; this component is never
// rendered for those two tiers.
//
// `/contribute`'s actual submission pipeline (§2.6 — the SSRF-safe
// fetch, the extraction gate, D1) is live — POST /api/submissions and
// the real form at src/components/ContributeForm.tsx both exist and
// have been verified end to end. The vote/graduation routes are still a
// later phase, so a submission stays "pending" indefinitely from this
// component's point of view — but a visitor returning to a city that's
// already pending should see that, not a second "add officials" button
// inviting a redundant submission (AGENTS.md §2.6's dedup guarantee is
// server-side — idx_one_pending_per_city — but a visitor who can't SEE
// that state has no reason not to try anyway). On mount, this component
// checks GET /api/community-submissions for a match against its own
// cityName and swaps the CTA for a pending summary if one exists — a
// self-contained client fetch (own loading/error state) rather than
// threading submission state down through WardMap/WardModal, since this
// is the only place in the tree that needs it.
//
// This is the map-click *and* keyboard/search entry point into that
// flow, not the flow itself. Reachable by:
//  - clicking/tapping the statewide city-boundaries backdrop layer for a
//    city with no ward/mayor/at-large data (WardMap.tsx's click handler,
//    CITY_BOUNDARIES_FILL_LAYER_ID branch), or
//  - typing that city's name into the search box and pressing Enter
//    (WardMap.tsx's applyUncoveredCityZoom, wired through
//    addressSearch.ts's "uncovered-city" SearchOutcome) — the keyboard
//    path AGENTS.md Part 4 "Keyboard Complete" requires, added alongside
//    this component rather than left click/tap-only.
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { fold } from "@/lib/addressSearch";
import { CITIES } from "@/lib/cities";
import { COMMUNITY_CONFIRMATIONS_REQUIRED } from "@/lib/communityConfig";
import CommunityOfficialsList, { type CommunityOfficial } from "./CommunityOfficialsList";

interface PendingSubmission {
  cityName: string;
  officials: CommunityOfficial[];
  confirmations: number;
  confirmationsNeeded: number;
}

interface CommunitySubmissionsResponse {
  submissions?: PendingSubmission[];
}

interface AddOfficialsCTAProps {
  // The clicked/searched city's own name, straight from
  // WardModalProps.hoveredCityName — never geocoded, never a point
  // (AGENTS.md §2.5), just the plain string every render of this
  // component already has on hand.
  cityName: string;
}

export default function AddOfficialsCTA({ cityName }: AddOfficialsCTAProps) {
  // Three states, not two: "still checking" is deliberately distinct
  // from "checked, nothing pending" — collapsing them would either flash
  // the CTA and then yank it away the moment a pending match resolves
  // (jarring, and a false invitation to submit again), or delay a
  // genuinely-uncovered city's CTA for no reason. undefined = loading,
  // null = checked, nothing pending, object = a real match. No manual
  // reset-to-undefined on cityName change here — WardModal.tsx mounts
  // this component with key={cityName}, so a city switch remounts it
  // fresh (this initializer runs again) rather than needing a synchronous
  // setState inside the effect body (react-hooks/set-state-in-effect).
  const [pending, setPending] = useState<PendingSubmission | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/community-submissions")
      .then((res) => (res.ok ? (res.json() as Promise<CommunitySubmissionsResponse>) : null))
      .then((data) => {
        if (cancelled) return;
        const match = data?.submissions?.find((s) => fold(s.cityName) === fold(cityName));
        setPending(match ?? null);
      })
      .catch(() => {
        // Fail OPEN to the CTA, never block on a network hiccup — worst
        // case a visitor sees "add officials" for a city that's
        // technically already pending, which the server-side
        // idx_one_pending_per_city constraint (and POST /api/submissions'
        // own duplicate_pending check) still catches honestly if they
        // click through.
        if (!cancelled) setPending(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cityName]);

  if (pending === undefined) {
    // Brief — this is one edge-cached GET — but still an announced,
    // non-empty state rather than a silent gap (AGENTS.md Part 4).
    return (
      <p role="status" className="text-sm text-ink-3">
        Checking for a pending submission for {cityName}…
      </p>
    );
  }

  if (pending) {
    return (
      <div>
        <p role="status" className="mb-2 text-sm text-ink-3">
          {cityName} has a pending submission — found {pending.officials.length} official
          {pending.officials.length === 1 ? "" : "s"}, awaiting confirmation ({pending.confirmations}/
          {pending.confirmationsNeeded || COMMUNITY_CONFIRMATIONS_REQUIRED}).
        </p>
        <CommunityOfficialsList officials={pending.officials} />
      </div>
    );
  }

  return (
    <div>
      <p className="mb-2 text-sm text-ink-3">
        This app doesn&rsquo;t have officials data for {cityName} yet. If you know who represents
        it, you can help add them.
      </p>
      {/* A real, focusable <a> (via next/link — this is real navigation,
          not a click handler), never a styled <div>: it has to reach
          every keyboard user and screen reader the same way any other
          link on the page does, with no extra wiring. Per AGENTS.md Part
          4 "Colour Is Never The Only Signal," the label text — "Add
          {city}'s officials" — is what tells a resident what this does;
          the solid --positive fill and the shimmer sweep (globals.css's
          .shimmer-cta, gated behind prefers-reduced-motion:
          no-preference — see that rule's own comment) are reinforcement
          on top of that, never the only signal. A reduced-motion visitor
          gets the identical green button with no sweep at all, not a
          slower or paused one. */}
      <Link
        href={`/contribute?city=${encodeURIComponent(cityName)}`}
        className="shimmer-cta inline-flex items-center gap-2 rounded-lg bg-positive px-4 py-2.5 text-sm font-semibold text-on-positive hover:bg-positive-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <UserPlus aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        {`Add ${cityName}'s officials`}
      </Link>
      {/* Coverage honesty (AGENTS.md §3.3) used to live in a separate
          bubble under the search box for this exact query, before the
          uncovered-city path started opening this panel instead — that
          bubble no longer renders (SearchBar.tsx clears `outcome` on this
          branch), so the "here's what we DO cover" half of the message
          moved here rather than being silently dropped. CITIES.length,
          never hand-typed, per §2.1 "counts rendered in copy are derived." */}
      <p className="mt-2 text-xs text-ink-3">
        This map currently covers {CITIES.length} Minnesota cities — see the full list in the sidebar filters.
      </p>
    </div>
  );
}
