// Single source of truth for the site's light/dark chrome theme. The
// colors live in globals.css (:root vs .dark); this module only decides
// which of those two is active, and persists the choice. Kept parallel to
// the mndatacenter.org reference (src/lib/siteTheme.ts) this app's palette
// was matched against — same storage key semantics, same default.
//
// Note the split of responsibilities with mapStyles.ts: this picks the *UI
// chrome* theme, mapStyles.ts picks the *basemap*. They're paired on first
// load (see THEME_BASEMAP there) so a fresh visitor gets a coherent light or
// dark map, but a visitor who picks a specific basemap afterwards keeps it —
// switching the site theme again won't stomp that choice.

import { readStored, writeStored } from "./storage";

export type SiteTheme = "light" | "dark";

export const SITE_THEME_STORAGE_KEY = "siteTheme";
export const DEFAULT_SITE_THEME: SiteTheme = "light";

/**
 * `<meta name="theme-color">` value per theme, so mobile browser chrome
 * matches. The light value is the band color (Night Sky Blue — see
 * globals.css's provenance notes), not --canvas: what sits under the
 * browser chrome on a phone is this site's header band, not the map.
 */
const THEME_COLOR: Record<SiteTheme, string> = {
  light: "#002d5d",
  dark: "#131314",
};

export function isSiteTheme(value: unknown): value is SiteTheme {
  return value === "light" || value === "dark";
}

/** Reads the persisted theme, falling back to the default. Never throws. */
export function getStoredTheme(): SiteTheme {
  return readStored(SITE_THEME_STORAGE_KEY, isSiteTheme, DEFAULT_SITE_THEME);
}

/** The theme currently applied to the document, regardless of what's stored. */
export function getActiveTheme(): SiteTheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * Applies `theme` to <html> and persists it. The class toggle is what
 * actually swaps every token in globals.css, so this one call restyles the
 * whole UI.
 */
export function setTheme(theme: SiteTheme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");

  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", THEME_COLOR[theme]);

  writeStored(SITE_THEME_STORAGE_KEY, theme);
}
