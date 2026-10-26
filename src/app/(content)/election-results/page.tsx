import type { Metadata } from "next";
import { ELECTION_RESULTS_NOTE } from "@/lib/coverage";
import type { CertificationStatus, ContestSummary, ElectionResultsIndex } from "@/lib/electionResultsTypes";
import Gloss from "@/components/Gloss";
import ElectionResultsContestDetail from "@/components/ElectionResultsContestDetail";
// A bundler-resolved JSON import, not readFileSync(process.cwd() + ...) —
// see src/app/(content)/bills/page.tsx's own header comment for the full
// 2026-08-06 Cloudflare Workers incident this pattern avoids (a
// module-scope disk read that only works during `next build`, bundled
// straight into the deployed Worker where public/ isn't a real
// filesystem). Path mirrors ELECTION_RESULTS_LAYER.publicDataPath in
// layers.ts; a bundler import specifier must be a literal string, so it
// can't be built from that constant — keep the two in sync by hand if the
// output path ever moves.
import indexData from "../../../../public/election-results/index.json";

// FEATURES.md has no ticket number for this page as of authorship. Static
// route (AGENTS.md §2.1 — takes no user input, needs no server boundary),
// following the exact /bills pattern: one build-time JSON import for the
// cheap summary list (AGENTS.md §0.7 "progressive precision" — the 98
// per-contest detail files are never imported here, only fetched lazily,
// client-side, on first expand — see ElectionResultsContestDetail.tsx),
// an honest empty state, and Gloss/lookupGlossary for jargon.
//
// Deliberately not "LIVE" anywhere in this file, in metadata, or in any
// rendered copy — AGENTS.md's standing decision, and electionResultsTypes.
// ts's own header comment on why certificationStatus / resultsAsOf /
// provenance.fetchedAt are three separate fields that must never collapse
// into one "as of" string. This page renders all three, distinctly, in
// the status block below.
export const metadata: Metadata = {
  title: "2026 MN State Primary Results — We All Do Better",
  description: "Unofficial contest-level results for Minnesota's 2026 state primary, sourced from the Secretary of State.",
};

function loadIndex(): ElectionResultsIndex {
  return indexData as ElectionResultsIndex;
}

// --- Section classification ---------------------------------------------
//
// A small, pure classifier — no contest IDs hardcoded, no reliance on the
// ingest script's own ID scheme (contestId is a raw SOS ID, e.g. "0102" or
// "1601-27", not a stable category marker). Matching is on ContestSummary.
// contestName's own known prefixes plus the district/county fields already
// on the record. AGENTS.md §3.1: a contest that matches none of the known
// patterns below falls into "other" and is still rendered — it is never
// silently dropped from the page.
type SectionKey = "statewide" | "us-house" | "state-senate" | "state-house" | "county" | "district-court" | "other";

// Exact contestName matches only (not prefixes) — every statewide office
// on this ballot, in the display order the task asked for. A statewide
// race whose name doesn't exactly match one of these (e.g. a future
// office not in this list) falls through to "other" rather than being
// silently absorbed into this section under a wrong assumption.
const STATEWIDE_NAMES = ["Governor & Lt Governor", "U.S. Senator", "Secretary of State", "Attorney General", "State Auditor"];

function classifyContest(summary: ContestSummary): SectionKey {
  const name = summary.contestName;
  if (STATEWIDE_NAMES.includes(name)) return "statewide";
  if (name.startsWith("U.S. Representative")) return "us-house";
  if (name.startsWith("State Senator")) return "state-senate";
  if (name.startsWith("State Representative")) return "state-house";
  if (name.startsWith("Judge") || name.includes("District Court")) return "district-court";
  // County-level races (commissioner, sheriff, attorney, auditor/
  // treasurer, park commissioner, ...) don't share one name prefix, so
  // this falls back to the structural signal instead: the source ingest
  // only ever populates `county` for a genuinely county-level contest
  // (scripts/ingest/mn-election-results.mjs's own groupIntoContests
  // comment — empty countyCode becomes `county: null`).
  if (summary.county !== null) return "county";
  return "other";
}

