// src/lib/justSubmittedCache.ts
//
// A narrow, one-time handoff from ContributeForm.tsx to AddOfficialsCTA.tsx
// for the specific "I just submitted this city, then went back to the
// map" path — GET /api/community-submissions is edge-cached
// (Cache-Control: s-maxage=30, see that route's own comment on why: low
// submission volume, safe to cache briefly rather than hitting D1 on
// every panel open), so a visitor returning to their own just-submitted
// city within that window could otherwise see a stale response missing
// it. Rather than weakening that cache for every visitor to fix one
// narrow case, the submitter's own browser already has the freshest
// possible copy of the data — the POST response it just received —
// so this just hands that exact object to the next component that needs
// it, sessionStorage-backed so it survives the client-side navigation
// back to `/`.
//
// sessionStorage, not localStorage: this should never outlive the tab,
// and never resurface for a different city than the one just submitted —
// consumeJustSubmitted() deletes it on read regardless of whether the
// city matched, so a stale/mismatched entry can't linger and confuse a
// later, unrelated visit. Holds only already-public data (the extracted
// officials — the same thing POST /api/submissions already returned to
// this same browser) — not a §0.12/§2.5 "leaves no trace" concern, this
// carries no address and nothing private.
//
// The official-record shape is declared locally (structurally identical
// to CommunityOfficialsList.tsx's CommunityOfficial) rather than imported
// from it — this is a src/lib module, and nothing else under src/lib
// imports from src/components even for a type; keeping that layering
// intact rather than being the first exception.

import { fold } from "./addressSearch.ts";

const STORAGE_KEY = "wadb:just-submitted-pending";

interface JustSubmittedOfficial {
  role: "Mayor" | "Council Member";
  repName: string;
  repEmail: string | null;
  repPhone: string | null;
  wardLabel: string | null;
  termExpires: string | null;
}

export interface JustSubmittedPending {
  cityName: string;
  officials: JustSubmittedOfficial[];
  confirmations: number;
  confirmationsNeeded: number;
}

/** Minimal Web Storage shape this module needs — injectable for tests, since
 * plain `node --test` (no jsdom) has no real `sessionStorage` global. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getDefaultStorage(): StorageLike | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

/** Called by ContributeForm right after a successful submission. */
export function storeJustSubmitted(data: JustSubmittedPending, storage: StorageLike | null = getDefaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage can genuinely fail (private browsing, quota, disabled) —
    // this is a nice-to-have freshness shortcut, not a correctness
    // requirement (AddOfficialsCTA's own fetch fallback still works),
    // so failing silently here is the right amount of care, not none.
  }
}

/**
 * Called by AddOfficialsCTA on mount. Always clears the stored entry,
 * whether or not it matched — a mismatched or stale entry should never
 * resurface for a later, different city.
 */
export function consumeJustSubmitted(cityName: string, storage: StorageLike | null = getDefaultStorage()): JustSubmittedPending | null {
  if (!storage) return null;

  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
    storage.removeItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as JustSubmittedPending;
    if (fold(parsed.cityName) !== fold(cityName)) return null;
    return parsed;
  } catch {
    return null;
  }
}
