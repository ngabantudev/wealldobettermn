"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { lookupGlossary, type GlossaryKey } from "@/lib/glossary";

// The shared implementation of AGENTS.md §0.9's "every term of art gets a
// glossary entry rendered inline in plain language." Before this
// component, the same accessible-disclosure shape existed twice,
// independently, with no shared code: WardModal.tsx's VoteRow (a badge
// button toggling an italic gloss line below it) and a bare `title=`
// tooltip on the words "consent agenda" in src/app/meetings/page.tsx (no
// keyboard-operable disclosure at all — hover-only, so a keyboard or
// touch user had no way to reach it). This generalizes VoteRow's pattern
// — the one with a real keyboard/touch story, not the tooltip-only one —
// so every future glossed term gets both for free.
//
// Deliberately unopinionated about layout: WardModal's vote badges need
// their own per-party `color`/`colorSoft` background (kept local to that
// component, not the glossary's job — see glossary.ts's header comment),
// while meetings/page.tsx and bills/page.tsx just want a plain inline
// term inside a sentence. `className`/`style` on the toggle and a
// separate `glossClassName` for the revealed text let each call site
// supply its own presentation without this component guessing at it.
//
// No transition on reveal — matches VoteRow's original disclosure, which
// was a plain conditional render with no animation, so there is nothing
// here that would need to be gated behind `prefers-reduced-motion`.
export interface GlossProps {
  // A stable key into src/lib/glossary.ts's GLOSSARY. Typed as the union
  // (not `string`) so a typo is a compile error, not a silently-missing
  // gloss — callers with a runtime-sourced key (e.g. a raw
  // BillAction.classification tag) should check `lookupGlossary` first
  // and only render <Gloss> for keys they've confirmed exist.
  term: GlossaryKey;
  // Visible label. Defaults to the registry's own `term` display text so
  // a bare `<Gloss term="tif" />` is a complete, correct call; pass
  // children to wrap existing running text instead (e.g. meetings/page.tsx
  // wrapping the words "consent agenda" inside its intro paragraph).
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  // Classes for the revealed gloss text itself, separate from the toggle
  // button's own classes above.
  glossClassName?: string;
}

// Plain, unstyled fallback for a term this build's registry doesn't
// (yet) define. Rendering the label as inert text rather than throwing
// keeps a stale/renamed key from taking down the whole page it's on —
// same "known gap over a crash" posture as AGENTS.md §3.1's empty-state
// rule for missing data feeds, applied here to missing glossary copy.
function GlossFallback({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export default function Gloss({ term, children, className, style, glossClassName }: GlossProps) {
  const entry = lookupGlossary(term);
  const [shown, setShown] = useState(false);
  // useId, not a hand-built string, so two <Gloss> instances for the same
  // term on one page (e.g. "consent agenda" appearing twice on
  // /meetings) never collide on the same aria-describedby target — the
  // WardModal precedent this generalizes could get away with
  // `vote-gloss-${vote.voteId}` because every vote already carries a
  // unique id; a shared component has no such per-call-site uniqueness
  // guarantee to borrow.
  const reactId = useId();
  const glossId = entry ? `gloss-${reactId}` : undefined;

  if (!entry) {
    return <GlossFallback>{children ?? term}</GlossFallback>;
  }

  const label = children ?? entry.term;

  return (
    <span className="inline">
      <button
        type="button"
        onClick={() => setShown((prev) => !prev)}
        aria-expanded={shown}
        aria-describedby={glossId}
        title={entry.gloss}
        style={style}
        className={
          className ??
          // Default presentation for plain inline-text usage (meetings/
          // bills pages): reads as glossed text, not a button, until
          // focused/hovered — a dotted underline plus `cursor-help`
          // signals "more info here" the way the native `title` tooltip
          // already does for pointer users, while still being a real
          // <button> underneath for keyboard and touch.
          "underline decoration-dotted decoration-ink-4 underline-offset-2 cursor-help font-inherit text-inherit bg-transparent p-0 m-0 align-baseline focus:outline-none focus-visible:ring-2 focus-visible:ring-inset rounded-sm"
        }
      >
        {label}
      </button>
      {shown && (
        <span id={glossId} role="note" className={glossClassName ?? "block text-xs italic text-ink-3"}>
          {entry.gloss}
        </span>
      )}
    </span>
  );
}
