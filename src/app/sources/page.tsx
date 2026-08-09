import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import {
  CITY_COUNCIL_SOURCES,
  COUNTY_COMMISSIONER_SOURCES,
  KNOWN_ROSTER_GAPS,
  OTHER_SOURCES,
  WARD_GIS_SOURCES,
  type SourceEntry,
} from "@/lib/sourcesRegistry";

// Static route (AGENTS.md §2.1). Implements §2.4's "Machine-Readable
// Provenance Travels With The Data" and §3.3's citation-tiering rules as a
// page a resident can actually browse, rather than provenance that only
// lives in each fetch script's own header comment. Every fact below reads
// from src/lib/sourcesRegistry.ts, not retyped here — see that file's own
// header for how it stays honest (every URL is copy-pasted from a real
// const already in the codebase, never approximated).

export const metadata: Metadata = {
  title: "Sources — We All Do Better",
  description: "Every government and civic data source this site pulls from, linked directly, organized by government level.",
};

function TierBadge({ tier }: { tier: 1 | 3 }) {
  return (
    <span
      className="ml-2 inline-block shrink-0 rounded-full border border-hair px-1.5 py-0.5 text-[10px] font-medium text-ink-3"
      title={tier === 1 ? "Tier 1 — government primary record" : "Tier 3 — first-party non-governmental civic aggregator"}
    >
      Tier {tier}
    </span>
  );
}

function SourceRow({ entry }: { entry: SourceEntry }) {
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <a href={entry.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink-2 underline underline-offset-2 hover:text-accent">
          {entry.name}
        </a>
        <TierBadge tier={entry.tier} />
      </div>
      <p className="mt-0.5 text-xs text-ink-3">
        {entry.agency}
        {entry.note ? <span className="italic"> — {entry.note}</span> : null}
      </p>
    </li>
  );
}

function SourceList({ entries }: { entries: readonly SourceEntry[] }) {
  return <ul className="mt-2 divide-y divide-hair">{entries.map((entry) => <SourceRow key={`${entry.name}-${entry.url}`} entry={entry} />)}</ul>;
}

export default function SourcesPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <h1 className="text-xl font-semibold text-ink">Sources</h1>
        <p className="mt-2 text-sm text-ink-3">
          Every claim on this site resolves to a citable primary record — see AGENTS.md §0.2, &quot;receipts, not
          rhetoric.&quot; This page lists every government or civic data source this site pulls from, linked
          directly, so anyone can check a fact against the same page this site read it from. A specific record&apos;s
          own citation is also always one click away in the map itself — every representative card links back to the
          exact page its name, contact info, or district came from.
        </p>
        <p className="mt-2 text-xs text-ink-3">
          <span className="font-medium text-ink-2">Tier 1</span> = a government&apos;s own primary record (a city
          council page, a county GIS layer, a state board&apos;s bulk data file).{" "}
          <span className="font-medium text-ink-2">Tier 3</span> = a first-party non-governmental aggregator of
          primary civic data (Open States, which republishes legislature data under its own API). This site never
          cites a secondary source — news coverage, a commercial data broker — as the sole basis for a published
          fact. See AGENTS.md §3.3 for the full citation policy.
        </p>

        <h2 className="mt-8 text-base font-semibold text-ink">City councils &amp; mayors</h2>
        <p className="mt-2 text-xs text-ink-3">
          The page each name, party, email, phone, and photo was read from. Several cities publish one shared page
          per member rather than a single roster page — where that&apos;s the case, one member&apos;s page is linked
          as a representative example.
        </p>
        <SourceList entries={CITY_COUNCIL_SOURCES} />

        <h2 className="mt-8 text-base font-semibold text-ink">Ward &amp; district boundaries</h2>
        <p className="mt-2 text-xs text-ink-3">
          The GIS layer each ward or council-district polygon comes from — several cities share one county-run GIS
          server rather than publishing their own.
        </p>
        <SourceList entries={WARD_GIS_SOURCES} />

        <h2 className="mt-8 text-base font-semibold text-ink">County commissioners</h2>
        <SourceList entries={COUNTY_COMMISSIONER_SOURCES} />
        {KNOWN_ROSTER_GAPS.length > 0 && (
          <div className="mt-3 rounded-lg border border-hair bg-panel-2 p-3">
            <p className="text-xs font-medium text-ink-2">Known roster gap</p>
            {KNOWN_ROSTER_GAPS.map((gap) => (
              <p key={gap.name} className="mt-1 text-xs text-ink-3">
                <a href={gap.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-accent">
                  {gap.name}
                </a>{" "}
                — {gap.note}
              </p>
            ))}
          </div>
        )}

        <h2 className="mt-8 text-base font-semibold text-ink">State &amp; statewide layers</h2>
        <SourceList entries={OTHER_SOURCES} />

        <h2 className="mt-8 text-base font-semibold text-ink">Basemap &amp; hosting</h2>
        <p className="mt-2 text-sm text-ink-3">
          The map&apos;s tiles come from OpenFreeMap; the site is hosted on Cloudflare. Neither ever receives a
          search query or address — see the{" "}
          <a href="/privacy" className="text-accent underline underline-offset-2">
            privacy page
          </a>{" "}
          for exactly what each one does and doesn&apos;t see.
        </p>

        <h2 className="mt-8 text-base font-semibold text-ink">Bulk export</h2>
        <p className="mt-2 text-sm text-ink-3">
          This site&apos;s own derived data — jurisdictions, offices, officeholders — is published as versioned
          static JSON under a permissive licence, per AGENTS.md §2.4. It is not a substitute for the primary sources
          above: cite the original record, not this site&apos;s copy of it, wherever precision matters.
        </p>

        <h2 className="mt-8 text-base font-semibold text-ink">Found a stale or wrong citation?</h2>
        <p className="mt-2 text-sm text-ink-3">
          Report it on the{" "}
          <a href="https://github.com/ngabantudev/wealldobettermn/issues" className="text-accent underline underline-offset-2">
            issue tracker
          </a>
          . See also{" "}
          <a href="/about" className="text-accent underline underline-offset-2">
            about
          </a>{" "}
          for how this site is built and reviewed.
        </p>
      </main>
    </>
  );
}
