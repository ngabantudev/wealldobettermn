import Link from "next/link";

// Shared shell for the site's 6 static content pages (Meetings, Bills,
// Recap, Sources, About, Privacy) — a route group (the `(content)`
// directory doesn't appear in the URL; `/meetings` still resolves exactly
// as before). Two jobs, both mobile-only, both a consequence of
// MobileBottomNav.tsx becoming global chrome:
//
//   1. Reserve `--mobile-nav-height` of bottom padding so the bar doesn't
//      cover this page's own last line of content. The map route (`/`)
//      doesn't need this — it opts out of page-level scroll entirely
//      (`h-full overflow-hidden`, see WardMap.tsx) and reserves the same
//      space differently (#map-corner-controls' own `bottom` calc) — which
//      is exactly why this lives in a route-group layout scoped to the 6
//      pages that actually scroll, not in the root layout.
//   2. Give About and Privacy a mobile-reachable home. Those two don't fit
//      a 5-item bottom nav (Map/Meetings/Bills/Recap/Sources took the 5
//      slots — see MobileBottomNav.tsx), and SiteHeader's own text-link row
//      is desktop-only now (see that file's own comment) — without this
//      footer, they'd be mobile dead ends again, the exact "orphan pages
//      nobody can reach" bug SiteHeader's nav was originally built to fix.
//
// A server component — no client JS needed for either job, just a CSS
// custom property read at paint time and two static links.
//
// Deliberately NOT a global, pathname-gated wrapper in the root layout: a
// footer inserted as a body-level flex sibling of `{children}` lands at
// that sibling's own *flex-assigned* box (viewport height minus header),
// not at the true bottom of each page's own — possibly longer — scrollable
// content, since flex siblings don't reflow around a sibling's overflow
// paint. Scoping this to the route group that actually needs it sidesteps
// that bug entirely: it renders inside each page's own normal document
// flow, at the true end of that page's content.
export default function ContentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pb-[var(--mobile-nav-height)]">
      {children}
      <footer className="sm:hidden mx-auto max-w-2xl border-t border-hair px-4 py-6 text-center text-xs text-ink-3">
        <nav aria-label="More" className="flex items-center justify-center gap-4">
          <Link href="/about" className="font-semibold uppercase tracking-wide text-ink-2 hover:text-ink hover:underline">
            About
          </Link>
          <Link href="/privacy" className="font-semibold uppercase tracking-wide text-ink-2 hover:text-ink hover:underline">
            Privacy
          </Link>
        </nav>
      </footer>
    </div>
  );
}
