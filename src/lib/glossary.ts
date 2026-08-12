// Shared glossary registry — the actual implementation of AGENTS.md §0.9
// ("Translate the jargon" / "every term of art gets a glossary entry
// rendered inline in plain language") and §4's "every jargon term renders
// with an inline gloss from the glossary. No unexplained acronyms in
// user-facing copy."
//
// Before this file, §0.9 existed only as two bespoke, non-shared
// instances of the same idea: WardModal.tsx's local VOTE_OPTION_DISPLAY
// (plain-language glosses for non-yes/no vote options) and a hardcoded
// `title="..."` tooltip on the words "consent agenda" in
// src/app/meetings/page.tsx. Neither read from, or wrote to, a shared
// place — two maintainers extending "translate the jargon" to a third
// term would have built a third one-off. This registry plus Gloss.tsx is
// that shared infrastructure; both prior instances are retrofitted onto
// it (WardModal.tsx keeps its label/color styling fields locally, since
// those are presentation, not the glossary's job — only the gloss *text*
// moved here) and src/app/bills/page.tsx becomes a genuine third
// consumer with real ingested data (Open States' own BillAction
// classification tags).
//
// AGENTS.md §3.4 ("AI-Generated Content — Provenance & Review"): every
// definition below is AI-drafted user-facing copy. §3.4 requires a human
// to read and approve every string that reaches a user before it ships —
// that review has NOT happened yet as of this commit. The legal/civic
// terms in CIVIC_TERM_GLOSSARY especially (ordinance, TIF, CUP, EAW,
// etc.) are terms of art with real legal meaning; a wrong definition on a
// transparency site is itself an AGENTS.md §0.2 ("receipts, not
// rhetoric") violation, not just a copy nit. FLAG FOR HUMAN REVIEW before
// this ships to production.

// One glossary entry. `term` is the canonical display label (title case,
// used by any consumer that wants to print the term itself rather than
// just wrap existing text); `gloss` is the plain-language definition
// rendered on disclosure. Deliberately just these two fields — no
// color/styling here, per the task split above: presentation stays local
// to whichever component renders a given entry (e.g. WardModal.tsx's vote
// badges keep their own `color`/`colorSoft`), so this registry is safe to
// import from server components, static pages, and client components
// alike without dragging any UI concerns along.
export interface GlossaryEntry {
  term: string;
  gloss: string;
}

// Stable slug keys. Two families intentionally share this one registry
// rather than living in two separate objects: AGENTS.md §0.9 doesn't
// distinguish "legal term of art" from "vote-record term" from "bill
// classification tag" — a resident doesn't care which subsystem coined
// the jargon, only that it's translated. A single lookup means a future
// consumer never has to know which family a term came from before it can
// gloss it.
export type GlossaryKey =
  // (a) AGENTS.md §0.9-listed terms with zero prior implementation in
  // src/ (verified by grep before writing this file — only "consent
  // agenda" already existed, as the meetings/page.tsx tooltip below).
  | "ordinance"
  | "resolution"
  | "consent-agenda"
  | "first-reading"
  | "cup"
  | "tif"
  | "eaw"
  | "interim-ordinance"
  | "committee-of-the-whole"
  | "independent-expenditure"
  // (a2) Civic-participation-turnout terms — public/turnout/city/<year>.json
  // and turnoutConfig.mjs's own vocabulary, glossed here per AGENTS.md §0.9
  // rather than left as unexplained acronyms on the participation map's
  // legend/DOM record list.
  | "cvap"
  | "registered-voter"
  | "below-threshold-turnout"
  // (b) Open States' BillAction.classification tags, restricted to the
  // set that actually appears in public/state-bills.json as of this
  // commit (confirmed by reading the file, not guessed from Open States'
  // general documentation — that schema defines a much longer list than
  // any given state's real legislative process produces on the floor).
  | "amendment-introduction"
  | "amendment-passage"
  | "committee-passage"
  | "executive-receipt"
  | "executive-signature"
  | "introduction"
  | "passage"
  | "reading-2"
  | "reading-3"
  | "referral-committee"
  // (c) Roll-call vote options a resident could otherwise misread as a
  // "no" vote — ported from WardModal.tsx's VOTE_OPTION_DISPLAY (see that
  // file's own long comment on why the original recolor-only fix was an
  // accuracy bug, not a style nit). Keyed distinctly from the raw
  // BillVote.option strings ("absent", "excused", "not voting") with a
  // "vote-" prefix so this registry's key namespace never collides with
  // an Open States classification tag that happens to share a word.
  | "vote-absent"
  | "vote-excused"
  | "vote-not-voting"
  | "vote-other";

