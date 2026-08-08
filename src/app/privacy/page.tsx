import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";

// Static route (AGENTS.md §2.1: "a route that can be a static file should
// be a static file"). This page exists because §2.5 makes "the user's
// address is not ours" the site's one privacy claim a visitor can verify
// themselves — and until now that claim only lived in AGENTS.md, not on
// the site. error.tsx has referenced "see /privacy" in a code comment
// since it was written; this is that page, finally.
//
// Every claim below is a statement about what this codebase does today,
// not aspirational copy — cross-check against AGENTS.md §0.12, §2.3, §2.5,
// and §2.4 ("No Downstream Callbacks") before changing either without the
// other.

export const metadata: Metadata = {
  title: "Privacy — We All Do Better",
  description: "What this site sends, what it doesn't, and what your address search never leaves your device for.",
};

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <h1 className="text-xl font-semibold text-ink">Privacy</h1>
        <p className="mt-2 text-sm text-ink-3">
          The short version: typing your address here to find your representatives doesn&apos;t tell us where you
          live. Here&apos;s exactly what that means, and what we can&apos;t control.
        </p>

        <h2 className="mt-8 text-base font-semibold text-ink">Your address never leaves your device</h2>
        <p className="mt-2 text-sm text-ink-3">
          Address, ZIP, and intersection search runs entirely in your browser against a compact index shipped with
          the site — no lookup, autocomplete keystroke, or geolocation request is ever sent to us or to any third
          party, not even in anonymized form. Nothing you type into the search box is written to a log, an error
          report, a URL, your browser history, or any storage that persists after you close the tab. A shareable
          result link contains a ward or district ID (like{" "}
          <code className="rounded bg-panel-3 px-1 py-0.5 text-ink-2">/ward/minneapolis-3</code>), never the address
          that got you there. You can verify all of this yourself by opening your browser&apos;s network tab while
          you search.
        </p>

        <h2 className="mt-8 text-base font-semibold text-ink">No accounts, no tracking, no ads</h2>
        <p className="mt-2 text-sm text-ink-3">
          There&apos;s no login, no user profile, no saved-search history tied to an identity, no analytics script,
          no ad or marketing pixel, no session recording, and no third-party font or embedded social widget. A visit
          to this site leaves no trace we can tie back to you.
        </p>

        <h2 className="mt-8 text-base font-semibold text-ink">What we do send requests to</h2>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-ink-3">
          <li>
            <span className="font-medium text-ink-2">OpenFreeMap</span> — serves the map&apos;s basemap tiles
            (roads, place names, water) as you pan and zoom. It doesn&apos;t receive your address or search terms,
            only the map tiles your view needs.
          </li>
          <li>
            <span className="font-medium text-ink-2">Cloudflare</span> — hosts this site and serves every request.
            Like any host, it logs standard request metadata (IP address, timestamp, requested path) at the edge for
            operational and abuse-prevention purposes; that&apos;s Cloudflare&apos;s own infrastructure logging, not
            something this codebase adds or configures beyond the default. We don&apos;t control its retention
            period and won&apos;t claim a privacy property this deployment doesn&apos;t actually deliver.
          </li>
          <li>
            Government and civic data sources (city and county open-data portals, Legistar, Open States, the
            Minnesota Campaign Finance Board, and similar) are called only at <em>build time</em>, to assemble the
            static data this site ships — never triggered by anything you do in your browser.
          </li>
        </ul>

        <h2 className="mt-8 text-base font-semibold text-ink">What this site is careful not to publish</h2>
        <p className="mt-2 text-sm text-ink-3">
          This project&apos;s subject is public power, not private people: it publishes elected and appointed
          officials in their official capacity, never private residents, individual small donors, non-supervisory
          public employees, or anything at household resolution. See the site&apos;s{" "}
          <a
            href="https://github.com/ngabantudev/wealldobettermn/blob/main/AGENTS.md"
            className="text-accent underline underline-offset-2"
          >
            public governance document
          </a>{" "}
          for the full policy.
        </p>

        <h2 className="mt-8 text-base font-semibold text-ink">Questions or a gap you found</h2>
        <p className="mt-2 text-sm text-ink-3">
          Report it on the{" "}
          <a
            href="https://github.com/ngabantudev/wealldobettermn/issues"
            className="text-accent underline underline-offset-2"
          >
            issue tracker
          </a>
          .
        </p>
      </main>
    </>
  );
}
