"use client";

// AreaFilterList — the "Areas shown" city checklist shared by WardMap.tsx's
// desktop left `<aside>` sidebar and MobileNav's Filters sheet. A plain
// presentational component: every visible-checked/labels/onToggle input
// comes in as props, no ref and no closure over WardMap's own refs
// (layerModeRef, visibleCitiesRef, etc.) — see WardMap.tsx's own comment
// on why the two call sites used to duplicate this JSX inline instead of
// sharing a helper (a JSX-returning function defined inside WardMap's
// render body, closing over those refs, tripped the react-hooks lint
// rule). A real, separately-mounted component sidesteps that: its own
// internal useState (group expand/collapse — see below) is completely
// ordinary here, unlike a ref read from inside WardMap's own render.
//
// Two shapes, picked by `grouped`:
//   - grouped=false (commissioners mode's 2-city list, or any short list):
//     the original flat checklist + a plain All/None bulk toggle, unchanged
//     in spirit from what WardMap.tsx used to render inline.
//   - grouped=true (wards mode's ~23 cities): cities grouped by county
//     (buildCityGroups, src/lib/cityGroups.ts) under collapsible
//     <details>/<summary> headers, each with its own All/None, plus one
//     top-level "Clear all." The old top-level "All" is retired here on
//     purpose — checking every city statewide in one click is the exact
//     performance foot-gun this component exists to avoid encouraging.
//
// The filter-query text itself is NOT local state here — it's owned by
// WardMap.tsx (query/onQueryChange props) so the floating (mobile sheet)
// and sidebar (desktop) instances — both mounted in the DOM at once, only
// one visible per breakpoint via CSS, same as visibleCities already being
// shared — stay in sync, the same way every other filter control here
// already does.
import { useState } from "react";
import type { City, County } from "@/lib/cities";
import { buildCityGroups, matchesCityQuery } from "@/lib/cityGroups";

export interface AreaFilterListProps {
  // The full set of cities this list can ever offer — MODE_VISIBLE_CITIES
  // [layerMode] at the call site, never the full CITIES list, so a bulk
  // toggle here can never touch a city the current mode isn't even
  // showing a checkbox for.
  cities: readonly City[];
  visibleCities: Record<City, boolean>;
  labels: Record<City, string>;
  accents: Record<string, string>;
  variant: "floating" | "sidebar";
  grouped: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onToggleCity: (city: City) => void;
  onSetCitiesVisible: (cities: readonly City[], visible: boolean) => void;
}

// Search input only earns its place once the list is long enough that
// scanning it is slower than typing a few letters — a 2-entry commissioners
// list never meets this, by design (see the "no filter input threshold
// met" unhappy-path case).
const FILTER_INPUT_THRESHOLD = 12;

function fold(s: string): string {
  return s.trim().toLowerCase();
}

const rowHoverClass = (variant: "floating" | "sidebar") => (variant === "sidebar" ? "hover:bg-sidebar-hover" : "hover:bg-hover");
const focusRingClass = (variant: "floating" | "sidebar") =>
  variant === "sidebar" ? "focus-visible:ring-sidebar-accent" : "focus-visible:ring-accent";

function BulkToggleButtons({
  variant,
  onAll,
  onNone,
  allLabel,
  groupLabel,
}: {
  variant: "floating" | "sidebar";
  onAll?: () => void;
  onNone: () => void;
  allLabel?: string;
  groupLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={groupLabel}
      className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide"
    >
      {onAll && allLabel ? (
        <>
          <button
            type="button"
            onClick={onAll}
            className={`rounded px-1.5 py-1 text-ink-3 transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 ${rowHoverClass(variant)} ${focusRingClass(variant)}`}
          >
            {allLabel}
          </button>
          <span aria-hidden="true" className="text-ink-3">
            /
          </span>
        </>
      ) : null}
      <button
        type="button"
        onClick={onNone}
        className={`rounded px-1.5 py-1 text-ink-3 transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 ${rowHoverClass(variant)} ${focusRingClass(variant)}`}
      >
        {onAll ? "None" : "Clear all"}
      </button>
    </div>
  );
}

