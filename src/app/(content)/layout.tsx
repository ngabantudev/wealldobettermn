// Shared shell for the site's 6 static content pages (Meetings, Bills,
// Recap, Sources, About, Privacy) — a route group (the `(content)`
// directory doesn't appear in the URL; `/meetings` still resolves exactly
// as before). One job, mobile-only, a consequence of MobileBottomNav.tsx
// becoming global chrome: reserve `--mobile-nav-height` of bottom padding
// so the bar doesn't cover this page's own last line of content. The map
// route (`/`) doesn't need this — it opts out of page-level scroll
// entirely (`h-full overflow-hidden`, see WardMap.tsx) and reserves the
// same space differently (#map-corner-controls' own `bottom` calc) — which
// is exactly why this lives in a route-group layout scoped to the 6 pages
// that actually scroll, not in the root layout.
//
// Used to also render a footer with About/Privacy links — removed. Those
// two links are now reachable from SiteHeader's own "More" trigger
// (global, every route, including "/") instead: a footer scoped to this
// route group left the map route with no way to reach either page on
// mobile at all, a real bug caught in review — see SiteHeader.tsx's own
// comment on its More trigger for the fuller story. One reachable-from-
// everywhere trigger beats two links that could drift out of sync with
// each other.
export default function ContentLayout({ children }: { children: React.ReactNode }) {
  return <div className="pb-(--mobile-nav-height)">{children}</div>;
}
