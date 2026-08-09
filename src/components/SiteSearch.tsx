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
import { useRouter, usePathname } from "next/navigation";
import SearchBar from "./SearchBar";
import { useSearchCoordinator } from "@/lib/searchCoordinator";
import { useSearchGazetteers } from "@/lib/useSearchGazetteers";

export default function SiteSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const { dispatchSelection } = useSearchCoordinator();
  const { addressManifest, mnPlaces } = useSearchGazetteers();

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
      onSelectUncoveredCity={(name) => {
        if (!dispatchSelection({ kind: "uncovered-city", name })) goToMap();
      }}
    />
  );
}