function CityRow({
  city,
  label,
  accent,
  checked,
  variant,
  onToggle,
}: {
  city: City;
  label: string;
  accent: string | undefined;
  checked: boolean;
  variant: "floating" | "sidebar";
  onToggle: () => void;
}) {
  return (
    <label
      className={`flex items-center gap-2 px-3 py-2.5 sm:py-2 cursor-pointer select-none ${rowHoverClass(variant)}`}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} className="cursor-pointer accent-accent" />
      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: accent ?? "#9ca3af" }} />
      {label || city}
    </label>
  );
}

// Honest empty state (AGENTS.md §3.1 — never render nothing silently) for
// a query that matches no covered city, pointing at the header's own
// address search (the on-device, §2.5-governed one) for anything this
// list structurally can't answer.
function NoMatches() {
  return (
    <p className="px-3 py-3 text-sm text-ink-3">
      No covered city matches that. This list only covers cities with mapped ward/council data — try the address
      search above for any Minnesota address.
    </p>
  );
}

function FilterInput({
  variant,
  query,
  onQueryChange,
}: {
  variant: "floating" | "sidebar";
  query: string;
  onQueryChange: (query: string) => void;
}) {
  return (
    <div className="mb-1.5">
      <label className="sr-only" htmlFor={`area-filter-query-${variant}`}>
        Filter this list
      </label>
      <input
        id={`area-filter-query-${variant}`}
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Filter cities…"
        aria-label="Filter this list"
        className={`w-full rounded-lg border border-hair-strong bg-panel px-3 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 ${focusRingClass(variant)}`}
      />
    </div>
  );
}

function FlatList({
  cities,
  visibleCities,
  labels,
  accents,
  variant,
  query,
  onToggleCity,
}: {
  cities: readonly City[];
  visibleCities: Record<City, boolean>;
  labels: Record<City, string>;
  accents: Record<string, string>;
  variant: "floating" | "sidebar";
  query: string;
  onToggleCity: (city: City) => void;
}) {
  const matches = cities.filter((city) => matchesCityQuery(query, labels[city] || city));
  const listClass =
    variant === "floating"
      ? "max-h-[45vh] overflow-y-auto rounded-lg bg-panel-2/90 backdrop-blur-sm border border-hair shadow-lg shadow-(color:--shadow-panel) divide-y divide-hair text-sm text-ink-2"
      : "rounded-lg bg-panel-3 divide-y divide-hair text-sm text-ink-2";

  if (matches.length === 0) return <NoMatches />;

  return (
    <div role="group" aria-label="Filter by area" className={listClass}>
      {matches.map((city) => (
        <CityRow
          key={city}
          city={city}
          label={labels[city]}
          accent={accents[city]}
          checked={visibleCities[city]}
          variant={variant}
          onToggle={() => onToggleCity(city)}
        />
      ))}
    </div>
  );
}

