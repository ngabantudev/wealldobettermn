"use client";

// The address/city/county search box, rendered once inside SiteHeader
// (itself rendered once in app/layout.tsx — see that file's comment) so
// it's genuinely persistent chrome per AGENTS.md Part 4 ("Search Is The
// Primary Interface, Not The Map"), not something that vanishes off the
// map route. Before 2026-08-09 this was WardMap's own SearchBar instance,
// portaled into SiteHeader's #site-search-slot node — which meant it only
// existed while WardMap did, i.e. only on "/".
//
// This component owns none of the map/ward logic that used to live next
// to the portaled instance in WardMap.tsx. A selection here either reaches
// a live, mounted WardMap through src/lib/searchCoordinator.tsx (the
// common case — user is already on "/"), or, if WardMap isn't mounted,
// gets stashed there and this component navigates to "/" so WardMap can
// pick it up once its ward/city geometry has loaded (see WardMap.tsx's
// own pending-selection effect). Either way, this component itself never
// touches MapLibre, ward geometry, or the URL beyond that one navigation.
//
// addressManifest/mnPlaces come in as props now, not a useSearchGazetteers()
// call inside this component — SiteHeader.tsx mounts two instances of
// SiteSearch simultaneously on mobile (an always-present-but-CSS-hidden
// desktop box, and a second one inside the mobile search MobileSheet), and
// each instance calling the hook independently meant two full fetch+parse
// cycles of the same two gazetteer files every time the mobile search sheet
// opened, on top of the desktop instance's own fetch at page load — a real
// bandwidth/battery waste on the throttled-3G/old-phone target device
// AGENTS.md §4 cares about, caught in review. SiteHeader now calls the hook
// once and passes the result to both instances.
import { useRouter, usePathname } from "next/navigation";
import SearchBar from "./SearchBar";
import { useSearchCoordinator } from "@/lib/searchCoordinator";
import type { AddressGazetteerManifest, MnPlaces } from "@/lib/types";

interface SiteSearchProps {
  addressManifest: AddressGazetteerManifest | null;
  mnPlaces: MnPlaces | null;
}

export default function SiteSearch({ addressManifest, mnPlaces }: SiteSearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { dispatchSelection } = useSearchCoordinator();

  // dispatchSelection applies the selection immediately when WardMap is
  // mounted (we're already on "/") — only navigate when it wasn't, so a
  // selection made on "/" itself never triggers a redundant push.
  const goToMap = () => {
    if (pathname !== "/") router.push("/");
  };

  return (
    <SearchBar
      manifest={addressManifest}
      allPlaces={mnPlaces}
      onSelectWard={(ref, point) => {
        if (!dispatchSelection({ kind: "ward", ref, point })) goToMap();
      }}
      onSelectCity={(city) => {
        if (!dispatchSelection({ kind: "city", city })) goToMap();
      }}
      onSelectCounty={(_county, cities) => {
        if (!dispatchSelection({ kind: "county", cities })) goToMap();
      }}
    />
  );
}
