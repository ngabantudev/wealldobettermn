// Basemap style registry — the "Map Theme" half of MapThemeSelector.tsx.
// Kept parallel to the mndatacenter.org reference (src/data/mapStyles.ts):
// same four OpenFreeMap styles, same ids, same light/dark pairing logic, so
// a resident who's used one of these sister sites finds the same options in
// the same place on the other.

import { DEFAULT_SITE_THEME, getStoredTheme, type SiteTheme } from "./siteTheme";
import { readStored, removeStored, writeStored } from "./storage";

export interface MapStyleOption {
  id: string;
  label: string;
  url: string;
  /**
   * Whether this basemap's own background reads as dark. Not the same
   * question as the site's chrome theme — a resident can pick any basemap
   * independently of the Light/Dark chrome toggle — so ward outline and
   * label colors (see WardMap.tsx) key off this, not off siteTheme.ts.
   */
  dark: boolean;
}

export const MAP_STYLE_OPTIONS: MapStyleOption[] = [
  // Its background is #45516E — muted, but dark enough that an outline
  // tuned for the light basemaps disappears against it too.
  { id: "fiord", label: "Fiord (Muted)", url: "https://tiles.openfreemap.org/styles/fiord", dark: true },
  { id: "liberty", label: "Liberty (Google Maps)", url: "https://tiles.openfreemap.org/styles/liberty", dark: false },
  { id: "positron", label: "Light Minimal", url: "https://tiles.openfreemap.org/styles/positron", dark: false },
  { id: "dark", label: "Dark Mode", url: "https://tiles.openfreemap.org/styles/dark", dark: true },
];

/** Whether a basemap id's own background is dark. Unknown ids read as light. */
export function isMapStyleDark(id: string): boolean {
  return MAP_STYLE_OPTIONS.find((option) => option.id === id)?.dark ?? false;
}

/**
 * Basemap paired with each site theme. Switching the site theme always
 * switches the basemap to its partner here — the two are treated as one
 * decision, so the chrome and the map can't end up mismatched. A resident
 * can still pick any basemap afterwards; that choice sticks until the next
 * time they change theme (see clearStoredMapStyleId's callers).
 */
export const THEME_BASEMAP: Record<SiteTheme, string> = {
  light: "positron",
  dark: "dark",
};

/**
 * Set only when a resident picks a basemap by hand. Its absence is
 * meaningful: it's what lets the theme pairing above apply, and once it's
 * set the pairing stops overriding the choice — see clearStoredMapStyleId.
 */
export const MAP_STYLE_STORAGE_KEY = "mapBasemapChoice";

function isKnownStyleId(value: string): boolean {
  return MAP_STYLE_OPTIONS.some((o) => o.id === value);
}

/** A resident's explicit basemap choice, or null if they haven't made one. */
function getStoredMapStyleId(): string | null {
  const stored = readStored(MAP_STYLE_STORAGE_KEY);
  return stored !== null && isKnownStyleId(stored) ? stored : null;
}

export function storeMapStyleId(id: string): void {
  writeStored(MAP_STYLE_STORAGE_KEY, id);
}

/**
 * Drops a hand-picked basemap, handing control back to the theme pairing.
 * What a theme switch does instead of persisting the pairing it just
 * applied — the pairing is already recoverable from the stored *theme*, so
 * writing it here too would only make a later change to THEME_BASEMAP
 * unreachable for anyone who'd ever switched theme.
 */
export function clearStoredMapStyleId(): void {
  removeStored(MAP_STYLE_STORAGE_KEY);
}

/** Basemap for an id we don't recognize: the one the default theme pairs with. */
const DEFAULT_MAP_STYLE_ID = THEME_BASEMAP[DEFAULT_SITE_THEME];

export function getMapStyleUrlById(id: string): string {
  const byId = (wanted: string) => MAP_STYLE_OPTIONS.find((option) => option.id === wanted)?.url;
  return byId(id) ?? byId(DEFAULT_MAP_STYLE_ID) ?? MAP_STYLE_OPTIONS[0].url;
}

/** Default basemap id for a theme, for callers that haven't got a stored choice. */
export function getMapStyleIdForTheme(theme: SiteTheme): string {
  return THEME_BASEMAP[theme];
}

/**
 * Basemap to open with: an explicit past choice wins, otherwise the one
 * paired with the stored site theme. Client-side only — it reads
 * localStorage, so don't call it from a render body, only from an effect.
 */
export function getInitialMapStyleId(): string {
  return getStoredMapStyleId() ?? getMapStyleIdForTheme(getStoredTheme());
}
