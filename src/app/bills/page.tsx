import type { Metadata } from "next";
import { BILLS_COVERAGE_NOTE, BILLS_INGEST_STATUS } from "@/lib/billsRegistry";
import type { Bill } from "@/lib/types";

// FEATURES.md "Phase 2 — State bills & roll-call votes." Static route
// (AGENTS.md §2.1 "a route that can be a static file should be a static
// file" — this page takes no user input and needs no server boundary).
//
// SCAFFOLD STATUS: scripts/ingest/state-bills.mjs does not yet write
// public/state-bills.json (see that script's header), so there is no data
// file to read here. Per AGENTS.md §3.1, this renders an honest,
// unmissable empty state instead of any placeholder bill content — never
// a fabricated list, never a "coming soon" bill card with fake numbers.
// Once the ingest script writes real, sourced records, this page reads
// them at build time (per BILLS_DATA_PATH in billsRegistry.ts) the same
// way every other layer in this app reads its own public/*.json.
//
// Not yet linked from site chrome (SiteHeader carries only search, by
// design — see that component) — reachable at /bills directly. Wiring a
// nav entry is deferred to whoever adds the first real bill data, so the
// link doesn't promise content that isn't there yet.

export const metadata: Metadata = {
  title: "State bills & votes — We All Do Better",
  description: "Minnesota state bills, sponsors, and floor roll-call votes.",
};

function loadBills(): Bill[] {
  // No public/state-bills.json exists yet (see module header) — this
  // returns an explicit empty array rather than attempting a fetch/import
  // that would throw, so the empty state below is the normal path, not a
  // caught error.
  return [];
}

export default function BillsPage() {
  const bills = loadBills();
  const isLive = BILLS_INGEST_STATUS === "live" && bills.length > 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-xl font-semibold text-ink">State bills &amp; roll-call votes</h1>
      <p className="mt-2 text-sm text-ink-3">
        Every recorded floor vote a Minnesota state legislator has taken, with a link to the bill and its full roll
        call.
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
  );
}
