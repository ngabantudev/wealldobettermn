"use client";

// The two small, map-independent files SearchBar needs to resolve city/
// county/ZIP names and street suggestions — split out of WardMap.tsx
// (2026-08-09) so the persistent header search box (SiteSearch.tsx) can
// load them without depending on WardMap being mounted at all.
//
// Called once, in SiteHeader.tsx — not inside SiteSearch.tsx itself, even
// though SiteSearch is the actual consumer of the data. SiteHeader mounts
// two SiteSearch instances simultaneously on mobile (an always-present-
// but-CSS-hidden desktop box, and a second one inside the mobile search
// MobileSheet); calling this hook from inside SiteSearch (the original
// shape) meant each instance fetched independently — two full fetch+parse
// cycles of the same two files, a real bandwidth/battery cost on the
// throttled-3G/old-phone target device AGENTS.md §4 cares about, caught in
// review. SiteHeader now calls this once and passes the result down as
// props to both SiteSearch instances, so there's exactly one fetch of
// these two files per page load, not two.
//
// The mobile chrome redesign separately deleted WardMap's own copy of this
// same fetch pair (it used to feed a WardMap-owned duplicate SearchBar
// instance living in the now-deleted MobileNav's Search tab) — mobile
// search is SiteSearch's single implementation for every breakpoint now.
import { useEffect, useState } from "react";
import { dataUrl } from "@/lib/dataUrl";
import type { AddressGazetteerManifest, MnPlaces } from "@/lib/types";

export function useSearchGazetteers() {
  // Both start null and stay that way until their fetch resolves —
  // SearchBar is explicitly designed to degrade gracefully on `null` (see
  // its own props comment): city/county search works immediately off
  // src/lib/cities.ts, street/ZIP suggestions just wait.
  const [addressManifest, setAddressManifest] = useState<AddressGazetteerManifest | null>(null);
  const [mnPlaces, setMnPlaces] = useState<MnPlaces | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(dataUrl("address-index/manifest.json"))
      .then((res) => res.json())
      .then((data: AddressGazetteerManifest) => {
        if (!cancelled) setAddressManifest(data);
      })
      .catch((err) => console.error("[useSearchGazetteers] failed to load address gazetteer manifest", err));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(dataUrl("mn-places.json"))
      .then((res) => res.json())
      .then((data: MnPlaces) => {
        if (!cancelled) setMnPlaces(data);
      })
      .catch((err) => console.error("[useSearchGazetteers] failed to load MN place list", err));
    return () => {
      cancelled = true;
    };
  }, []);

  return { addressManifest, mnPlaces };
}
