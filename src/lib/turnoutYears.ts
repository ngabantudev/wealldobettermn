// src/lib/turnoutYears.ts
//
// Pure helpers for the civic-participation-turnout year slider
// (TurnoutYearSlider.tsx, WardMap.tsx's switchTurnoutYear). Reads entirely
// off public/turnout/manifest.json's own `years[]` array — never a
// hardcoded year or count — so the slider automatically grows from one
// stop to several the moment a future ingest run (the historical-backfill
// PR referenced in this feature's own PR description) adds more entries
// to that array, with zero code changes here.
//
// Kept as its own dependency-free module (no React, no MapLibre) so the
// year <-> index <-> data-path resolution this file does can be unit
// tested directly (turnoutYears.test.mjs) the same way turnoutJoin.ts's
// join logic is, per AGENTS.md's "pure logic gets its own tested module"
// convention already established there.

/** One entry from public/turnout/manifest.json's `years[]` array. */
export interface TurnoutManifestYear {
  year: string;
  electionType: string;
  dataPath: string;
}

/**
 * The slider's native range input reports a *position* (an integer index
 * into `years`), never a year value directly — this is what turns that
 * position back into the manifest entry it refers to, discrete and
 * snapped by construction: an out-of-range index (stale state, a fetch
 * that resolved after `years` changed) clamps to the nearest real stop
 * rather than resolving to `undefined`, so the slider can never land on a
 * position with no backing data file.
 */
export function yearAtIndex(years: readonly TurnoutManifestYear[], index: number): TurnoutManifestYear | null {
  if (years.length === 0) return null;
  const clamped = Math.min(Math.max(Math.round(index), 0), years.length - 1);
  return years[clamped];
}

/**
 * The inverse of yearAtIndex — where the currently-active year sits in
 * `years`, for initializing/syncing the range input's own `value`. Falls
 * back to the last (most recent) index when the active year isn't found
 * in the list at all (e.g. state briefly out of sync during a fetch),
 * rather than 0, so a stale slider defaults toward "most recent" instead
 * of silently jumping to the oldest year on screen.
 */
export function indexOfYear(years: readonly TurnoutManifestYear[], year: string | null): number {
  if (years.length === 0) return 0;
  if (year === null) return years.length - 1;
  const index = years.findIndex((y) => y.year === year);
  return index === -1 ? years.length - 1 : index;
}

/**
 * Resolves a year string to its manifest-declared data path
 * (`public/turnout/city/<year>.json`'s public URL, e.g.
 * "/turnout/city/2024.json") — never constructs the path from the year
 * string itself, since the manifest is the only source of truth for what
 * actually got ingested and where it landed (AGENTS.md §2.2: scripts,
 * and the data they emit, are the source of truth — this never assumes a
 * naming convention holds). Returns null for a year not present in
 * `years`, which callers treat as "not a real stop," never a guess.
 */
export function resolveYearDataPath(years: readonly TurnoutManifestYear[], year: string): string | null {
  return years.find((y) => y.year === year)?.dataPath ?? null;
}
