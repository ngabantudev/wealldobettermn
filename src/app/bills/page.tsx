import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import { BILLS_COVERAGE_NOTE, BILLS_INGEST_STATUS } from "@/lib/billsRegistry";
import type { Bill } from "@/lib/types";
// A bundler-resolved JSON import, not readFileSync(process.cwd() + ...):
// see next.config.ts / src/lib/stateLegislatureData.ts for the 2026-08-06
// incident where the equivalent pattern for state-legislature.geojson —
// a module-scope disk read that only works during `next build` — got
// bundled into the deployed Cloudflare Worker and threw on every request
// (public/ isn't a real filesystem there; assets are served via the
// ASSETS binding). This route's own readFileSync was function-scoped
// inside a try/catch rather than module-scope, so it degraded instead of
// crashing, but it depended on the same unavailable-at-runtime disk
// access and would have silently served the "no data" empty state in
// place of real, live data had this module ever actually executed there.
// A JSON import is resolved and inlined by the bundler at build time —
// there is no disk read left for the Worker to fail (or silently
// misbehave) on, in either case. Path mirrors BILLS_DATA_PATH in
// billsRegistry.ts; a bundler import specifier must be a literal string,
// so it can't be built from that constant — keep the two in sync by hand
// if the output path ever moves.
import billsFileData from "../../../public/state-bills.json";

// FEATURES.md "Phase 2 — State bills & roll-call votes." Static route
// (AGENTS.md §2.1 "a route that can be a static file should be a static
// file" — this page takes no user input and needs no server boundary).
//
// STATUS (updated 2026-08-06): scripts/ingest/state-bills.mjs has now been
// run against a live OPEN_STATES_API_KEY and public/state-bills.json
// exists with real, sourced records — BILLS_INGEST_STATUS flipped to
// "live" in billsRegistry.ts accordingly. loadBills() below reads that
// file at build time (AGENTS.md §2.1 "Build-Time Reads"), same convention
// as src/lib/stateLegislatureData.ts. Coverage is a recently-updated-bills
// delta poll, not a full-session backfill — see BILLS_COVERAGE_NOTE.
//
// Now linked from site chrome — SiteHeader renders a small persistent nav
// (Map/Bills/About/Privacy) on every page, this one included, so a visitor
// who lands here has both a way back to the map and a way to the other two
// static pages without relying on the browser's own Back button. See that
// component's NAV_LINKS.

export const metadata: Metadata = {
  title: "State bills & votes — We All Do Better",
  description: "Minnesota state bills, sponsors, and floor roll-call votes.",
};

function loadBills(): Bill[] {
  // public/state-bills.json is committed to the repo (not gitignored —
  // scripts/ingest/state-bills.mjs merges into it, never overwrites), so
  // "the import target doesn't exist" isn't the normal state of a fresh
  // checkout the way it was when this layer was scaffold-only; it's a
  // genuine build error now, and the import above will fail the build
  // loudly if it ever happens, same as a malformed-JSON parse error
  // would. AGENTS.md §3.1: an empty array is never presented as more
  // coverage than it is — isLive below also checks BILLS_INGEST_STATUS,
  // so a stale "live" flag with a genuinely empty bills array still
  // renders the honest empty state, never a zero-item "live" list.
  const parsed = billsFileData as { bills?: Bill[] };
  return Array.isArray(parsed.bills) ? parsed.bills : [];
}

export default function BillsPage() {
  const bills = loadBills();
  const isLive = BILLS_INGEST_STATUS === "live" && bills.length > 0;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-xl font-semibold text-ink">State bills &amp; roll-call votes</h1>
        <p className="mt-2 text-sm text-ink-3">
          Every recorded floor vote a Minnesota state legislator has taken, with a link to the bill and its full
          roll call.
        </p>

        {isLive ? (
          <ul className="mt-6 space-y-3">
            {bills.map((bill) => (
              <li key={bill.id} className="well rounded-xl border p-4">
                <p className="font-medium text-ink-2">
                  {bill.identifier} — {bill.title}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <div
            role="status"
            className="well mt-6 space-y-2 rounded-xl border border-hair-strong p-4 text-sm text-ink-3"
          >
            <p className="font-medium text-ink-2">No bill data ingested yet.</p>
            <p>{BILLS_COVERAGE_NOTE}</p>
            <p>
              See{" "}
              <a href="https://www.revisor.mn.gov/bills/" className="text-accent underline underline-offset-2">
                the Minnesota Revisor&apos;s own bill search
              </a>{" "}
              in the meantime.
            </p>
          </div>
        )}
      </main>
    </>
  );
}
