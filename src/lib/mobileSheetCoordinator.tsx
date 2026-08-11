"use client";

// Sheet-exclusivity coordinator — the mobile chrome now has two independent
// components that can each raise a MobileSheet.tsx instance above
// MobileBottomNav's global bar: SiteHeader's Search trigger, and WardMap's
// Filters trigger (plus WardMap's own priority ward/rep modal, which
// bypasses this entirely — see below). Before the bottom nav became global
// (site-wide, in layout.tsx) there was only ever one sheet owner
// (WardMap's old tab bar), so "only one open at a time" was automatic —
// there was nowhere else to open one from. Now that Search and WardMap are
// siblings that can both be mounted at once (the map route), opening one
// without closing the other would stack two full-viewport scrims; only the
// top one's onClick can ever receive a dismiss tap, so the other becomes a
// stuck, undismissable surface. This context is the fix: exactly one
// `openSheet` id at a time, site-wide.
//
// Deliberately NOT folded into searchCoordinator.tsx — that module's own
// header comment scopes it to "search-result relay to WardMap" specifically
// and has no reason to know a `"filters"` id exists. Deliberately NOT
// useDismissable.ts either — that hook arbitrates how *one* surface closes
// itself (Escape, outside-pointerdown), not which of several independently-
// owned surfaces is allowed to be open. Same shape as searchCoordinator.tsx
// on purpose (context + provider + hook, one small file) — this codebase's
// established pattern for "components need to coordinate across the tree."
//
// The priority ward/rep modal (WardMap's `selected` state) is NOT a
// "sheet" in this vocabulary — it already outranks everything unconditionally
// (see WardMap.tsx's own comment on that priority), so it doesn't read or
// write `openSheet` at all; it just renders regardless of this context's
// value, same as before. WardMap's own dismiss-first-then-open logic when a
// tab was tapped while the modal was up is preserved locally in WardMap,
// not moved here.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type MobileSheetId = "search" | "filters";

interface MobileSheetCoordinatorValue {
  openSheet: MobileSheetId | null;
  // Opening a sheet always replaces whatever was open — there is never a
  // reason to have two ids "open" at once, so this isn't additive. Passing
  // the same id again is the caller's own toggle-closed convenience (see
  // both mount sites), not something this module needs to special-case.
  setOpenSheet: (id: MobileSheetId | null) => void;
}

const MobileSheetCoordinatorContext = createContext<MobileSheetCoordinatorValue | null>(null);

export function MobileSheetCoordinatorProvider({ children }: { children: ReactNode }) {
  const [openSheet, setOpenSheet] = useState<MobileSheetId | null>(null);
  const value = useMemo<MobileSheetCoordinatorValue>(() => ({ openSheet, setOpenSheet }), [openSheet]);
  return <MobileSheetCoordinatorContext.Provider value={value}>{children}</MobileSheetCoordinatorContext.Provider>;
}

export function useMobileSheetCoordinator(): MobileSheetCoordinatorValue {
  const value = useContext(MobileSheetCoordinatorContext);
  if (!value) {
    throw new Error("useMobileSheetCoordinator must be used within a MobileSheetCoordinatorProvider");
  }
  return value;
}
