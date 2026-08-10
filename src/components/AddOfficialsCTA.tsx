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
// later phase; a submission lands and stays flagged pending until those
// land. This component is the map-click *and* keyboard/search entry
// point into that flow, not the flow itself. Reachable by:
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
import { CITIES } from "@/lib/cities";

interface AddOfficialsCTAProps {
  // The clicked/searched city's own name, straight from
  // WardModalProps.hoveredCityName — never geocoded, never a point
  // (AGENTS.md §2.5), just the plain string every render of this
  // component already has on hand.
  cityName: string;
}

export default function AddOfficialsCTA({ cityName }: AddOfficialsCTAProps) {
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
