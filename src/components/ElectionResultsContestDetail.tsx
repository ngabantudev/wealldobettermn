"use client";

// One contest row on /election-results — the AGENTS.md §0.7 "progressive
// precision" implementation for this layer: the page's own server
// component only ever imports public/election-results/index.json (98
// small summary objects), never any of the 98 per-contest detail files.
// This component is what fetches ONE of those detail files, and only the
// one the reader actually opens, and only the first time they open it —
// same "fetch lazily on first expand" convention electionResultsTypes.ts's
// own ContestSummary.dataPath comment documents (mirroring
// CampaignFinanceCandidateSummary.dataPath's contract, never itself wired
// up to a fetch anywhere yet — this is the first consumer of that
// convention).
//
// A same-origin fetch of our own static JSON under public/, not a
// third-party call — AGENTS.md §2.3's "any runtime third-party request
// triggered by user input" rule doesn't reach this: nothing about what the
// reader does (which <details> they open) leaves the device, no address,
// no query string, nothing sent anywhere. It is simply this page's own
// data, split into 99 files instead of 1 so the other 97 never have to be
// downloaded by someone who only cares about one race.
//
// Native <details>/<summary> (AGENTS.md §4 — keyboard-operable, no
// custom JS-only disclosure widget) with the fetch wired to its own
// onToggle, not a synthetic "expanded" button state layered on top —
// keyboard Enter/Space on the <summary>, and a screen reader's own
// disclosure semantics, both trigger the native toggle event this
// component listens for, so there is exactly one way to open this row and
// it is the accessible one.
//
// No winner/leading/projected styling anywhere below, and candidates are
// rendered in the exact order the source data already provides them in
// (source-sorted by vote count, descending, per Contest.candidates's own
// doc comment in electionResultsTypes.ts) — never re-sorted here, never
// given a different className for row 0 than row 1. See that file's own
// header comment on why a bigger/bolder/colored first row is exactly the
// kind of de facto winner call AGENTS.md §1c forbids.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Contest, ContestSummary } from "@/lib/electionResultsTypes";

type FetchState = { status: "idle" } | { status: "loading" } | { status: "loaded"; contest: Contest } | { status: "error"; message: string };

function formatVotePercent(percent: number): string {
  return `${percent}%`;
}

export default function ElectionResultsContestDetail({ summary, primarySourceUrl }: { summary: ContestSummary; primarySourceUrl: string }) {
  // Two-piece state, deliberately: `opened` is the plain native <details>
  // toggle boolean (set from the DOM event, synchronous, no fetch side
  // effect inside the handler itself), and the actual fetch lives in a
  // separate useEffect keyed off it — real cleanup (an AbortController,
  // cancelled on unmount) requires a useEffect's returned function, which
  // an onToggle event handler's own return value is not; React only ever
  // treats that as a cleanup callback for effects, not for DOM event
  // handlers, so an earlier draft of this component silently never ran its
  // "cancelled" branch on unmount.
  const [opened, setOpened] = useState(false);
  const [state, setState] = useState<FetchState>({ status: "idle" });
  // Tracks the *previous* render's `opened` value so the effect below can
  // fire only on the closed→open edge, never on every render where
  // `opened` happens to already be true. This is what makes retry-by-
  // reopening safe: without it, the effect would need `state.status` in
  // its dependency array to know whether a fetch is already in flight or
  // done, and re-running on every state.status change (including the one
  // it itself just set to "error") is an infinite fetch loop.
  const wasOpen = useRef(false);

  const handleToggle = useCallback((event: React.SyntheticEvent<HTMLDetailsElement>) => {
    setOpened(event.currentTarget.open);
  }, []);

  useEffect(() => {
    const justOpened = opened && !wasOpen.current;
    wasOpen.current = opened;
    // Skip a row that's already loading or has already loaded
    // successfully — but NOT one that previously errored, so closing and
    // reopening a failed row is a real retry (the error copy below tells
    // the reader to do exactly that).
    if (!justOpened || state.status === "loading" || state.status === "loaded") return;
    const controller = new AbortController();
    setState({ status: "loading" });
    fetch(summary.dataPath, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<Contest>;
      })
      .then((contest) => setState({ status: "loaded", contest }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        // Never silently show nothing (AGENTS.md §3.1) — an honest error
        // state with a path back to the primary source lives in the
        // render below.
        const message = err instanceof Error ? err.message : "Unknown error";
        setState({ status: "error", message });
      });
    return () => controller.abort();
    // state.status is read only to short-circuit an already-in-flight/
    // loaded fetch, not to decide whether to re-run this effect;
    // including it in the dependency array would refire this effect on
    // the very state update it just made (see wasOpen's own comment
    // above), so it's deliberately left out below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, summary.dataPath]);

  return (
    <details className="well rounded-xl border p-4" onToggle={handleToggle}>
      <summary className="cursor-pointer list-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <span className="font-medium text-ink-2">{summary.contestName}</span>
        <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-3">
          {summary.district !== null && <span>District {summary.district}</span>}
          {summary.county !== null && <span>County {summary.county}</span>}
          <span>
            {summary.precinctsReporting} of {summary.totalPrecincts} precincts reporting
          </span>
          <span>
            {summary.candidateCount} candidate{summary.candidateCount === 1 ? "" : "s"}
          </span>
        </span>
      </summary>

      <div className="mt-3 border-t border-hair pt-3">
        {state.status === "loading" && <p className="text-sm text-ink-3">Loading candidate results…</p>}

        {state.status === "error" && (
          <p role="alert" className="text-sm text-ink-3">
            Couldn&apos;t load results for this contest ({state.message}). Try reopening this section, or see{" "}
            <a href={primarySourceUrl} className="text-accent underline underline-offset-2">
              the Secretary of State&apos;s own results
            </a>
            .
          </p>
        )}

        {state.status === "loaded" && (
          <ul className="space-y-2">
            {state.contest.candidates.map((candidate, index) => (
              // Index is part of the key deliberately, not just
              // candidateName — a contest can legitimately list the same
              // write-in label more than once, and every row renders with
              // equal visual weight regardless of its position, so there
              // is no ordering signal for React to preserve keys against
              // (AGENTS.md §1c — see this file's header comment).
              <li key={`${candidate.candidateName}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
                <span className="text-ink-2">
                  {candidate.candidateName}
                  {candidate.candidateParty && <span className="text-ink-4"> ({candidate.candidateParty})</span>}
                  {candidate.isWriteIn && <span className="text-ink-4"> — write-in</span>}
                </span>
                <span className="text-ink-3 tabular-nums">
                  {candidate.votes.toLocaleString("en-US")} votes ({formatVotePercent(candidate.votePercent)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
