"use client";

// The two small, map-independent files SearchBar needs to resolve city/
// county/ZIP names and street suggestions — split out of WardMap.tsx
// (2026-08-09) so the persistent header search box (SiteSearch.tsx) can
// load them without depending on WardMap being mounted at all.
//
// SiteSearch.tsx is this hook's only consumer now — the mobile chrome
// redesign deleted WardMap's own separate copy of this same fetch pair
// (it used to feed a WardMap-owned duplicate SearchBar instance living in
// the now-deleted MobileNav's Search tab). Mobile search is SiteSearch's
// single implementation for every breakpoint now, reachable from
// SiteHeader on all of them (see that file's own comment) — so there's
// exactly one fetch of these two files per page load, not two.
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