export const GLOSSARY: Record<GlossaryKey, GlossaryEntry> = {
  // --- (a) Civic/legal terms of art -----------------------------------
  ordinance: {
    term: "Ordinance",
    gloss: "A local law passed by a city or county council. It has the force of law within that jurisdiction, unlike a resolution, which is a statement of intent or policy.",
  },
  resolution: {
    term: "Resolution",
    gloss: "A formal statement of a governing body's decision, position, or intent. Unlike an ordinance, a resolution doesn't create or change law — it's used for things like approving a contract, taking a position, or directing staff.",
  },
  "consent-agenda": {
    // Canonical entry reconciling the two pre-existing, slightly
    // different phrasings that lived in src/app/meetings/page.tsx before
    // this retrofit (a `title` tooltip on the flagged-item badge, and a
    // second, shorter one on the words "consent agenda" in the page's
    // intro paragraph) — one definition now, not two that could drift.
    term: "Consent agenda",
    gloss: "A block of routine agenda items voted on together in a single motion, with no individual discussion or roll call. Anything on it passes or fails as a group. AGENTS.md §0.4 flags consent-agenda items specifically because a vote with no discussion is exactly the kind of routine, easy-to-miss decision this site exists to surface.",
  },
  "first-reading": {
    term: "First reading",
    gloss: "The first formal introduction of a proposed ordinance to a governing body. Many jurisdictions require an ordinance to be read (or introduced) at one meeting and voted on at a later one, so the public has time to weigh in before it can pass.",
  },
  cup: {
    term: "Conditional use permit (CUP)",
    gloss: "City approval allowing a property to be used in a way the zoning code doesn't automatically allow, subject to specific conditions the city sets — for example, a business operating in a residential zone.",
  },
  tif: {
    term: "Tax increment financing (TIF)",
    gloss: "A financing tool where a city captures the future increase in property tax revenue a development is expected to generate, and uses it to pay for public costs of that development (like infrastructure) instead of collecting it as general tax revenue right away.",
  },
  eaw: {
    term: "Environmental assessment worksheet (EAW)",
    gloss: "A required review of a proposed project's likely environmental effects, used to decide whether a full environmental impact statement is needed before the project can proceed. Required under Minnesota environmental review law for certain project types and sizes.",
  },
  "interim-ordinance": {
    term: "Interim ordinance",
    gloss: "A temporary ordinance — often called a moratorium — that a city adopts to freeze a specific kind of development or activity for a limited time while it studies the issue or writes a permanent ordinance.",
  },
  "committee-of-the-whole": {
    term: "Committee of the whole",
    gloss: "A meeting format where an entire governing body (e.g. the full city council) meets as a committee, usually for discussion or work sessions, rather than as the formal council taking official votes. Rules are often more relaxed than a regular meeting.",
  },
  "independent-expenditure": {
    term: "Independent expenditure",
    gloss: "Money spent to support or oppose a candidate by a person or group not coordinating with that candidate's own campaign. Reported separately from campaign contributions because it isn't given to the candidate directly.",
  },

  // --- (a2) Civic-participation-turnout terms --------------------------
  cvap: {
    term: "Citizen voting-age population (CVAP)",
    gloss: "A Census Bureau estimate (from a 5-year survey average, not an exact count) of how many people in a place are both US citizens and 18 or older — the population usually used as the denominator for a turnout rate, since it excludes people too young to vote or not eligible to. It comes with its own margin of error and can lag recent growth or incorporation.",
  },
  "registered-voter": {
    term: "Registered voter",
    gloss: "Someone on the official voter rolls as of a given point in time. This site's \"turnout of registered\" figure counts everyone registered by the time polls closed election day — including people who registered same-day, which Minnesota has allowed since 1974 — not just those pre-registered a week before.",
  },
  "below-threshold-turnout": {
    term: "Too small to shade reliably",
    gloss: "This city has fewer than 200 registered voters, the point where a single voter can swing the published percentage by several points. The raw vote counts are still shown in full — only the percentage is flagged as noisy rather than precise.",
  },

  // --- (b) Open States bill-action classification tags ----------------
  // Source of truth for the exact tag set: public/state-bills.json,
  // Bill.actions[].classification (see src/lib/types.ts's BillAction).
  // These are Open States' own vocabulary, kept as reported (per that
  // type's comment, "never re-interpreted") — the gloss below explains
  // what the tag means, it does not change or soften what it says.
  "amendment-introduction": {
    term: "Amendment introduced",
    gloss: "A proposed change to the bill's text was formally introduced. The amendment itself still has to be voted on before it becomes part of the bill.",
  },
  "amendment-passage": {
    term: "Amendment passed",
    gloss: "A proposed change to the bill's text was adopted, and is now part of the bill going forward.",
  },
  "committee-passage": {
    term: "Passed committee",
    gloss: "The committee reviewing this bill voted to advance it, typically to the full chamber floor or to another committee.",
  },
  "executive-receipt": {
    term: "Sent to the governor",
    gloss: "The bill has passed both chambers of the legislature and been delivered to the governor's desk for a decision.",
  },
  "executive-signature": {
    term: "Signed into law",
    gloss: "The governor signed the bill, and it is now law (subject to whatever effective date the bill itself specifies).",
  },
  introduction: {
    term: "Introduced",
    gloss: "The bill was formally filed and given a bill number. This is the starting point of a bill's public record — introduction alone doesn't mean it will get a hearing or a vote.",
  },
  passage: {
    term: "Passed",
    gloss: "The full chamber (House or Senate) voted to approve the bill. A bill generally needs to pass both chambers, in identical form, before it can go to the governor.",
  },
  "reading-2": {
    term: "Second reading",
    gloss: "The bill's second formal reading before the chamber, part of the procedural steps most bills go through before a final floor vote. In many legislatures this is when amendments are typically considered.",
  },
  "reading-3": {
    term: "Third reading",
    gloss: "The bill's third and typically final formal reading, usually immediately preceding the floor vote on final passage.",
  },
  "referral-committee": {
    term: "Referred to committee",
    gloss: "The bill was assigned to a committee for review before it can be considered by the full chamber. Most bills that never advance stop here — a committee is not required to act on a bill it receives.",
  },

  // --- (c) Roll-call vote options --------------------------------------
  // Canonical copy ported verbatim from WardModal.tsx's now-removed
  // VOTE_OPTION_DISPLAY.gloss fields (see that file's git history for the
  // original authoring context / issue #57). "yes"/"no" have no entry
  // here on purpose — same as before, they're unambiguous enough that a
  // gloss would be clutter, not clarity (see VoteRow's own comment in
  // WardModal.tsx).
  "vote-absent": {
    term: "Absent",
    gloss: "Wasn't recorded as present for this vote — didn't vote either way.",
  },
  "vote-excused": {
    term: "Excused",
    gloss: "Formally excused from this vote — sometimes a conflict-of-interest recusal, sometimes a pre-approved absence.",
  },
  "vote-not-voting": {
    term: "Present, No Vote",
    gloss: "Was present but didn't cast a vote either way.",
  },
  "vote-other": {
    term: "Other",
    gloss: "Recorded outside the usual yes/no options — see the source record for the specifics.",
  },
};

// Safe lookup for keys that arrive as plain strings from ingested data
// (e.g. a BillAction.classification[number] or a BillVote.option) rather
// than as a statically-known GlossaryKey literal — those are typed as
// `string` in src/lib/types.ts because they're upstream-controlled
// vocabularies this codebase doesn't get to constrain, so a consumer
// can't just index GLOSSARY directly without risking a runtime `undefined`
// the type system won't catch.
export function lookupGlossary(key: string): GlossaryEntry | undefined {
  return Object.prototype.hasOwnProperty.call(GLOSSARY, key) ? GLOSSARY[key as GlossaryKey] : undefined;
}
