"use client";

import { useId, useMemo, useState } from "react";
import type { AddressIndex, MnPlaces, WardRef } from "@/lib/types";
import { CITIES, COUNTIES, COUNTY_CITIES, type City, type County } from "@/lib/cities";
import { parseQuery, resolve, suggestStreets, type SearchOutcome } from "@/lib/addressSearch";
import CoverageNotice from "./CoverageNotice";

interface SearchBarProps {
  // null while public/address-index.json is still being fetched — see
  // WardMap.tsx's map-independent effect for why this can't just block
  // the whole component (Part 4: search must work even if the map never
  // finishes loading, and it shouldn't have to wait for the gazetteer to
  // let someone search a city or county in the meantime either).
  index: AddressIndex | null;
  // null while public/mn-places.json is still being fetched. Every MN
  // city/county this app actually covers (CITIES/COUNTIES below) works
  // immediately regardless — this only widens suggestions/recognition to
  // the rest of the state (AGENTS.md §3.3 Coverage Honesty; see
  // addressSearch.ts's "uncovered-place" kind).
  allPlaces: MnPlaces | null;
  onSelectWard: (ref: WardRef) => void;
  onSelectCity: (city: City) => void;
  onSelectCounty: (county: County, cities: City[]) => void;
}

// One of these per row in the dropdown while the user is still typing
// (before anything's been committed) — a live, entirely local preview of
// what Enter would resolve to. Never a network call: this is plain array
// filtering over data already sitting in memory, which is what actually
// makes AGENTS.md §2.5's "no typeahead network calls" trivially true here
// — there is no request to have avoided sending.
type Suggestion =
  | { kind: "city"; label: string; city: City }
  | { kind: "county"; label: string; county: County }
  // A real MN city/county name (from public/mn-places.json) this app
  // doesn't have ward data for — kept as its own suggestion kind (not
  // merged into "city"/"county" above) so it can render with a visibly
  // different label and, on commit, an honest "not covered" message
  // instead of a fabricated zoom-to-nothing.
  | { kind: "uncovered-place"; label: string; name: string; placeType: "city" | "county" }
  | { kind: "zip"; label: string; zip: string }
  | { kind: "street"; label: string; houseNumber: number; street: string; cityHint: City | null; zipHint: string | null };

const MAX_SUGGESTIONS = 8;

function buildSuggestions(rawQuery: string, index: AddressIndex | null, allPlaces: MnPlaces | null): Suggestion[] {
  const trimmed = rawQuery.trim();
  if (!trimmed) return [];
  const upper = trimmed.toUpperCase();
  const items: Suggestion[] = [];
  const coveredCities = new Set<string>(CITIES.map((c) => c.toUpperCase()));
  const coveredCounties = new Set<string>(COUNTIES.map((c) => c.toUpperCase()));

  for (const city of CITIES) {
    if (city.toUpperCase().startsWith(upper)) items.push({ kind: "city", label: city, city });
  }
  for (const county of COUNTIES) {
    if (`${county.toUpperCase()} COUNTY`.startsWith(upper) || county.toUpperCase().startsWith(upper)) {
      items.push({ kind: "county", label: `${county} County`, county });
    }
  }
  // The rest of Minnesota — every city/county this app doesn't map yet.
  // Listed after the covered matches above so an address this site can
  // actually resolve always outranks one it can only acknowledge.
  if (allPlaces) {
    for (const city of allPlaces.cities) {
      if (coveredCities.has(city.toUpperCase())) continue; // already suggested above
      if (city.toUpperCase().startsWith(upper)) {
        items.push({ kind: "uncovered-place", label: `${city} (not mapped yet)`, name: city, placeType: "city" });
      }
    }
    for (const county of allPlaces.counties) {
      if (coveredCounties.has(county.toUpperCase())) continue;
      if (`${county.toUpperCase()} COUNTY`.startsWith(upper) || county.toUpperCase().startsWith(upper)) {
        items.push({
          kind: "uncovered-place",
          label: `${county} County (not mapped yet)`,
          name: county,
          placeType: "county",
        });
      }
    }
  }
  if (index && /^\d{1,5}$/.test(trimmed)) {
    for (const zip of Object.keys(index.zips)) {
      if (zip.startsWith(trimmed)) items.push({ kind: "zip", label: zip, zip });
    }
  }
  if (index) {
    const parsed = parseQuery(trimmed, allPlaces);
    if (parsed.kind === "address") {
      for (const street of suggestStreets(index, parsed.street, MAX_SUGGESTIONS)) {
        items.push({
          kind: "street",
          label: `${parsed.houseNumber} ${street}`,
          houseNumber: parsed.houseNumber,
          street,
          cityHint: parsed.cityHint,
          zipHint: parsed.zipHint,
        });
      }
    }
  }
  return items.slice(0, MAX_SUGGESTIONS);
}

function wardLabel(ref: WardRef): string {
  return `${ref.city} Ward ${ref.ward}`;
}

