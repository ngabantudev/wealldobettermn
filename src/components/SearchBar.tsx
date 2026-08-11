"use client";

import { Check, Copy, Search, Vote } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { AddressGazetteerManifest, AddressIndex, MnPlaces, WardRef } from "@/lib/types";
import { CITIES, COUNTIES, COUNTY_CITIES, type City, type County } from "@/lib/cities";
import { fold, parseQuery, resolve, suggestStreetsForHouseNumber, type SearchOutcome } from "@/lib/addressSearch";
import { suggestStreetNamesFromManifest } from "@/lib/addressGazetteer";
import { useAddressChunkLoader } from "@/lib/addressChunks";
import CoverageNotice from "./CoverageNotice";

interface SearchBarProps {
  // null while public/address-index/manifest.json is still being fetched
  // — see WardMap.tsx's map-independent effect for why this can't just
  // block the whole component (Part 4: search must work even if the map
  // never finishes loading, and it shouldn't have to wait for the
  // gazetteer to let someone search a city or county in the meantime
  // either). Per issue #70, this is the small manifest only — the actual
  // per-county street/geometry chunks are fetched lazily from inside this
  // component (see useAddressChunkLoader below), only for whichever
  // chunk(s) a committed query needs.
  manifest: AddressGazetteerManifest | null;
  // null while public/mn-places.json is still being fetched. Every MN
  // city/county this app actually covers (CITIES/COUNTIES below) works
  // immediately regardless — this only widens suggestions/recognition to
  // the rest of the state (AGENTS.md §3.3 Coverage Honesty; see
  // addressSearch.ts's "uncovered-place" kind).
  allPlaces: MnPlaces | null;
  // `point` is the on-device-interpolated address location (see
  // addressSearch.ts's `interpolateAlongLine`) when the search resolved
  // from a house number, or null for a bare ward pick — WardMap falls
  // back to the ward's own bounds-center in that case, same as it always
  // has for pin placement elsewhere in this file.
  onSelectWard: (ref: WardRef, point: [number, number] | null) => void;
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

function buildSuggestions(
  rawQuery: string,
  manifest: AddressGazetteerManifest | null,
  index: AddressIndex | null,
  allPlaces: MnPlaces | null,
): Suggestion[] {
  const trimmed = rawQuery.trim();
  if (!trimmed) return [];
  const upper = trimmed.toUpperCase();
  // fold() (addressSearch.ts) folds "SAINT" and "ST"/"ST." to the same
  // "ST" token, so prefix-matching the folded forms lets "Saint" find
  // "St. Paul" and "St" find "Saint Paul" — both spellings are correct
  // without growing CITIES/COUNTIES into a spelling table. Plain
  // upper.startsWith below is kept alongside this so a mid-word prefix
  // like "St. P" (not a whole "SAINT"/"ST" token) still matches the way
  // it always has.
  const foldedQuery = fold(trimmed);
  const items: Suggestion[] = [];
  const coveredCities = new Set<string>(CITIES.map((c) => c.toUpperCase()));
  const coveredCounties = new Set<string>(COUNTIES.map((c) => c.toUpperCase()));
  const matchesName = (name: string) => name.toUpperCase().startsWith(upper) || fold(name).startsWith(foldedQuery);

  for (const city of CITIES) {
    if (matchesName(city)) items.push({ kind: "city", label: city, city });
  }
  for (const county of COUNTIES) {
    if (matchesName(`${county} County`) || matchesName(county)) {
      items.push({ kind: "county", label: `${county} County`, county });
    }
  }
  // The rest of Minnesota — every city/county this app doesn't map yet.
  // Listed after the covered matches above so an address this site can
  // actually resolve always outranks one it can only acknowledge.
  if (allPlaces) {
    for (const city of allPlaces.cities) {
      if (coveredCities.has(city.toUpperCase())) continue; // already suggested above
      if (matchesName(city)) {
        items.push({ kind: "uncovered-place", label: `${city} (not mapped yet)`, name: city, placeType: "city" });
      }
    }
    for (const county of allPlaces.counties) {
      if (coveredCounties.has(county.toUpperCase())) continue;
      if (matchesName(`${county} County`) || matchesName(county)) {
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
  if (manifest) {
    const parsed = parseQuery(trimmed, allPlaces);
    if (parsed.kind === "address") {
      // No street text yet — just typed the house number — suggest which
      // *real* streets carry that number, instead of nothing. Once a
      // resident starts typing the street, prefix-match against it like
      // before; house-number-only matching would stop narrowing further
      // at that point and start showing streets that don't fit what
      // they've typed.
      //
      // The street-text branch reads the manifest's full street-name
      // universe (suggestStreetNamesFromManifest — see
      // addressGazetteer.ts), not whichever chunk(s) happen to be loaded,
      // so this keeps working
      // for a street in a county the resident hasn't triggered a fetch
      // for yet. The house-number-only branch has no equivalent: knowing
      // which streets carry a given house number needs the edge data
      // itself, so it's necessarily limited to chunk(s) already loaded
      // (index.streets) — it shows nothing extra until the resident has
      // typed enough of a street name, or a county chunk, to load one.
      // Documented tradeoff (issue #70's PR), not a bug: this only
      // affects the transient "typed digits, nothing else yet" moment,
      // never resolution of an actual committed address.
      const streetSuggestions = parsed.street
        ? suggestStreetNamesFromManifest(manifest, parsed.street, MAX_SUGGESTIONS)
        : index
          ? suggestStreetsForHouseNumber(index, parsed.houseNumber, MAX_SUGGESTIONS)
          : [];
      for (const street of streetSuggestions) {
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

// Where "find your polling place" actually points. There is no bulk,
// build-time-fetchable, primary-source dataset of MN polling-place
// locations this app could ingest and pin itself — the Secretary of
// State's own list is a paid, manually-ordered, per-election PDF/text
// extract (not a script-fetchable API or bulk file), and polling places
// aren't a stable year-round fact the way ward boundaries are (they move
// per election cycle, and MN statute allows one to sit outside its own
// precinct). Per AGENTS.md §3.1 ("no placeholder data ships as fact"),
// this links out to the Secretary of State's own live lookup tool instead
// of fabricating or hand-scraping a location — same treatment the deleted
// hearings mock got. The user's resolved address is never appended to
// this URL or sent anywhere by this app; they re-enter it on the SoS's own
// site if they choose to click through, same as any other outbound link.
const POLLING_PLACE_FINDER_URL = "https://pollfinder.sos.mn.gov/";

// Shared by every overlay panel below the input (the suggestions listbox,
// the outcome message, the loading notice) — opens upward by default,
// downward at sm+. This input only ever sits at the top of the screen
// (SiteHeader, desktop) or right above MobileBottomNav's nav bar
// (SiteHeader's Search MobileSheet, mobile); a downward-opening panel from
// the second position has nowhere to go but on top of the nav bar itself.
// Same flip CoverageNotice's own popover uses, for the same reason.
const OVERLAY_POSITION_CLASSES = "absolute left-0 right-0 bottom-full z-10 mb-2 sm:bottom-auto sm:top-full sm:mb-0 sm:mt-2";

export default function SearchBar({ manifest, allPlaces, onSelectWard, onSelectCity, onSelectCounty }: SearchBarProps) {
  // Per issue #70: `manifest` (public/address-index/manifest.json) is
  // small and always fetched by WardMap.tsx up front. The actual
  // per-county street/geometry chunks (public/address-index/<key>.json)
  // are only ever fetched lazily, from inside this hook, and only for
  // the chunk(s) a *committed* query needs — never on a keystroke. See
  // src/lib/addressChunks.ts's own file comment for the full design.
  const { index, isLoadingChunk, ensureStreetChunksLoaded } = useAddressChunkLoader(manifest);
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
  // True only right after a *real address* resolves — a "single" outcome
  // whose SearchOutcome carries a non-null interpolated point (see
  // addressSearch.ts). Never set for a bare ward pick off the ambiguous
  // list (commitWard always passes point: null — there was no house
  // number to interpolate from) or for a city/county/ZIP-level result:
  // per this feature's own spec, the polling-place link is only for a
  // searchable, valid address, not any search that happens to resolve to
  // a ward. Cleared on every other outcome and on any further typing.
  const [showPollingPlaceLink, setShowPollingPlaceLink] = useState(false);
  // True for a couple seconds right after a successful copy — swaps the
  // copy icon for a checkmark and shows the "Copied!" pop, then reverts on
  // its own. Not tied to showPollingPlaceLink/outcome state at all: typing
  // further after a copy shouldn't yank the confirmation away mid-read the
  // way it clears the polling-place link (a stale confirmation that a
  // *previous* address got copied is harmless; it just times out).
  const [justCopied, setJustCopied] = useState(false);
  const listboxId = useId();

  const suggestions = useMemo(
    () => buildSuggestions(query, manifest, index, allPlaces),
    [query, manifest, index, allPlaces],
  );

  // Both "still typing" (suggestions) and "just committed an ambiguous
  // query" (a real ward list) render through the same listbox and the
  // same keyboard nav — they're the same UI surface with different
  // content, never two separate widgets to keep in sync.
  const options = useMemo(() => {
    if (outcome?.status === "ambiguous") {
      return outcome.wards.map((ref) => ({ label: wardLabel(ref), muted: false, commit: () => commitWard(ref) }));
    }
    if (outcome?.status === "ambiguous-name") {
      const { city, county } = outcome;
      return [
        { label: `${city} (city)`, muted: false, commit: () => applyOutcome({ status: "city", city }) },
        {
          label: `${county} County`,
          muted: false,
          commit: () => applyOutcome({ status: "county", county, cities: COUNTY_CITIES[county] }),
        },
      ];
    }
    // "muted" is a style hint only (dimmer text for a real MN place this
    // app doesn't map) — the "(not mapped yet)" text baked into the label
    // itself is what actually carries the meaning, per AGENTS.md's "color
    // is never the only signal."
    return suggestions.map((s) => ({ label: s.label, muted: s.kind === "uncovered-place", commit: () => commitSuggestion(s) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome, suggestions]);

  function applyOutcome(next: SearchOutcome) {
    // Reset here, not per-branch — every branch below except a
    // point-bearing "single" result should end with this false, and
    // putting the one true-setting line inside its own branch instead of
    // repeating `setShowPollingPlaceLink(false)` in the other six is what
    // actually guarantees that.
    setShowPollingPlaceLink(false);
    switch (next.status) {
      case "single": {
        // A real address match (house-number resolution) carries its own
        // canonical `formattedAddress` — "931 BIRMINGHAM ST" (see
        // addressSearch.ts's formatConfirmedAddress) — built from the
        // matched street/house-number data itself, not from
        // whatever casing or shorthand the resident happened to type. That
        // keeps showing/copying/announcing exactly the same string no
        // matter whether they typed the full address, a partial one, or
        // clicked a suggestion. A ward picked off the ambiguous list, or a
        // ZIP-only match, has no single address behind it (point and
        // formattedAddress are null together, always), so those fall back
        // to the ward's own canonical label instead, same as before.
        const isRealAddress = next.point !== null && next.formattedAddress !== null;
        const displayText = isRealAddress ? next.formattedAddress! : wardLabel(next.wards[0]);
        setQuery(displayText);
        onSelectWard(next.wards[0], next.point);
        setOutcome(null);
        // Only a real interpolated address point counts as "the user
        // entered a searchable, valid address" — see this state's own
        // comment above.
        setShowPollingPlaceLink(isRealAddress);
        if (isRealAddress) {
          // Copying happens right here, synchronously inside this commit
          // handler (a real Enter keypress or suggestion click) rather
          // than from some later effect — the Clipboard API only grants a
          // write without its own permission prompt when called inside a
          // genuine user-activation event, and this is that event. Nothing
          // is written on mere typing, only on an actual confirmed
          // address, same gate as everywhere else this file uses
          // showPollingPlaceLink/isRealAddress.
          copyToClipboard(displayText);
          setStatusMessage(`Zoomed to ${wardLabel(next.wards[0])}. Address copied to clipboard.`);
        } else {
          setStatusMessage(`Zoomed to ${wardLabel(next.wards[0])}.`);
        }
        break;
      }
      case "ambiguous":
        setOutcome(next);
        setStatusMessage(next.reason);
        break;
      case "city":
        setQuery(next.city);
        onSelectCity(next.city);
        setStatusMessage(`Zoomed to ${next.city}'s wards — choose one on the map.`);
        setOutcome(null);
        break;
      case "county":
        setQuery(`${next.county} County`);
        onSelectCounty(next.county, next.cities);
        setStatusMessage(`Zoomed to ${next.county} County's mapped cities.`);
        setOutcome(null);
        break;
      case "ambiguous-name":
        setOutcome(next);
        setStatusMessage(`"${next.city}" is both a city and a county here — pick which one you meant.`);
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
    setIsOpen(next.status === "ambiguous" || next.status === "ambiguous-name");
    setActiveIndex(-1);
  }

  function commitWard(ref: WardRef) {
    applyOutcome({ status: "single", wards: [ref], point: null, formattedAddress: null });
  }

  // Both commit paths below are async now, per issue #70: a street-shaped
  // query only resolves once the chunk(s) that carry it (per the
  // manifest's own streetChunks map — see addressChunks.ts) have loaded.
  // Every other outcome kind (city/county/zip/ambiguous-name/uncovered-
  // place) never touches a chunk at all — zips live in the always-loaded
  // manifest, and city/county resolution never needed the gazetteer in
  // the first place — so those still resolve synchronously, same as
  // before. `ensureStreetChunksLoaded` itself only ever fetches on a
  // commit like this one, never on a keystroke (see handleChange/
  // suggestions above, which never call it).
  // Closes the listbox and clears any stale outcome right before an async
  // chunk fetch starts, so the "loading this street's data" overlay below
  // (keyed off isLoadingChunk) has a slot to render into instead of
  // stacking under the still-open suggestion list or a leftover message.
  function beginChunkLoad() {
    setIsOpen(false);
    setOutcome(null);
    setActiveIndex(-1);
  }

  async function commitSuggestion(s: Suggestion) {
    if (s.kind === "city") return applyOutcome({ status: "city", city: s.city });
    if (s.kind === "county") return applyOutcome({ status: "county", county: s.county, cities: COUNTY_CITIES[s.county] });
    if (s.kind === "uncovered-place") return applyOutcome(resolve(index, { kind: "uncovered-place", name: s.name, placeType: s.placeType }));
    if (s.kind === "zip") return applyOutcome(resolve(index, { kind: "zip", zip: s.zip }));
    beginChunkLoad();
    const loaded = await ensureStreetChunksLoaded(s.street);
    return applyOutcome(
      resolve(loaded, { kind: "address", houseNumber: s.houseNumber, street: s.street, cityHint: s.cityHint, zipHint: s.zipHint }),
    );
  }

  async function commitRawQuery() {
    const parsed = parseQuery(query, allPlaces);
    if (parsed.kind === "address" && parsed.street) {
      beginChunkLoad();
      const loaded = await ensureStreetChunksLoaded(parsed.street);
      return applyOutcome(resolve(loaded, parsed));
    }
    return applyOutcome(resolve(index, parsed));
  }

  function handleChange(value: string) {
    setQuery(value);
    setOutcome(null); // stale relative to the new text — start over
    setShowPollingPlaceLink(false); // same reasoning — last result's address no longer matches what's in the box
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

  // Shared by the automatic copy-on-confirm (applyOutcome's "single"
  // branch above) and the manual copy button below — one place that
  // actually writes to the clipboard, so both call sites stay identical in
  // behavior (same success/failure handling, same "Copied!" pop). This is
  // the only thing that ever leaves this component for a searched address,
  // and it only ever writes to the user's own local clipboard — nothing is
  // logged, stored, or put in a URL, same as every other rule this file
  // already follows for the query string.
  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setJustCopied(true);
      window.setTimeout(() => setJustCopied(false), 1800);
    } catch {
      // Clipboard permission denied, or the API isn't available in this
      // browser/context — no crash, and no false "Copied!" claim either;
      // justCopied simply never flips true.
    }
  }

  // The manual button's own handler — guarded on showPollingPlaceLink,
  // same gate the automatic copy above uses: both only make sense once
  // there's a real, confirmed address in the box. Mostly useful for
  // re-copying after the automatic pop has already timed out, or after
  // navigating back to an already-resolved search.
  function handleCopyAddress() {
    if (!showPollingPlaceLink) return;
    copyToClipboard(query);
  }

  const activeOptionId = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;
  const showMessage = outcome && outcome.status !== "ambiguous" && outcome.status !== "ambiguous-name" && outcome.status !== "single";
  // The address/ZIP gazetteer *manifest* is small (tens of KB — see
  // WardMap.tsx) and fetched separately from everything else SearchBar can
  // already do without it — city and county search work immediately
  // regardless (see manifest's own prop comment). Rather than a separate
  // "still loading" line taking up its own row underneath the input (which
  // used to happen here, and is exactly the kind of extra height
  // SiteHeader can't afford — see this component's own file comment on why
  // it's a single fixed-height row now), the placeholder itself just says
  // so until the fetch resolves, then reverts to the normal prompt. One
  // line of text either way, never both.
  //
  // Per issue #70, this now gates on `manifest`, not the old full `index`:
  // the manifest alone is enough to search city/ZIP and offer street-name
  // typeahead (see buildSuggestions/suggestStreetNamesFromManifest above).
  // A committed street-address query separately awaits its own chunk
  // fetch (see commitRawQuery/commitSuggestion) — surfaced below via
  // `isLoadingChunk`, not the placeholder, since that's a brief, per-query
  // wait rather than a one-time startup cost.
  const placeholder = manifest ? "Address, city, county, or ZIP" : "Loading address & ZIP search — city, county work now";

  return (
    // No more fixed `w-[min(90vw,24rem)]` — sized off its container
    // instead (full width up to a cap), so it adapts to whatever's
    // actually available: the topbar's flexible middle slot on desktop
    // (SiteHeader), or the nearly-full-width sheet slot on mobile
    // (MobileSheet), rather than a viewport-relative guess that ignores
    // either. The `.well` recessed-surface treatment (see globals.css's
    // own comment on that token) is what gives this its Minnesota-flag
    // coloring for free: Night Sky Blue darkened a step further than the
    // topbar's own field when this renders inside `.band` (the header),
    // white/neutral like any other elevated card when it doesn't (the
    // mobile sheet) — no separate light/dark or band/non-band classes to
    // maintain here, same mechanism as every other themed surface in this
    // app.
    <div className="w-full max-w-md font-sans text-sm">
      <label htmlFor={`${listboxId}-input`} className="sr-only">
        Find your ward
      </label>
      {/* The recessed input ("well") plus its two icon-button companions
          (copy address, coverage disclosure) as one row — split out of a
          single `well` wrapper so those two buttons sit *outside* the
          recessed surface rather than inside it, but still on the same
          fixed-height line SiteHeader depends on (see this file's own
          earlier comment on why nothing here is allowed to add height). */}
      <div className="flex items-center gap-1.5">
        <div className="well relative flex flex-1 items-center gap-1.5 rounded-xl border px-2.5 py-1.5">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
          <input
            id={`${listboxId}-input`}
            type="text"
            role="combobox"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
            autoComplete="off"
            placeholder={placeholder}
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsOpen(query.trim().length > 0)}
            className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-4 focus:outline-none"
          />

          {/* Polling-place finder — an icon inside the search bar itself,
              not a separate overlay panel, so it reads as one of this
              row's own controls. Only rendered at all once a real address
              is confirmed (see showPollingPlaceLink's own comment) — per
              this feature's own spec, it must not appear otherwise, so
              this is a conditional render, not a disabled state the way
              the copy button below uses. `group`/`focus-within` reveal the
              tooltip on hover *or* keyboard focus, no click needed to see
              what it is; the link itself still needs an explicit click/
              Enter to actually navigate. Links out to the Secretary of
              State's own tool rather than a pin on this map's own layer —
              see POLLING_PLACE_FINDER_URL's comment for why there's no
              first-party data to place a pin from. */}
          {showPollingPlaceLink && (
            <div className="group relative shrink-0">
              <a
                href={POLLING_PLACE_FINDER_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Find your polling place — Minnesota Secretary of State"
                className="flex h-6 w-6 items-center justify-center rounded-full text-accent transition hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Vote aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
              </a>
              <span
                role="tooltip"
                className="well pointer-events-none absolute right-0 bottom-full z-20 mb-2 hidden w-44 rounded-lg border px-2.5 py-1.5 text-xs text-ink-2 shadow-xl shadow-(color:--shadow-panel) group-hover:block group-focus-within:block sm:bottom-auto sm:top-full sm:mb-0 sm:mt-2"
              >
                Find your polling place — Minnesota Secretary of State
              </span>
            </div>
          )}

          {isOpen && options.length > 0 && (
            <ul
              id={listboxId}
              role="listbox"
              className={`well ${OVERLAY_POSITION_CLASSES} max-h-64 overflow-y-auto rounded-xl border shadow-xl shadow-(color:--shadow-panel)`}
            >
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

          {/* Outcome message (not-covered / not-found / unparseable) — an
              overlay below the input rather than a line of normal-flow text
              underneath it, same reasoning as the listbox above: nothing
              here should be able to change this row's own height, which is
              what lets SiteHeader treat the search bar as a fixed-height
              toolbar control instead of one that can grow the whole topbar
              taller mid-search. */}
          {showMessage && (
            <p className={`well ${OVERLAY_POSITION_CLASSES} rounded-xl border px-2.5 py-1.5 text-ink-3 shadow-xl shadow-(color:--shadow-panel)`}>
              {outcome && "reason" in outcome ? outcome.reason : statusMessage}
            </p>
          )}

          {/* Per issue #70: a committed street-address query only resolves
              once its chunk(s) have loaded (see commitRawQuery/
              commitSuggestion's ensureStreetChunksLoaded call) — this is
              the brief "fetching this area's data" state for that gap.
              beginChunkLoad() closes the listbox and clears `outcome`
              right before the fetch starts, so this never renders at the
              same time as the suggestion list or an outcome message above.
              Never shown for a cached chunk (ensureStreetChunksLoaded
              resolves before isLoadingChunk ever flips true) or for any
              non-address outcome (zip/city/county never touch a chunk). */}
          {isLoadingChunk && !showMessage && (
            <p
              role="status"
              className={`well ${OVERLAY_POSITION_CLASSES} rounded-xl border px-2.5 py-1.5 text-ink-3 shadow-xl shadow-(color:--shadow-panel)`}
            >
              Loading address data for this area…
            </p>
          )}

        </div>

        {/* Copy-the-confirmed-address button — sits in the row slot the
            coverage-info icon used to occupy alone; that icon now lives
            just to the right of this one instead of being removed (see
            CoverageNotice's own file comment on why AGENTS.md §3.3 needs
            it reachable everywhere this search bar renders). Disabled
            (not hidden) when there's nothing confirmed to copy yet, so the
            row's width never jumps as a search resolves. */}
        <div className="relative shrink-0">
          <button
            type="button"
            disabled={!showPollingPlaceLink}
            aria-label={justCopied ? "Address copied to clipboard" : "Copy confirmed address"}
            onClick={handleCopyAddress}
            className={`flex h-6 w-6 items-center justify-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              showPollingPlaceLink
                ? "text-ink-3 hover:bg-hover hover:text-ink"
                : "cursor-not-allowed text-ink-4 opacity-50"
            }`}
          >
            {justCopied ? (
              <Check aria-hidden="true" className="h-4 w-4 text-positive" strokeWidth={2} />
            ) : (
              <Copy aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
            )}
          </button>
          {/* The "pop" itself — to the right of the icon, vertically
              centered on it, rather than above: this button sits right at
              the top of the screen in the desktop header, so an
              above-opening pop had nowhere to go and got clipped by the
              viewport edge. Auto-dismisses via justCopied's own timeout
              above, no click-away handling needed since nothing about it
              is interactive. */}
          {justCopied && (
            <span
              role="status"
              className="well absolute left-full top-1/2 z-20 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-positive/40 bg-positive px-2 py-1 text-xs font-medium text-on-accent shadow-lg"
            >
              Copied!
            </span>
          )}
        </div>

        {/* The "what this map can't see" disclosure — see CoverageNotice's
            own file comment for why it's icon/popover-only, not an
            always-visible sentence. */}
        <CoverageNotice />
      </div>
      {/* Announces the outcome without moving focus out of the input —
          the standard, less-disorienting combobox convention. Nothing
          rendered here is ever logged, persisted, or put in a URL: it's
          live component state that disappears on refresh, same as any
          ordinary search box's own input value. */}
      <p aria-live="polite" className="sr-only">
        {statusMessage}
      </p>
    </div>
  );
}