// Leading digits of a district string sort numerically ("10A" before
// "2B" would be wrong under a plain string sort); parseInt stops at the
// first non-digit character, so this reads the numeric part of both a
// bare number ("5") and a house-style "10A" district the same way. Falls
// back to 0 (sorts first) for a district string with no leading digits at
// all — should not occur in this dataset, but never throws if it did.
function districtNumber(district: string | null): number {
  if (!district) return 0;
  const n = parseInt(district, 10);
  return Number.isNaN(n) ? 0 : n;
}

function byDistrict(a: ContestSummary, b: ContestSummary): number {
  return districtNumber(a.district) - districtNumber(b.district) || (a.district ?? "").localeCompare(b.district ?? "");
}

function formatDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  // Locale and time zone pinned explicitly (not left to the runtime's own
  // default) so this renders identically regardless of where the build
  // executes — a Minnesota-meaningful time zone for a Minnesota election,
  // not whatever zone the build server happens to sit in.
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Chicago",
  }).format(date);
}

function certificationGlossTerm(status: CertificationStatus): "certified-results" | "unofficial-results" {
  return status === "state-certified" || status === "county-canvassed" ? "certified-results" : "unofficial-results";
}

function certificationLabel(status: CertificationStatus): string {
  switch (status) {
    case "state-certified":
      return "State-certified";
    case "county-canvassed":
      return "County-canvassed";
    case "unofficial":
    default:
      return "Unofficial";
  }
}

const SECTION_TITLES: Record<Exclude<SectionKey, "county">, string> = {
  statewide: "Statewide",
  "us-house": "U.S. House",
  "state-senate": "State Senate",
  "state-house": "State House",
  "district-court": "District Court",
  other: "Other contests",
};

