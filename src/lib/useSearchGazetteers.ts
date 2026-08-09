"use client";

// The two small, map-independent files SearchBar needs to resolve city/
// county/ZIP names and street suggestions — split out of WardMap.tsx
// (2026-08-09) so the persistent header search box (SiteSearch.tsx) can
// load them without depending on WardMap being mounted at all. WardMap
// keeps its own copy of this same hook for the SearchBar instance it
// still mounts inside MobileNav's Search tab (mobile search stays
// map-route-scoped for now — see WardMap.tsx's own comment on that) —
// two independent fetches of a few dozen KB total, not worth threading a
// second context just to dedupe.
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
