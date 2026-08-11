import type { Metadata } from "next";
import { Suspense } from "react";
import ContributeForm from "@/components/ContributeForm";

// Static shell (AGENTS.md §2.1) — the personalization (which city, if any,
// the visitor arrived wanting to add) happens client-side, via
// useSearchParams inside ContributeForm, the same "read a query param in
// the browser, never on the server" shape the rest of this app's
// architecture already uses for anything derived from what a visitor
// typed. That's why this file itself stays a plain server component: the
// page is built once and served static/edge-cached, not re-rendered per
// request just because a `?city=` param is present.
//
// src/components/AddOfficialsCTA.tsx (the shimmering "Add {city}'s
// officials" button in WardModal's uncovered-city state, and
// SearchBar/WardMap's matching keyboard path) links here. POST
// /api/submissions — the route ContributeForm actually calls — is live
// and has been verified end to end against a real submission; this used
// to be an honest "not live yet" placeholder (AGENTS.md §0.6:
// "transparency that terminates in a phone number nobody answers is a
// failure state" — a live button pointing at a 404 would have been
// worse than the generic coverage note it replaced) until the pipeline
// behind it actually shipped.
export const metadata: Metadata = {
  title: "Add your city's officials — We All Do Better",
  description: "Help add officials data for a Minnesota city this map doesn't cover yet.",
};

// Suspense fallback: the same heading ContributeForm renders, shown for
// the brief moment before hydration lets the client component read
// `?city=` for itself and render the actual form. Deliberately not
// "loading…" text — a visitor with slow/no JS should still see something
// legible, not a spinner that never resolves for them (AGENTS.md §0.7
// "usable... on bad connections").
function ContributeFallback() {
  return <h1 className="text-xl font-semibold text-ink">Add your city&apos;s officials</h1>;
}

export default function ContributePage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Suspense fallback={<ContributeFallback />}>
        <ContributeForm />
      </Suspense>
    </main>
  );
}
