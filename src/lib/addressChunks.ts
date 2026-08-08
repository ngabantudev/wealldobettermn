// Client-side loader for the chunked address gazetteer (issue #70 —
// AGENTS.md §4's "chunked and lazily loaded so nobody downloads the whole
// state to find one ward"). SearchBar.tsx's only source of address-chunk
// fetches; src/lib/addressSearch.ts stays pure and untouched — it still
// only ever sees the merged AddressIndex shape it always has, assembled
// in src/lib/addressGazetteer.ts from whichever chunk(s) have actually
// been loaded. This file is the React-hook/fetch/cache wiring around that
// pure merge logic — see addressGazetteer.ts's own file comment for why
// that split exists.
//
// The one rule this file is built around, mirroring addressSearch.ts's own
// "ward identity is never decided here": *which chunk a street lives in*
// is never decided here either. It was already decided once, offline, in
// scripts/fetch-addresses.mjs (the manifest's `streetChunks` map). This
// file only ever fetches exactly the chunk(s) that map says a given
// street needs — never a guess, never "just fetch them all to be safe."
//
// When this fetches at all: only from a *committed* query (Enter, or
// clicking a suggestion) — see SearchBar.tsx's commit handlers — never
// from a keystroke. Prefix-typeahead (suggestStreetNamesFromManifest /
// suggestStreetsForHouseNumber) works off the manifest's own street-name
// universe and whatever chunks happen to already be loaded; it never
// triggers a fetch itself, which is what keeps AGENTS.md §2.5's "no
// typeahead network calls" true here exactly the same way it was true of
// the old single-file index — there's still no request a keystroke could
// trigger.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AddressGazetteerManifest, AddressIndex, AddressIndexChunk } from "./types.ts";
import { dataUrl } from "./dataUrl.ts";
import { mergeIndex } from "./addressGazetteer.ts";

async function fetchChunk(key: string): Promise<AddressIndexChunk> {
  const res = await fetch(dataUrl(`address-index/${key}.json`));
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching address chunk "${key}"`);
  return res.json();
}

export interface AddressChunkLoader {
  // The merged index, growing as chunks load. Streets/ZIP resolution
  // against this can start immediately — zips are always complete, and an
  // address resolution only ever happens after ensureStreetChunksLoaded
  // (below) has already fetched whatever it needs.
  index: AddressIndex | null;
  // True while at least one chunk fetch triggered by
  // ensureStreetChunksLoaded is in flight — SearchBar shows a "loading
  // this street's data" message keyed off this, same idea as the
  // pre-existing "index is still loading" message for the old flat file.
  isLoadingChunk: boolean;
  // Resolves to the merged index once every chunk the manifest's
  // streetChunks map lists for `street` has been fetched (a no-op that
  // returns the current merge for chunks already loaded, or for a street
  // the manifest doesn't recognize at all — nothing to fetch for a street
  // that was never in the data). Never fetches a chunk the manifest
  // didn't name for this exact street. Returns the merged index directly
  // (rather than relying on the caller re-rendering to see fresh `index`
  // state) so a commit handler can resolve against it in the same tick.
  ensureStreetChunksLoaded: (street: string) => Promise<AddressIndex | null>;
}

// One instance per SearchBar mount (see WardMap.tsx's own comment on two
// independent SearchBar instances) — each keeps its own in-memory chunk
// cache. A chunk already fetched by the other instance this session isn't
// shared, but the browser's own HTTP cache (see dataUrl.ts) still turns
// that into a cache hit rather than a second network round trip.
export function useAddressChunkLoader(manifest: AddressGazetteerManifest | null): AddressChunkLoader {
  // The cache itself lives in a ref — mergeIndex only needs to run once
  // per actual fetch, and ensureStreetChunksLoaded returns its result
  // straight from that computation rather than waiting on a state update
  // + re-render to see a value it just computed. Never read or written
  // during render itself (react-hooks' "no ref access during render"
  // rule) — only from this effect and from the event-triggered callback
  // below, both of which run outside the render phase.
  const chunksRef = useRef<Map<string, AddressIndexChunk>>(new Map());
  const pendingRef = useRef<Map<string, Promise<AddressIndexChunk>>>(new Map());
  const [index, setIndex] = useState<AddressIndex | null>(null);
  const [isLoadingChunk, setIsLoadingChunk] = useState(false);

  // Resets the chunk cache and seeds `index` (zips only, no streets yet)
  // whenever `manifest` changes identity — in practice that's just the
  // one time it goes from null to loaded (WardMap.tsx fetches it once),
  // but this stays correct if that ever changes without needing its own
  // ref-based guard.
  useEffect(() => {
    chunksRef.current = new Map();
    setIndex(manifest ? mergeIndex(manifest, chunksRef.current) : null);
  }, [manifest]);

  const ensureStreetChunksLoaded = useCallback(
    async (street: string): Promise<AddressIndex | null> => {
      if (!manifest) return null;
      const keys = manifest.streetChunks[street];
      const missing = (keys ?? []).filter((key) => !chunksRef.current.has(key));
      if (missing.length === 0) return mergeIndex(manifest, chunksRef.current);

      setIsLoadingChunk(true);
      try {
        const fetched = await Promise.all(
          missing.map((key) => {
            const pending = pendingRef.current.get(key);
            if (pending) return pending;
            const promise = fetchChunk(key).finally(() => pendingRef.current.delete(key));
            pendingRef.current.set(key, promise);
            return promise;
          }),
        );
        const next = new Map(chunksRef.current);
        for (const chunk of fetched) next.set(chunk.county.key, chunk);
        chunksRef.current = next;
        const merged = mergeIndex(manifest, next);
        setIndex(merged);
        return merged;
      } finally {
        setIsLoadingChunk(false);
      }
    },
    [manifest],
  );

  return { index, isLoadingChunk, ensureStreetChunksLoaded };
}
