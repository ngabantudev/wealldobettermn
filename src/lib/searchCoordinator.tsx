"use client";

// Bridges the persistent header search box (src/components/SiteSearch.tsx,
// mounted once in app/layout.tsx alongside SiteHeader) to WardMap — which
// is the only thing that actually knows how to move the map and owns the
// ward/city/county geometry a selection resolves against, and only exists
// while the "/" route is mounted.
//
// Before 2026-08-09 the search box itself was WardMap-owned (a JSX const
// portaled into SiteHeader's #site-search-slot node), so it vanished on
// every other route along with WardMap. Making the box genuinely
// persistent chrome (AGENTS.md Part 4: "Search Is The Primary Interface,
// Not The Map") means it can no longer call WardMap's apply* functions
// directly — it may be rendered while WardMap isn't mounted at all. This
// module is the seam: WardMap registers its live handlers here while
// mounted; the header search box calls through the registry if a handler
// is present, and otherwise stashes the selection and navigates to "/" so
// WardMap can apply it once it (re)mounts and its ward/city data is ready.
//
// No address, street number, or resolved point ever leaves this in-memory
// module — it's the same client-side handoff AGENTS.md §2.5 already
// requires of address resolution itself, just relayed across a route
// change instead of a component boundary. Nothing here touches the URL,
// localStorage, or any network request.
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import type { WardRef } from "@/lib/types";
import type { City } from "@/lib/cities";

interface MapSearchHandlers {
  onSelectWard: (ref: WardRef, point: [number, number] | null) => void;
  onSelectCity: (city: City) => void;
  onSelectCounty: (cities: City[]) => void;
  // A real MN city with no ward/mayor data at all — see SearchBar.tsx's
  // own comment on this same prop name. Registered by WardMap's
  // applyUncoveredCityZoom, same as the three handlers above.
  onSelectUncoveredCity: (name: string) => void;
}

// The four SearchBar outcomes (see WardMap.tsx's applySearchResult/
// applyCityZoom/applyCountyZoom/applyUncoveredCityZoom), captured as data
// so they can wait in `pendingRef` until a map handler is actually
// available. `county` isn't carried here for the same reason WardMap's own
// onSelectCounty callback already drops it (see SiteSearch.tsx) —
// applyCountyZoom only ever acts on the resolved city list.
export type PendingSelection =
  | { kind: "ward"; ref: WardRef; point: [number, number] | null }
  | { kind: "city"; city: City }
  | { kind: "county"; cities: City[] }
  | { kind: "uncovered-city"; name: string };

interface SearchCoordinatorValue {
  // WardMap calls this once on mount with its live apply* functions, and
  // again with `null` on unmount — see WardMap.tsx's registration effect.
  registerMapHandlers: (handlers: MapSearchHandlers | null) => void;
  // Called by the persistent search box on every committed selection.
  // Returns true if a mounted WardMap applied it immediately; false means
  // it was stashed in `pendingRef` and the caller still needs to navigate
  // to "/" itself (see SiteSearch.tsx — this module never navigates).
  dispatchSelection: (selection: PendingSelection) => boolean;
  // Called once by WardMap after it (re)mounts and its ward/city geometry
  // has loaded, to pick up and clear anything selected while it wasn't
  // around. Returns null on the common case (nothing pending).
  takePendingSelection: () => PendingSelection | null;
}

const SearchCoordinatorContext = createContext<SearchCoordinatorValue | null>(null);

export function SearchCoordinatorProvider({ children }: { children: ReactNode }) {
  // Refs, not state: nothing here should ever trigger a re-render of the
  // provider itself — it's pure plumbing between two components that
  // already own their own render state (SiteSearch's SearchBar instance,
  // WardMap's map/selection state).
  const handlersRef = useRef<MapSearchHandlers | null>(null);
  const pendingRef = useRef<PendingSelection | null>(null);

  const registerMapHandlers = useCallback((handlers: MapSearchHandlers | null) => {
    handlersRef.current = handlers;
  }, []);

  const dispatchSelection = useCallback((selection: PendingSelection) => {
    const handlers = handlersRef.current;
    if (!handlers) {
      pendingRef.current = selection;
      return false;
    }
    switch (selection.kind) {
      case "ward":
        handlers.onSelectWard(selection.ref, selection.point);
        break;
      case "city":
        handlers.onSelectCity(selection.city);
        break;
      case "county":
        handlers.onSelectCounty(selection.cities);
        break;
      case "uncovered-city":
        handlers.onSelectUncoveredCity(selection.name);
        break;
    }
    return true;
  }, []);

  const takePendingSelection = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    return pending;
  }, []);

  // registerMapHandlers/dispatchSelection/takePendingSelection are all
  // stable ([] deps) useCallbacks, so this only ever computes once — but
  // useMemo (not a bare object literal) keeps the context value identity
  // stable even if that ever changes, so consumers don't re-render on
  // every provider render for no reason.
  const value = useMemo<SearchCoordinatorValue>(
    () => ({ registerMapHandlers, dispatchSelection, takePendingSelection }),
    [registerMapHandlers, dispatchSelection, takePendingSelection],
  );

  return <SearchCoordinatorContext.Provider value={value}>{children}</SearchCoordinatorContext.Provider>;
}

export function useSearchCoordinator(): SearchCoordinatorValue {
  const value = useContext(SearchCoordinatorContext);
  if (!value) {
    throw new Error("useSearchCoordinator must be used within a SearchCoordinatorProvider");
  }
  return value;
}
