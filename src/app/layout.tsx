import type { Metadata, Viewport } from "next";
import SiteHeader from "@/components/SiteHeader";
import { SearchCoordinatorProvider } from "@/lib/searchCoordinator";
import "./globals.css";

export const metadata: Metadata = {
  title: "We All Do Better",
  description: "Minnesota public issue layers: wards, reps, and how to reach them.",
};

// Night Sky Blue — the band's color (see globals.css) — not --canvas: what
// sits under a phone's browser chrome is this site's header band, not the
// map. Updated at runtime by src/lib/siteTheme.ts's setTheme() on toggle;
// this is only the value a fresh, no-JS-yet visitor gets.
export const viewport: Viewport = {
  themeColor: "#002d5d",
};

// Runs before first paint to avoid a flash of the wrong theme. Has to be
// inline and dependency-free — importing siteTheme.ts here would defer it
// past paint, which is the exact problem it exists to solve — so the
// storage key and default are duplicated from that module. Keep the two in
// sync if either changes.
const NO_FLASH_THEME_SCRIPT = `(function () {
  try {
    var stored = localStorage.getItem("siteTheme");
    if (stored !== "light" && stored !== "dark") stored = "light";
    if (stored === "dark") {
      document.documentElement.classList.add("dark");
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", "#131314");
    }
  } catch (e) {}
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      {/* text-ink-canvas, not text-ink: the body sits on --canvas (the map
          backdrop), a different surface from the panels --ink is measured
          against — see globals.css's token notes.

          No `dark` class in the served markup — the inline script below
          adds it before first paint when that's the stored preference.
          Keeping it off the static HTML means the light civic theme is
          what a no-JS or slow-JS visitor sees, the safer default for a
          public-records site. */}
      <body className="flex h-full flex-col bg-canvas text-ink-canvas">
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
        {/* Rendered once, here, rather than per-page (the pre-2026-08-09
            layout): every route under app/ used to import and render its
            own <SiteHeader />, which meant App Router unmounted and
            remounted it on every client-side navigation between them —
            visible as the topbar flickering/resetting on each link click,
            plus the search box popping in/out since only the map route
            passed a `search` prop. Hoisting it to the root layout makes it
            genuinely persistent chrome, the way AGENTS.md Part 4 assumes:
            it survives navigation instead of being recreated by it.
            SiteHeader now renders the search box itself (SiteSearch.tsx)
            rather than leaving an empty slot for WardMap to portal into —
            2026-08-09's first pass fixed the header shell but left the
            box itself WardMap-owned, so it still vanished on every route
            but "/" (see AGENTS.md's LESSONS.md-style trail in
            searchCoordinator.tsx for the follow-up). The provider below
            is the seam that lets WardMap (mounted only on "/") still be
            the thing that actually applies a selection to the map. */}
        <SearchCoordinatorProvider>
          <SiteHeader />
          <div className="min-h-0 flex-1">{children}</div>
        </SearchCoordinatorProvider>
      </body>
    </html>
  );
}
