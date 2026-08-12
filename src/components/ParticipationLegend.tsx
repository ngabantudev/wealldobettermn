"use client";

// ParticipationLegend — the civic-participation-turnout choropleth's
// legend, rendered by WardMap.tsx in place of AreaFilterList/
// ChamberToggleButtons whenever layerMode === "participation" (same
// "swap what the filter column shows per mode" pattern those two already
// establish — see WardMap.tsx's own sidebarFilterControls/filterControls).
//
// AGENTS.md §4 "Colour Is Never The Only Signal": every swatch below
// pairs its color with a plain-language label and a numeric range, not
// color alone. §0.9: CVAP and "registered voter" are glossed inline via
// the shared Gloss mechanism (src/lib/glossary.ts / Gloss.tsx) rather
// than left as unexplained jargon.
import Gloss from "./Gloss";
import { touchTargetClass } from "@/lib/variantClasses";
import { TURNOUT_COLOR_STOPS, BELOW_THRESHOLD_COLOR, NO_MATCH_COLOR, TOWNSHIP_UNORG_BASE_COLOR } from "@/lib/turnoutColors";

export interface ParticipationLegendProps {
  variant: "floating" | "sidebar";
  // "2024 General Election" — built by WardMap.tsx's formatElectionHeading
  // from public/turnout/manifest.json's own years[].year/electionType,
  // never hardcoded here. null only while the manifest fetch hasn't
  // resolved yet (or failed) — see EMPTY_TURNOUT_STATE in WardMap.tsx.
  electionHeading: string | null;
  denominatorNote: string;
  populationWeighted: boolean;
  onTogglePopulationWeighted: () => void;
}

function SwatchRow({ color, label, hatched }: { color: string; label: string; hatched?: boolean }) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-xs text-ink-2">
      <span
        aria-hidden="true"
        className="h-3 w-4 shrink-0 rounded-sm border border-hair"
        style={{
          backgroundColor: color,
          backgroundImage: hatched
            ? "repeating-linear-gradient(45deg, rgba(0,0,0,0.35) 0, rgba(0,0,0,0.35) 1px, transparent 1px, transparent 4px)"
            : undefined,
        }}
      />
      <span>{label}</span>
    </div>
  );
}

export default function ParticipationLegend({
  variant,
  electionHeading,
  denominatorNote,
  populationWeighted,
  onTogglePopulationWeighted,
}: ParticipationLegendProps) {
  const boxClass =
    variant === "floating"
      ? "rounded-lg bg-panel-2/90 backdrop-blur-sm border border-hair shadow-lg shadow-(color:--shadow-panel) p-3 text-sm text-ink-2 space-y-3"
      : "border-t border-hair pt-3 text-sm text-ink-2 space-y-3";

  return (
    <div className={boxClass}>
      {/* Which election this choropleth shades — previously the "2024"
          appeared nowhere except the prior-art citation links at the
          bottom of this component. Forward-compatible with a future
          multi-year slider: electionHeading is always derived from
          whichever year is currently active (WardMap.tsx's
          turnoutActiveYear state), never a hardcoded string. */}
      {electionHeading && <p className="text-sm font-semibold text-ink">{electionHeading}</p>}

      {/* Plain-language metric definition, verbatim from
          public/turnout/manifest.json's own denominatorMethodologyNote —
          never re-worded here, so the map's own legend text can't
          quietly drift from what the ingest script's methodology
          actually says (AGENTS.md §2.2/§3.3). */}
      <p className="text-xs leading-relaxed text-ink-3">{denominatorNote}</p>

      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          Ballots cast &divide; <Gloss term="registered-voter">registered voters</Gloss>
        </p>
        {TURNOUT_COLOR_STOPS.map((stop) => (
          <SwatchRow key={stop.label} color={stop.color} label={stop.label} />
        ))}
      </div>

      <div className="space-y-0.5 border-t border-hair pt-2">
        <SwatchRow color={BELOW_THRESHOLD_COLOR} label="Too small to shade reliably (fewer than 200 registered voters)" />
        <SwatchRow color={NO_MATCH_COLOR} label="No turnout record found for this city" />
        <SwatchRow color={TOWNSHIP_UNORG_BASE_COLOR} hatched label="No city government here — county and state layers apply" />
      </div>

      <div className="border-t border-hair pt-2">
        <label className="flex items-center gap-2 text-xs text-ink-2">
          <input
            type="checkbox"
            checked={populationWeighted}
            onChange={onTogglePopulationWeighted}
            className={`cursor-pointer accent-accent ${touchTargetClass(20)}`}
          />
          Size by population, not just area
        </label>
        <p className="mt-1 text-[11px] text-ink-3">
          A big city with low turnout can look small on a plain map next to many tiny high-turnout cities. This shows
          each city as a circle sized by population instead, colored the same way.
        </p>
      </div>

      {/* Prior-art callout — AGENTS.md §1c: factual, bylined, crediting
          sources, not a data claim of this site's own. Both URLs
          confirmed live before this shipped (see the PR that added this
          file for how) — the MN SOS site sits behind that agency's own
          bot-challenge (Radware) for automated fetchers, which is why an
          automated re-check here would fail even though the page is
          real and indexed. */}
      <div className="border-t border-hair pt-2 text-[11px] leading-relaxed text-ink-3">
        <p className="mb-1 font-semibold uppercase tracking-wide text-ink-4">Other places to see this</p>
        <p>
          Minneapolis publishes its own precinct-level turnout dashboard:{" "}
          <a
            href="https://vote.minneapolismn.gov/results-data/turnout/2024-general-interactive-data/"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-ink-2"
          >
            2024 General Election Interactive Data
          </a>
          . The Minnesota Secretary of State publishes statewide and county-level turnout statistics and maps:{" "}
          <a
            href="https://www.sos.mn.gov/elections-voting/election-results/2024/2024-general-election-results/2024-election-statistics-maps/"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-ink-2"
          >
            2024 Election Statistics Maps
          </a>
          .
        </p>
        <p className="mt-1 italic text-ink-4">— We All Do Better editorial note. Links reviewed by a maintainer; not generated from this page&apos;s own data.</p>
      </div>
    </div>
  );
}
