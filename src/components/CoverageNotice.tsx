"use client";

// The implementation of AGENTS.md §3.3's "What this map can't see" —
// rendered inside SearchBar (see its own render, underneath the search
// box) so it's close at hand the moment a resident is about to search for
// themselves, not a footnote they'd have to go looking for. A one-line
// summary is always visible and unmissable; the per-layer detail is one
// keypress/click away, not buried further than that.
//
// Every fact below comes from src/lib/coverage.ts, not retyped here, so
// this component can't quietly say something the data no longer backs up.

import { useId, useState } from "react";
import { COMMISSIONER_COUNTIES, NOT_COVERED_ANYWHERE, STATE_LEGISLATURE_NOTE, WARD_CITIES } from "@/lib/coverage";

export default function CoverageNotice() {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();

  return (
    <div className="border-t border-hair pt-1.5 mt-1.5 text-xs text-ink-3">
      <p className="px-1">
        Full rep data covers <strong className="font-semibold">{WARD_CITIES.length} Twin Cities-area cities</strong>{" "}
        — not the whole metro, and not the rest of Minnesota.{" "}
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailId}
          onClick={() => setExpanded((e) => !e)}
          className="font-medium text-accent underline decoration-dotted underline-offset-2 hover:text-accent-hover"
        >
          {expanded ? "Hide coverage" : "See what's covered"}
        </button>
      </p>
      {expanded && (
        // Capped height + internal scroll + keyboard-focusable, same
        // reasoning as WardMap.tsx's own city-filter list: SearchBar is a
        // fixed/bottom-docked card on mobile with nothing to push it out
        // of the way, so uncapped content here grows the whole card tall
        // enough to clip its own "nothing is sent anywhere" line off the
        // bottom of the viewport and collide with the top-left filter
        // stack above it. tabIndex makes it reachable by keyboard, not
        // just touch/wheel scroll — the content itself stays fully
        // present in the DOM either way, so a screen reader gets all of
        // it regardless of what's visually scrolled off.
        <div
          id={detailId}
          tabIndex={0}
          className="mt-1.5 px-1 space-y-1.5 text-ink-3 max-h-40 overflow-y-auto"
        >
          <p>
            <span className="font-medium text-ink-2">City council &amp; mayor</span> — {WARD_CITIES.join(", ")}.
          </p>
          <p>
            <span className="font-medium text-ink-2">County commissioner</span> — {COMMISSIONER_COUNTIES.join(" & ")} counties
            only.
          </p>
          <p>
            <span className="font-medium text-ink-2">State legislature</span> — {STATE_LEGISLATURE_NOTE}
          </p>
          <p>
            <span className="font-medium text-ink-2">Not covered anywhere yet</span> — {NOT_COVERED_ANYWHERE.join("; ")}.
          </p>
          <p>Search still recognizes any Minnesota city or county by name — it will just say honestly when we do not have it yet.</p>
        </div>
      )}
    </div>
  );
}
