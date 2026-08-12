"use client";

// TurnoutYearSlider — the civic-participation-turnout choropleth's
// historical year picker. A sibling of ParticipationLegend (not folded
// into it) because it owns a genuinely different concern: which year's
// data file is loaded, versus how the currently-loaded year is drawn.
// Rendered by WardMap.tsx directly above ParticipationLegend whenever
// layerMode === "participation", same "swap what the filter column
// shows per mode" placement as ParticipationLegend/ParticipationRecordList
// themselves.
//
// AGENTS.md §1c: this control changes *which year's numbers are shown*,
// full stop. It renders each year as a plain, equally-weighted stop —
// no "earlier/later," no computed year-over-year delta, no highlighting
// of a "best" or "worst" year. Do not add one.
//
// AGENTS.md §4: a real, native <input type="range"> — draggable with a
// pointer and arrow-key-steppable natively, with no extra JS needed for
// the keyboard path. `aria-valuetext` overrides what a screen reader
// announces (the year itself, e.g. "2018") in place of the raw 0-based
// index the input's value actually holds, which on its own would
// announce as a meaningless position number.
import { yearAtIndex, indexOfYear, type TurnoutManifestYear } from "@/lib/turnoutYears";

export interface TurnoutYearSliderProps {
  variant: "floating" | "sidebar";
  years: readonly TurnoutManifestYear[];
  activeYear: string | null;
  loading: boolean;
  onChangeYear: (year: string) => void;
}

export default function TurnoutYearSlider({ variant, years, activeYear, loading, onChangeYear }: TurnoutYearSliderProps) {
  // Fewer than two years: there is nothing to slide between yet (today,
  // manifest.json lists only 2024). A native range input still draws a
  // full track and thumb even when min === max, which would promise a
  // year picker that does nothing when dragged or arrow-keyed — a worse
  // experience than no control at all, and a false affordance a screen
  // reader user would have no way to detect ahead of time. Hidden
  // entirely until a second year exists in the manifest; the single
  // year's own label already renders via ParticipationLegend's
  // electionHeading immediately below this, so no information is lost.
  // The moment the historical-backfill ingest adds more `years` entries,
  // this condition flips and the slider appears with zero code changes.
  if (years.length < 2) return null;

  const activeIndex = indexOfYear(years, activeYear);
  const activeLabel = years[activeIndex]?.year ?? "";
  const inputId = `turnout-year-slider-${variant}`;

  return (
    <div className="border-t border-hair pt-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          Election year
        </label>
        {/* role="status" + aria-live="polite", motion-safe:animate-spin —
            same loading-notice pattern WardMap.tsx's own
            secondaryDataNotice already uses (AGENTS.md §4
            prefers-reduced-motion). Nothing has gone wrong, so this
            never uses a stronger "alert" role. */}
        {loading && (
          <span role="status" aria-live="polite" className="flex items-center gap-1 text-[11px] text-ink-3">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3 shrink-0 motion-safe:animate-spin">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
              <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            Loading {activeLabel}&hellip;
          </span>
        )}
      </div>
      <input
        id={inputId}
        type="range"
        min={0}
        max={years.length - 1}
        step={1}
        value={activeIndex}
        disabled={loading}
        aria-valuetext={activeLabel}
        aria-label={`Election year, currently ${activeLabel}`}
        onChange={(e) => {
          const entry = yearAtIndex(years, Number(e.target.value));
          if (entry) onChangeYear(entry.year);
        }}
        className="w-full cursor-pointer accent-accent disabled:cursor-wait disabled:opacity-60"
      />
      {/* Tick labels — decorative alongside the input's own
          aria-valuetext (AGENTS.md §4 "Colour Is Never The Only
          Signal" reasoning applied here too: the current position is
          never conveyed by thumb placement alone, it's also spelled out
          as text). aria-hidden since the accessible name/value already
          carries this via the input above; a screen reader stepping the
          slider hears "Election year, currently 2018," not a duplicate
          reading of every tick. */}
      <div className="mt-1 flex justify-between text-[10px] text-ink-4" aria-hidden="true">
        {years.map((y) => (
          <span key={y.year} className={y.year === activeLabel ? "font-semibold text-ink-3" : undefined}>
            {y.year}
          </span>
        ))}
      </div>
    </div>
  );
}
