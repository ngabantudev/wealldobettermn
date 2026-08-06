import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { BILLS_COVERAGE_NOTE, BILLS_DATA_PATH, BILLS_INGEST_STATUS } from "@/lib/billsRegistry";
import type { Bill } from "@/lib/types";

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
// Not yet linked from site chrome (SiteHeader carries only search, by
// design — see that component) — reachable at /bills directly. Wiring a
// nav entry is a separate follow-up, not part of turning the ingest live.

export const metadata: Metadata = {
  title: "State bills & votes — We All Do Better",
  description: "Minnesota state bills, sponsors, and floor roll-call votes.",
};

const DATA_PATH = path.join(process.cwd(), "public", BILLS_DATA_PATH);

function loadBills(): Bill[] {
  // Read at build time, not request time — a missing file (a fresh
  // checkout before anyone has run the ingest with a real key) is the
  // normal "not live yet" path, not a build failure, so this catches
  // ENOENT/parse errors and falls back to the honest empty state below
  // rather than crashing `next build`. AGENTS.md §3.1: an empty array is
  // never presented as more coverage than it is — isLive below also
  // checks BILLS_INGEST_STATUS, so a stale "live" flag with no file still
  // renders the empty state, never a silent zero-item "live" list.
  try {
    const raw = readFileSync(DATA_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { bills?: Bill[] };
    return Array.isArray(parsed.bills) ? parsed.bills : [];
  } catch {
    return [];
  }
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
