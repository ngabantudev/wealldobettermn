// Pure, framework-free helpers over the chunked address gazetteer (issue
// #70). Split out of src/lib/addressChunks.ts specifically so these stay
// testable with a plain `node --test` — addressChunks.ts itself is
// "use client" and pulls in React plus a JSON asset import (dataUrl.ts ->
// public/data-manifest.json), neither of which the plain Node ESM loader
// this repo's own *.test.mjs files run under can resolve without a
// bundler. Same reasoning as addressSearch.ts's own "no DOM/MapLibre
// import" split, one layer further out.
//
// Nothing here ever fetches anything — see addressChunks.ts for the
// fetch/cache/React-hook side of this.

import type { AddressGazetteerManifest, AddressIndex, AddressIndexChunk } from "./types.ts";
import { normalizeStreetName } from "./streetNormalize.mjs";

// Live prefix-typeahead for a street name needs only the *name*, never
// its edges/geometry — so it's sourced from the manifest's own
// streetChunks keys (the full street-name universe, always loaded — see
// WardMap.tsx) rather than from whichever chunk(s) happen to be loaded so
// far. This is what keeps street suggestions working the instant a
// resident starts typing, before any chunk has ever been fetched, and
// it's still a pure local scan over data already sitting in memory — no
// network call, same as addressSearch.ts's own suggestStreets (which this
// mirrors, but reads AddressGazetteerManifest instead of AddressIndex).
export function suggestStreetNamesFromManifest(manifest: AddressGazetteerManifest, partial: string, limit: number): string[] {
  const prefix = normalizeStreetName(partial);
  if (!prefix) return [];
  const matches: string[] = [];
  for (const street of Object.keys(manifest.streetChunks)) {
    if (street.startsWith(prefix)) matches.push(street);
    if (matches.length >= limit) break;
  }
  return matches.sort();
}

// Builds the merged view addressSearch.ts's resolve()/suggestStreets()/
// etc. expect: the manifest's own (always-complete) zips, plus the union
// of every currently-loaded chunk's streets. A street whose chunk hasn't
// loaded yet simply isn't in `streets` — the exact same "absent key" shape
// addressSearch.ts already treats as "not found," so no caller needed to
// change to tell "never existed" apart from "not fetched yet" differently.
// (Callers never actually hit that distinction in practice: SearchBar
// always calls ensureStreetChunksLoaded — which consults the manifest,
// not this merged index — before resolving a committed address query.)
export function mergeIndex(manifest: AddressGazetteerManifest, chunks: ReadonlyMap<string, AddressIndexChunk>): AddressIndex {
  const streets: Record<string, AddressIndex["streets"][string]> = {};
  for (const chunk of chunks.values()) {
    for (const [street, edges] of Object.entries(chunk.streets)) {
      // A street present in two loaded chunks (crosses our covered
      // counties) merges its edges from both — never overwrites, since
      // that would silently drop one county's candidates. See this
      // file's own header comment and AGENTS.md §2.5's ambiguity rule.
      const existing = streets[street];
      streets[street] = existing ? [...existing, ...edges] : edges;
    }
  }
  return {
    schemaVersion: manifest.schemaVersion,
    generatedAt: manifest.generatedAt,
    sourceCounties: manifest.sourceCounties,
    streets,
    zips: manifest.zips,
  };
}
