"use client";

// ParticipationRecordList — the accessible DOM record list for
// "participation" LayerMode, matching AGENTS.md §4's rule for every other
// mode: "The DOM record list beside the MapLibre canvas is the primary
// screen-reader interface and must stay perfectly in sync with drawn
// features. A ward must be selectable, and its representative readable,
// without ever touching the map." There is no pre-existing generic
// version of this list to reuse (WardModal's own detail panel is
// officials-shaped, opened per-selection, not a persistent scan list) —
// this is the turnout-shaped equivalent: every city with a resolved
// record, always present in the DOM, independently readable and
// selectable by keyboard/screen reader with the map absent, failed, or
// never loaded (AGENTS.md "Search Is The Primary Interface, Not The
// Map").
//
// AGENTS.md §1c: rows are listed alphabetically by city name — never
// sorted or ranked by turnout — so this can never read as a "highest/
// lowest turnout" leaderboard. A number and its denominator, nothing
// computed on top.
import { useMemo, useState } from "react";
import type { ParticipationCityProperties } from "@/lib/turnoutJoin";
import { focusRingClass, rowHoverClass } from "@/lib/variantClasses";

export interface ParticipationRecordListProps {
  cities: readonly ParticipationCityProperties[];
  variant: "floating" | "sidebar";
  onSelectCity: (city: ParticipationCityProperties) => void;
}

function fold(s: string): string {
  return s.trim().toLowerCase();
}

function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value * 1000) / 10}%`;
}

function RecordRow({
  city,
  variant,
  onSelect,
}: {
  city: ParticipationCityProperties;
  variant: "floating" | "sidebar";
  onSelect: () => void;
}) {
  const edgeClass = variant === "sidebar" ? "-mx-4 px-4" : "px-3";
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center justify-between gap-2 ${edgeClass} py-2 text-left text-xs cursor-pointer ${rowHoverClass(variant)} ${focusRingClass(variant)}`}
      >
        <span className="min-w-0 flex-1 truncate text-ink-2">
          {city.name}
          {city.county && <span className="text-ink-4"> ({city.county})</span>}
        </span>
        {!city.matched ? (
          <span className="shrink-0 text-ink-4">no data</span>
        ) : city.belowThreshold ? (
          <span className="shrink-0 text-ink-4">too small to shade</span>
        ) : (
          <span className="shrink-0 tabular-nums font-medium text-ink">{formatPercent(city.turnoutOfRegistered)}</span>
        )}
      </button>
    </li>
  );
}

export default function ParticipationRecordList({ cities, variant, onSelectCity }: ParticipationRecordListProps) {
  const [query, setQuery] = useState("");

  // Alphabetical, never by turnout value — see this file's own header,
  // AGENTS.md §1c.
  const sorted = useMemo(() => [...cities].sort((a, b) => a.name.localeCompare(b.name)), [cities]);
  const matches = useMemo(() => {
    const q = fold(query);
    if (q.length === 0) return sorted;
    return sorted.filter((c) => fold(c.name).includes(q) || (c.county && fold(c.county).includes(q)));
  }, [sorted, query]);

  const listClass =
    variant === "floating"
      ? "max-h-[40vh] overflow-y-auto rounded-lg bg-panel-2/90 backdrop-blur-sm border border-hair shadow-lg shadow-(color:--shadow-panel) divide-y divide-hair"
      : "max-h-[40vh] overflow-y-auto divide-y divide-hair border-t border-hair";

  return (
    <div>
      <label className="sr-only" htmlFor={`participation-list-query-${variant}`}>
        Search for a city&apos;s turnout record
      </label>
      <input
        id={`participation-list-query-${variant}`}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a city…"
        aria-label="Search for a city's turnout record"
        className="mb-1.5 w-full rounded-lg border border-hair-strong bg-panel px-3 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus-visible:ring-2"
      />
      {matches.length === 0 ? (
        <p className="px-3 py-3 text-sm text-ink-3">No city matches that search.</p>
      ) : (
        <ul role="list" aria-label="Cities with 2024 general election turnout data, alphabetical" className={listClass}>
          {matches.map((city) => (
            <RecordRow key={`${city.cityId ?? city.name}-${city.county ?? ""}`} city={city} variant={variant} onSelect={() => onSelectCity(city)} />
          ))}
        </ul>
      )}
    </div>
  );
}