function GroupedList({
  cities,
  visibleCities,
  labels,
  accents,
  variant,
  query,
  onToggleCity,
  onSetCitiesVisible,
}: {
  cities: readonly City[];
  visibleCities: Record<City, boolean>;
  labels: Record<City, string>;
  accents: Record<string, string>;
  variant: "floating" | "sidebar";
  query: string;
  onToggleCity: (city: City) => void;
  onSetCitiesVisible: (cities: readonly City[], visible: boolean) => void;
}) {
  const groups = buildCityGroups(cities);

  // Frozen at mount only (functional useState initializer runs once) —
  // a group containing any currently-checked city starts expanded, every
  // other group starts collapsed. Deliberately NOT recomputed on later
  // visibleCities changes: toggling a city off after the fact shouldn't
  // suddenly collapse the group a resident is actively looking at.
  const [initiallyOpen] = useState<Set<County>>(
    () => new Set(groups.filter((g) => g.cities.some((c) => visibleCities[c])).map((g) => g.county)),
  );
  // Explicit user clicks on a group's own <summary> — takes precedence
  // over the frozen initial-open set once a resident has touched it.
  // Ignored while a query is active (every matching group is forced open
  // during search — see isOpen below), so a stray toggle mid-search can't
  // leave a group stuck closed once the query is cleared.
  const [manualOverride, setManualOverride] = useState<Partial<Record<County, boolean>>>({});

  const queryActive = fold(query).length > 0;

  // Every group actually rendered below (see `rendered`, filtered to
  // matches.length > 0) is, by construction, a matching group while a
  // query is active — so "queryActive" alone is enough to force it open;
  // there's no separate "matching but should stay collapsed" case.
  const isOpen = (county: County) => {
    if (queryActive) return true;
    return manualOverride[county] ?? initiallyOpen.has(county);
  };

  const rendered = groups
    .map((group) => ({
      ...group,
      matched: group.cities.filter((c) => matchesCityQuery(query, labels[c] || c)),
    }))
    // A county group with zero matches while a filter query is active is
    // hidden entirely (not shown collapsed-and-empty) — restores the
    // instant the query is cleared, since `matched` reverts to the full
    // group then.
    .filter((group) => group.matched.length > 0);

  if (rendered.length === 0) return <NoMatches />;

  return (
    <div className="space-y-2">
      {rendered.map((group) => {
        const checkedCount = group.cities.filter((c) => visibleCities[c]).length;
        const totalCount = group.cities.length;
        const open = isOpen(group.county);
        return (
          <details
            key={group.county}
            open={open}
            className={`group rounded-lg border border-hair overflow-hidden ${variant === "sidebar" ? "bg-panel-3" : "bg-panel-2/90 backdrop-blur-sm shadow-lg shadow-(color:--shadow-panel)"}`}
            onToggle={(e) => {
              const nowOpen = e.currentTarget.open;
              if (queryActive) return;
              setManualOverride((prev) => ({ ...prev, [group.county]: nowOpen }));
            }}
          >
            <summary
              className={`flex list-none items-center justify-between gap-2 px-3 py-2 cursor-pointer select-none [&::-webkit-details-marker]:hidden focus:outline-none focus-visible:ring-2 focus-visible:-outline-offset-2 ${rowHoverClass(variant)} ${focusRingClass(variant)}`}
            >
              <span className="flex items-center gap-2 text-xs font-semibold text-ink-2">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  className="h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform duration-150 motion-reduce:transition-none group-open:rotate-180"
                >
                  <path d="m5.5 7.5 4.5 5 4.5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {group.county}
                <span className="font-normal normal-case text-ink-3">
                  ({checkedCount} of {totalCount} shown)
                </span>
              </span>
              {/* Bulk toggle for just this county — stopPropagation isn't
                  needed here since these buttons aren't nested inside the
                  <summary>'s own click target in a way that would also
                  fire the native open/close toggle; a <button> inside a
                  <summary> intercepts the click before it reaches the
                  summary's default action. */}
              <span onClick={(e) => e.stopPropagation()}>
                <BulkToggleButtons
                  variant={variant}
                  onAll={() => onSetCitiesVisible(group.cities, true)}
                  allLabel="All"
                  onNone={() => onSetCitiesVisible(group.cities, false)}
                  groupLabel={`Show or hide all of ${group.county} County`}
                />
              </span>
            </summary>
            <div className="divide-y divide-hair border-t border-hair">
              {group.matched.map((city) => (
                <CityRow
                  key={city}
                  city={city}
                  label={labels[city]}
                  accent={accents[city]}
                  checked={visibleCities[city]}
                  variant={variant}
                  onToggle={() => onToggleCity(city)}
                />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

export default function AreaFilterList({
  cities,
  visibleCities,
  labels,
  accents,
  variant,
  grouped,
  query,
  onQueryChange,
  onToggleCity,
  onSetCitiesVisible,
}: AreaFilterListProps) {
  const showFilterInput = cities.length > FILTER_INPUT_THRESHOLD;

  return (
    <div>
      {showFilterInput && <FilterInput variant={variant} query={query} onQueryChange={onQueryChange} />}
      <div className="mb-1.5 flex items-center justify-end">
        {!grouped && (
          <BulkToggleButtons
            variant={variant}
            onAll={() => onSetCitiesVisible(cities, true)}
            allLabel="All"
            onNone={() => onSetCitiesVisible(cities, false)}
            groupLabel="Show or hide all areas"
          />
        )}
        {grouped && (
          <BulkToggleButtons variant={variant} onNone={() => onSetCitiesVisible(cities, false)} groupLabel="Hide all areas" />
        )}
      </div>
      {grouped ? (
        <GroupedList
          cities={cities}
          visibleCities={visibleCities}
          labels={labels}
          accents={accents}
          variant={variant}
          query={query}
          onToggleCity={onToggleCity}
          onSetCitiesVisible={onSetCitiesVisible}
        />
      ) : (
        <FlatList
          cities={cities}
          visibleCities={visibleCities}
          labels={labels}
          accents={accents}
          variant={variant}
          query={query}
          onToggleCity={onToggleCity}
        />
      )}
    </div>
  );
}
