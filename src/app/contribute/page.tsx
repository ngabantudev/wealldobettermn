import type { Metadata } from "next";
import { Suspense } from "react";
import ContributeComingSoon from "@/components/ContributeComingSoon";

// Static shell (AGENTS.md §2.1) — the personalization (which city, if any,
// the visitor arrived wanting to add) happens client-side, via
// useSearchParams inside ContributeComingSoon, the same "read a query
// param in the browser, never on the server" shape the rest of this app's
// architecture already uses for anything derived from what a visitor
// typed. That's why this file itself stays a plain server component: the
// page is built once and served static/edge-cached, not re-rendered per
// request just because a `?city=` param is present.
//
// Why this page exists at all, and why it doesn't do anything yet:
// src/components/AddOfficialsCTA.tsx (the shimmering "Add {city}'s
// officials" button in WardModal's uncovered-city state, and
// SearchBar/WardMap's matching keyboard path) links here. AGENTS.md §0.6
// — "transparency that terminates in a phone number nobody answers is a
// failure state" — a live button pointing at a 404 is worse than the
// generic coverage note it replaced, so this page has to exist the moment
// that button does, even though the actual submission pipeline (§2.6:
// the SSRF-safe fetch, the extraction gate, D1, the vote/graduation flow)
// is still being built behind it. Per AGENTS.md §3.1's own standing rule
// applied to "a feature," not just "a data field": ship the honest
// "not live yet" state, never a form that pretends to work.
export const metadata: Metadata = {
  title: "Add your city's officials — We All Do Better",
  description: "Help add officials data for a Minnesota city this map doesn't cover yet.",
};

// Suspense fallback: the same static shell ContributeComingSoon renders
// for the no-city case, shown for the brief moment before hydration lets
// the client component read `?city=` for itself. Deliberately not
// "loading…" text — a visitor with slow/no JS should see the same honest
// message either way, not a spinner that never resolves for them (AGENTS.md
// §0.7 "usable... on bad connections").
function ContributeFallback() {
  return (
    <>
      <h1 className="text-xl font-semibold text-ink">Add your city&apos;s officials</h1>
      <p className="mt-2 text-sm text-ink-3">
        This feature isn&apos;t live yet — see below for how to help in the meantime.
      </p>
    </>
  );
}

export default function ContributePage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Suspense fallback={<ContributeFallback />}>
        <ContributeComingSoon />
      </Suspense>
    </main>
  );
}