export default function SearchBar({ index, allPlaces, onSelectWard, onSelectCity, onSelectCounty }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // The last *committed* (Enter/click, not merely typed) resolution.
  // Only ever non-null for outcomes that need to keep something visible
  // after commit — an ambiguous ward list to choose from, or a message
  // explaining why nothing happened. A clean "single" hit clears back to
  // null since the map/modal already shows the result.
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const listboxId = useId();

  const suggestions = useMemo(() => buildSuggestions(query, index, allPlaces), [query, index, allPlaces]);

  // Both "still typing" (suggestions) and "just committed an ambiguous
  // query" (a real ward list) render through the same listbox and the
  // same keyboard nav — they're the same UI surface with different
  // content, never two separate widgets to keep in sync.
  const options = useMemo(() => {
    if (outcome?.status === "ambiguous") {
      return outcome.wards.map((ref) => ({ label: wardLabel(ref), muted: false, commit: () => commitWard(ref) }));
    }
    // "muted" is a style hint only (dimmer text for a real MN place this
    // app doesn't map) — the "(not mapped yet)" text baked into the label
    // itself is what actually carries the meaning, per AGENTS.md's "color
    // is never the only signal."
    return suggestions.map((s) => ({ label: s.label, muted: s.kind === "uncovered-place", commit: () => commitSuggestion(s) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome, suggestions]);

  function applyOutcome(next: SearchOutcome) {
    switch (next.status) {
      case "single":
        onSelectWard(next.wards[0]);
        setStatusMessage(`Zoomed to ${wardLabel(next.wards[0])}.`);
        setOutcome(null);
        break;
      case "ambiguous":
        setOutcome(next);
        setStatusMessage(next.reason);
        break;
      case "city":
        onSelectCity(next.city);
        setStatusMessage(`Zoomed to ${next.city}'s wards — choose one on the map.`);
        setOutcome(null);
        break;
      case "county":
        onSelectCounty(next.county, next.cities);
        setStatusMessage(`Zoomed to ${next.county} County's mapped cities.`);
        setOutcome(null);
        break;
      case "not-covered":
      case "not-found":
        setOutcome(next);
        setStatusMessage(next.reason);
        break;
      case "unparseable":
        setOutcome(next);
        setStatusMessage("Type a street address, ZIP code, city, or county name.");
        break;
    }
    setIsOpen(next.status === "ambiguous");
    setActiveIndex(-1);
  }

  function commitWard(ref: WardRef) {
    applyOutcome({ status: "single", wards: [ref], point: null });
  }

  function commitSuggestion(s: Suggestion) {
    if (s.kind === "city") return applyOutcome({ status: "city", city: s.city });
    if (s.kind === "county") return applyOutcome({ status: "county", county: s.county, cities: COUNTY_CITIES[s.county] });
    if (s.kind === "uncovered-place") return applyOutcome(resolve(index, { kind: "uncovered-place", name: s.name, placeType: s.placeType }));
    if (s.kind === "zip") return applyOutcome(resolve(index, { kind: "zip", zip: s.zip }));
    return applyOutcome(
      resolve(index, { kind: "address", houseNumber: s.houseNumber, street: s.street, cityHint: s.cityHint, zipHint: s.zipHint }),
    );
  }

  function commitRawQuery() {
    applyOutcome(resolve(index, parseQuery(query, allPlaces)));
  }

  function handleChange(value: string) {
    setQuery(value);
    setOutcome(null); // stale relative to the new text — start over
    setActiveIndex(-1);
    setIsOpen(value.trim().length > 0);
    if (!value.trim()) setStatusMessage("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      if (options.length === 0) return;
      e.preventDefault();
      setIsOpen(true);
      setActiveIndex((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      if (options.length === 0) return;
      e.preventDefault();
      setIsOpen(true);
      setActiveIndex((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const active = isOpen ? options[activeIndex] : undefined;
      if (active) active.commit();
      else commitRawQuery();
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  }

  const activeOptionId = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;
  const showMessage = outcome && outcome.status !== "ambiguous" && outcome.status !== "single";

  return (
    <div className="w-[min(90vw,24rem)] rounded-lg bg-panel-2/90 backdrop-blur-sm border border-hair shadow-lg shadow-(color:--shadow-panel) p-2 font-sans text-sm">
      <CoverageNotice />
      <label htmlFor={`${listboxId}-input`} className="block px-1 pb-1 font-medium text-ink-2">
        Find your ward
      </label>
      <div className="relative">
        <input
          id={`${listboxId}-input`}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          autoComplete="off"
          placeholder="Address, city, county, or ZIP"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsOpen(query.trim().length > 0)}
          className="w-full rounded-md border border-hair-strong bg-panel-2 px-2.5 py-1.5 text-ink placeholder:text-ink-4 focus:outline-none focus:ring-2 focus:ring-accent"
        />
        {isOpen && options.length > 0 && (
          <ul id={listboxId} role="listbox" className="absolute left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto rounded-md border border-hair bg-panel-2 shadow-lg shadow-(color:--shadow-panel) z-10">
            {options.map((opt, i) => (
              <li
                key={`${opt.label}-${i}`}
                id={`${listboxId}-option-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => e.preventDefault()} // keep input focus so the click doesn't blur-then-lose the value
                onClick={() => opt.commit()}
                className={`cursor-pointer px-2.5 py-1.5 ${
                  i === activeIndex ? "bg-accent text-on-accent" : opt.muted ? "text-ink-4 hover:bg-hover" : "text-ink-2 hover:bg-hover"
                }`}
              >
                {opt.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* Announces the outcome without moving focus out of the input —
          the standard, less-disorienting combobox convention. Nothing
          rendered here is ever logged, persisted, or put in a URL: it's
          live component state that disappears on refresh, same as any
          ordinary search box's own input value. */}
      <p aria-live="polite" className="sr-only">
        {statusMessage}
      </p>
      {showMessage && <p className="px-1 pt-1.5 text-ink-3">{outcome && "reason" in outcome ? outcome.reason : statusMessage}</p>}
      <p className="px-1 pt-1.5 text-xs text-ink-4">
        Nothing you type here is sent anywhere — this box works entirely on your device.
        {!index && " (Address & ZIP search still loading — city and county work now.)"}
      </p>
    </div>
  );
}
