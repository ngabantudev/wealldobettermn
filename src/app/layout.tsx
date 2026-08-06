import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MN Civic Map",
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
      <body className="h-full bg-canvas text-ink-canvas">
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