function ContestSection({ title, contests, primarySourceUrl }: { title: string; contests: ContestSummary[]; primarySourceUrl: string }) {
  if (contests.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">{title}</h2>
      <ul className="mt-3 space-y-3">
        {contests.map((summary) => (
          <li key={summary.contestId}>
            <ElectionResultsContestDetail summary={summary} primarySourceUrl={primarySourceUrl} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ElectionResultsPage() {
  const index = loadIndex();
  const hasContests = index.contests.length > 0;

  const statewide = index.contests.filter((c) => classifyContest(c) === "statewide").sort((a, b) => STATEWIDE_NAMES.indexOf(a.contestName) - STATEWIDE_NAMES.indexOf(b.contestName));
  const usHouse = index.contests.filter((c) => classifyContest(c) === "us-house").sort(byDistrict);
  const stateSenate = index.contests.filter((c) => classifyContest(c) === "state-senate").sort(byDistrict);
  const stateHouse = index.contests.filter((c) => classifyContest(c) === "state-house").sort(byDistrict);
  const districtCourt = index.contests.filter((c) => classifyContest(c) === "district-court").sort(byDistrict);
  const other = index.contests.filter((c) => classifyContest(c) === "other");

  // County races grouped by county code (see classifyContest's own
  // comment on why this is a raw SOS county code, e.g. "27", not a county
  // name — no county-code-to-name table exists anywhere in this layer's
  // ingest, and AGENTS.md §3.1/§3.3 forbid inventing one rather than
  // leaving the gap honest).
  const countyGroups = new Map<string, ContestSummary[]>();
  for (const c of index.contests) {
    if (classifyContest(c) !== "county" || c.county === null) continue;
    const group = countyGroups.get(c.county) ?? [];
    group.push(c);
    countyGroups.set(c.county, group);
  }
  const sortedCountyCodes = Array.from(countyGroups.keys()).sort((a, b) => a.localeCompare(b));
  for (const group of countyGroups.values()) {
    group.sort((a, b) => a.contestName.localeCompare(b.contestName) || byDistrict(a, b));
  }

  const resultsAsOf = formatDateTime(index.resultsAsOf);
  const fetchedAt = formatDateTime(index.provenance.fetchedAt);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-xl font-semibold text-ink">2026 MN state primary results</h1>
      <p className="mt-2 text-sm text-ink-3">
        Contest-level vote totals for Minnesota&apos;s 2026 state primary ({index.electionDate}), reported as ordered vote counts and
        percentages only — never a computed winner, projected outcome, or &quot;advances to November&quot; call.
      </p>

      {!hasContests ? (
        <div role="status" className="well mt-6 space-y-2 rounded-xl border border-hair-strong p-4 text-sm text-ink-3">
          <p className="font-medium text-ink-2">No election results ingested yet.</p>
          <p>{ELECTION_RESULTS_NOTE}</p>
          <p>
            See{" "}
            <a href={index.provenance.primarySourceUrl} className="text-accent underline underline-offset-2">
              the Secretary of State&apos;s own results
            </a>{" "}
            in the meantime.
          </p>
        </div>
      ) : (
        <>
          {/* Status block — three distinct, never-collapsed facts per
              electronResultsTypes.ts's own header comment: the legal
              certification status of the count, when the source data
              itself is as-of, and when this project last pulled it. */}
          <div className="well mt-6 space-y-2 rounded-xl border p-4 text-sm">
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-medium text-ink-2">Status:</span>
              <Gloss
                term={certificationGlossTerm(index.certificationStatus)}
                className="text-ink-2 underline decoration-dotted decoration-ink-4 underline-offset-2 cursor-help"
                glossClassName="block w-full basis-full text-xs italic text-ink-4"
              >
                {certificationLabel(index.certificationStatus)}
              </Gloss>
            </p>
            <p className="text-ink-3">
              <span className="font-medium text-ink-2">Results as of:</span>{" "}
              {resultsAsOf ?? "not reported by the source for this pull — see knownGaps below."}
            </p>
            <p className="text-xs text-ink-4">
              <span className="font-medium text-ink-3">We last pulled this data:</span> {fetchedAt ?? "unknown"}
            </p>
            <p className="text-xs text-ink-4">
              <a href={index.provenance.primarySourceUrl} className="text-accent underline underline-offset-2">
                See the Secretary of State&apos;s own results
              </a>{" "}
              for the authoritative, live count.
            </p>
          </div>

          <p className="well mt-4 rounded-xl border border-hair-strong p-4 text-sm text-ink-3">{ELECTION_RESULTS_NOTE}</p>

          <ContestSection title={SECTION_TITLES.statewide} contests={statewide} primarySourceUrl={index.provenance.primarySourceUrl} />
          <ContestSection title={SECTION_TITLES["us-house"]} contests={usHouse} primarySourceUrl={index.provenance.primarySourceUrl} />
          <ContestSection title={SECTION_TITLES["state-senate"]} contests={stateSenate} primarySourceUrl={index.provenance.primarySourceUrl} />
          <ContestSection title={SECTION_TITLES["state-house"]} contests={stateHouse} primarySourceUrl={index.provenance.primarySourceUrl} />

          {sortedCountyCodes.length > 0 && (
            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">County races</h2>
              {sortedCountyCodes.map((code) => (
                <div key={code} className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-4">County {code}</h3>
                  <ul className="mt-2 space-y-3">
                    {(countyGroups.get(code) ?? []).map((summary) => (
                      <li key={summary.contestId}>
                        <ElectionResultsContestDetail summary={summary} primarySourceUrl={index.provenance.primarySourceUrl} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}

          <ContestSection title={SECTION_TITLES["district-court"]} contests={districtCourt} primarySourceUrl={index.provenance.primarySourceUrl} />
          <ContestSection title={SECTION_TITLES.other} contests={other} primarySourceUrl={index.provenance.primarySourceUrl} />

          {index.knownGaps.length > 0 && (
            <section className="mt-8 border-t border-hair pt-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">What this layer can&apos;t see</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-4">
                {index.knownGaps.map((gap, i) => (
                  <li key={i}>{gap}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
