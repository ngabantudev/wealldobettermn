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
import { focusRingClass, rowHoverClass } from "@/lib/variantClasses";

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

// Lets each interactive row's own hover fill reach the actual left/right
// edge of the sidebar `<aside>`, edge-to-edge — matching mndatacenter.org's
// own filter rows, where the highlight spans the full panel width, not just
// the row's own inset box. The sidebar variant's rows render inside
// WardMap.tsx's padded content column (`px-4 py-5` on the `<aside>`'s inner
// wrapper — see that file's own comment on it) — the row itself needs a
// negative margin exactly matching that padding to "break out" of it before
// re-applying the same amount as its own padding, or the hover fill would
// stop at the row's box, inset from the aside's real edge. The floating
// variant doesn't need this: its own box (FlatList/GroupedList's `border
// border-hair` wrapper) has no such outer padding, so a row's own px-3
// already reaches that box's real edge.
function edgeToEdgeClass(variant: "floating" | "sidebar"): string {
  return variant === "sidebar" ? "-mx-4 px-4" : "px-3";
}

// iOS/macOS-style switch for All/None — "None" / "All" flank a single
// sliding pill, rather than two separate action buttons. This is a real
// binary switch, not a segmented control: `role="switch"` + `aria-checked`,
// one knob, one track. "On" (checked) means every city this control
// governs is currently visible — the track fills --positive (this
// codebase's own "affirmative signal" color, globals.css — its first
// genuinely correct use in this sidebar; a prior pass had spent it on a
// static banner instead, which is what got walked back) and the knob
// slides to the "All" side. Anything short of fully-on — nothing shown,
// or a mixed state, some cities checked and others not — reads as "off":
// the track uses --sidebar-hover, vetted to clear WCAG 1.4.11's 3:1
// against every surface this switch can sit on (see that token's own
// comment in globals.css). Unlike a transient hover fill (see
// rowHoverClass's own comment in variantClasses.ts on why *that* can be
// lighter), this track is a permanently-visible UI boundary whenever the
// switch is off, not a mouse-only affordance — it needs the stronger,
// always-legible value on its own merits. The knob sits at the "None"
// side when off. A mixed state has no honest "half on"
// rendering on a real switch, so it collapses to "off" — clicking from
// there turns everything *on* (matches the common "select all" tri-state
// convention: clicking a partially-checked control always completes it to
// fully-checked, never fully-unchecked).
//
// The lone "Clear all" call site (grouped mode's top-level bulk control,
// where a global "All" was deliberately retired — see AreaFilterList's
// own header comment on why) has no "All" side to switch to, so it isn't
// a switch at all — just a plain text action, same underlined-link
// treatment this whole control used to have everywhere.
function BulkToggleButtons({
  variant,
  onAll,
  onNone,
  allLabel,
  groupLabel,
  checkedCount,
  totalCount,
}: {
  variant: "floating" | "sidebar";
  onAll?: () => void;
  onNone: () => void;
  allLabel?: string;
  groupLabel: string;
  checkedCount: number;
  totalCount: number;
}) {
  if (!onAll || !allLabel) {
    return (
      <button
        type="button"
        onClick={onNone}
        className={`rounded underline decoration-hair-strong underline-offset-2 text-[11px] font-medium uppercase tracking-wide text-ink-3 transition-colors hover:text-ink hover:decoration-current focus:outline-none focus-visible:ring-2 ${focusRingClass(variant)}`}
      >
        Clear all
      </button>
    );
  }

  const allOn = totalCount > 0 && checkedCount === totalCount;
  const sideLabelClass = (active: boolean) => `text-[10px] font-semibold uppercase tracking-wide ${active ? "text-ink" : "text-ink-4"}`;

  return (
    <div className="inline-flex items-center gap-1.5" role="group" aria-label={groupLabel}>
      <span aria-hidden="true" className={sideLabelClass(!allOn)}>
        None
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={allOn}
        aria-label={groupLabel}
        onClick={allOn ? onNone : onAll}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${focusRingClass(variant)} ${
          allOn ? "bg-positive" : "bg-sidebar-hover"
        }`}
      >
        {/* A literal white knob, not a token — every native iOS/macOS
            switch keeps its knob white in both light and dark appearance,
            so a themed token here (e.g. --panel-2, which is dark in this
            app's own dark theme) would look wrong precisely when it
            "correctly" followed the theme. */}
        <span
          aria-hidden="true"
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${allOn ? "translate-x-4" : "translate-x-0.5"}`}
        />
      </button>
      <span aria-hidden="true" className={sideLabelClass(allOn)}>
        {allLabel}
      </span>
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
    // py-2.5 on mobile (below sm) is load-bearing — AGENTS.md §4's 44px
    // minimum touch target, non-negotiable. sm:py-1.5 tightens desktop-
    // only, where the interaction is a mouse/trackpad click with no
    // touch-target floor, closer to mndatacenter.org's own denser row
    // height.
    <label
      className={`flex items-center gap-2 ${edgeToEdgeClass(variant)} py-2.5 sm:py-1.5 cursor-pointer select-none ${rowHoverClass(variant)}`}
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
        Search for a city
      </label>
      <input
        id={`area-filter-query-${variant}`}
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search a city…"
        aria-label="Search for a city"
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

  // Every group starts collapsed, full stop — including a county holding
  // a currently-checked city (Hennepin/Ramsey, under the DEFAULT_VISIBLE_
  // CITIES default). An earlier version auto-expanded those on first
  // paint on the theory that a collapsed group would hide *why*
  // Minneapolis/St. Paul wards are already on the map; per-group counts
  // (see "n of m shown" in each summary below) turned out to answer that
  // without needing the group itself open, so a resident who wants the
  // full statewide list to read as uniformly scannable — nothing
  // "special" pre-opened for them — gets that instead.
  //
  // Explicit user clicks on a group's own <summary> — takes precedence
  // once a resident has touched it. Ignored while a query is active
  // (every matching group is forced open during search — see isOpen
  // below), so a stray toggle mid-search can't leave a group stuck closed
  // once the query is cleared.
  const [manualOverride, setManualOverride] = useState<Partial<Record<County, boolean>>>({});

  const queryActive = fold(query).length > 0;

  // Every group actually rendered below (see `rendered`, filtered to
  // matches.length > 0) is, by construction, a matching group while a
  // query is active — so "queryActive" alone is enough to force it open;
  // there's no separate "matching but should stay collapsed" case.
  const isOpen = (county: County) => {
    if (queryActive) return true;
    return manualOverride[county] ?? false;
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

  // Flat, divided list — no per-group border/radius/background "card." A
  // prior pass gave each county's own <details> its own
  // `rounded-lg border border-hair` box (plus a bg-panel-3/bg-panel-2 fill),
  // which read as N small cards stacked inside the sidebar's own panel —
  // boxes nested inside a box. mndatacenter.org's own filter sidebar never
  // does this: county rows are separated by a hairline only, matching the
  // divide-y treatment FlatList already uses for its own (non-grouped) row
  // list just above.
  //
  // Sidebar variant: fully flat — divide-y + a leading border-t is the only
  // separator, same "recessed surface, no drawn box" posture as the rest of
  // this panel (see sidebarFilterControls's own comment in WardMap.tsx on
  // why nothing here gets a card border). Floating variant: still gets one
  // *outer* box (this list floats directly over a live, busy map image, so
  // it keeps needing a legible edge against arbitrary map colors — see the
  // point 5 judgment call this mirrors on BulkToggleButtons/CityRow already
  // applying without a matching change here) — but that's one shadowed
  // panel around the whole grouped list now, not one per county. Same
  // information, a third of the visual weight.
  const wrapperClass =
    variant === "sidebar"
      ? "divide-y divide-hair border-t border-hair text-sm text-ink-2"
      : "rounded-lg overflow-hidden bg-panel-2/90 backdrop-blur-sm border border-hair shadow-lg shadow-(color:--shadow-panel) divide-y divide-hair text-sm text-ink-2";

  return (
    <div className={wrapperClass}>
      {rendered.map((group) => {
        const checkedCount = group.cities.filter((c) => visibleCities[c]).length;
        const totalCount = group.cities.length;
        const open = isOpen(group.county);
        return (
          <details
            key={group.county}
            open={open}
            className="group"
            onToggle={(e) => {
              const nowOpen = e.currentTarget.open;
              if (queryActive) return;
              setManualOverride((prev) => ({ ...prev, [group.county]: nowOpen }));
            }}
          >
            <summary
              className={`flex list-none items-center justify-between gap-2 ${edgeToEdgeClass(variant)} py-2 cursor-pointer select-none [&::-webkit-details-marker]:hidden focus:outline-none focus-visible:ring-2 focus-visible:-outline-offset-2 ${rowHoverClass(variant)} ${focusRingClass(variant)}`}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold text-ink-2">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  className="h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform duration-150 motion-reduce:transition-none group-open:rotate-180"
                >
                  <path d="m5.5 7.5 4.5 5 4.5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="truncate">{group.county}</span>
                {/* "(n/m)" rather than "(n of m shown)" — short enough to
                    never wrap onto its own line next to the county name at
                    the sidebar's narrowest width, unlike the longer form
                    (see git history for the wrap it used to cause).
                    whitespace-nowrap + shrink-0 keep it intact as one
                    unit even if the row itself gets tight; the full
                    "n of m shown" phrasing survives for screen readers via
                    the sr-only span below rather than being lost. */}
                <span aria-hidden="true" className="shrink-0 whitespace-nowrap font-normal normal-case tabular-nums text-ink-3">
                  ({checkedCount}/{totalCount})
                </span>
                <span className="sr-only">
                  , {checkedCount} of {totalCount} shown
                </span>
              </span>
              {/* Bulk toggle for just this county — stopPropagation isn't
                  needed here since these buttons aren't nested inside the
                  <summary>'s own click target in a way that would also
                  fire the native open/close toggle; a <button> inside a
                  <summary> intercepts the click before it reaches the
                  summary's default action. */}
              <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                <BulkToggleButtons
                  variant={variant}
                  onAll={() => onSetCitiesVisible(group.cities, true)}
                  allLabel="All"
                  onNone={() => onSetCitiesVisible(group.cities, false)}
                  groupLabel={`Show or hide all of ${group.county} County`}
                  checkedCount={checkedCount}
                  totalCount={totalCount}
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
  const checkedCount = cities.filter((c) => visibleCities[c]).length;
  const totalCount = cities.length;

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
            checkedCount={checkedCount}
            totalCount={totalCount}
          />
        )}
        {grouped && (
          <BulkToggleButtons
            variant={variant}
            onNone={() => onSetCitiesVisible(cities, false)}
            groupLabel="Hide all areas"
            checkedCount={checkedCount}
            totalCount={totalCount}
          />
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
