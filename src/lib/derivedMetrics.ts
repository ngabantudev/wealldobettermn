// src/lib/derivedMetrics.ts
//
// Shapes for derived/inferred metrics — attendance rate, vote-with-
// majority, and similar numbers computed from underlying primary-source
// rows rather than stated directly by any one of them. FEATURES.md Phase
// 8: "These are inferences — label them, show the method, and let people
// see the underlying rows." AGENTS.md §1c (assertion discipline) forbids
// a computed field that implies causation between two facts (e.g. a vote
// and a contribution); a metric like attendance rate doesn't cross that
// line on its own, but it's still a number this site computed rather than
// read off a document, and every such number needs the same discipline
// §3.1 applies to synthetic data: an unmissable, structural label, not a
// footnote a maintainer can forget to add.
//
// `method` and `isInference` are required fields on the base interface,
// not optional ones — nothing implementing DerivedMetric can be
// constructed without stating how it was computed, and no rendering code
// can treat isInference as a maybe. UI components that render a
// DerivedMetric must show `method` inline alongside the value; hiding it
// behind a tooltip or "learn more" link defeats the point the same way a
// dismissible label would for synthetic hearing data (§3.1).
export interface DerivedMetric {
  readonly isInference: true;
  // Human-readable description of exactly how `value` was computed —
  // e.g. "Meetings attended ÷ meetings held, 2023–2025 sessions, per
  // Minneapolis LIMS CouncilMeetingAttendance records." Specific enough
  // that a reader could redo the arithmetic by hand from the linked
  // underlying rows.
  method: string;
  value: number;
  unit: "percent" | "count" | "ratio";
  // Where the underlying primary-source rows this was computed from live
  // — required per AGENTS.md §0.2 ("receipts, not rhetoric"). Null only
  // when no stable per-row source exists yet; a metric can't ship with
  // both this and method missing.
  underlyingRecordsUrl: string | null;
  computedAt: string; // ISO — when this metric was last (re)computed
}

// Meetings attended ÷ meetings the body held, over some stated window
// (encode the window in `method`, not as a separate untyped field, so it
// can't drift out of sync with the prose description of how the number
// was made).
export interface AttendanceRateMetric extends DerivedMetric {
  unit: "percent";
  meetingsAttended: number;
  meetingsHeld: number;
}

// Share of this officeholder's own recorded votes that matched the
// majority outcome of the same vote event. Mirrors the existing
// partyUnityPercent computation in types.ts/fetch-state-legislature.mjs,
// generalized to any body with recorded roll calls — not itself an
// assertion about *why* a member voted with the majority, per §1c.
export interface VoteWithMajorityMetric extends DerivedMetric {
  unit: "percent";
  votesWithMajority: number;
  totalRecordedVotes: number;
}

// Narrows a DerivedMetric so JSX can require its `method` be shown
// wherever `value` is shown, without every call site re-deriving the same
// check. Not a substitute for isInference being non-optional on the type
// above — this is a runtime helper for render code, not the enforcement
// itself.
export function hasRenderableMethod(metric: DerivedMetric): boolean {
  return metric.isInference === true && metric.method.trim().length > 0;
}
