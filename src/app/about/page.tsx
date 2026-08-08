import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";

// Static route (AGENTS.md §2.1). Required by §0.13 ("Public disclosure...
// the project's /about page states plainly that the codebase was developed
// with AI assistance...") and §3.4 — this is that page.

export const metadata: Metadata = {
  title: "About — We All Do Better",
  description: "What this site is for, how it's built, and how to report a problem.",
};

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <h1 className="text-xl font-semibold text-ink">About</h1>
        <p className="mt-2 text-sm text-ink-3">
          We All Do Better is a map-first civic transparency site for Minnesota local, county, and state politics.
        </p>

        <h2 className="mt-8 text-base font-semibold text-ink">What it answers</h2>
        <p className="mt-2 text-sm text-ink-3">
          Four questions, in this order: Who represents me? What do they vote for? Where does their money come
          from? How do I contact them? Every feature on this site earns its place by serving one of those.
        </p>

        <h2 className="mt-8 text-base font-semibold text-ink">Receipts, not rhetoric</h2>
        <p className="mt-2 text-sm text-ink-3">
          Every published claim resolves to a citable primary record — a city&apos;s own open-data portal, a clerk&apos;s
          agenda packet, a roll call, a campaign finance filing. Where a source doesn&apos;t exist yet, the site says
          so plainly rather than filling the gap with a guess.
        </p>

        <h2 className="mt-8 text-base font-semibold text-ink">Built with AI assistance, human-accountable</h2>
        <p className="mt-2 text-sm text-ink-3">
          This codebase, its data pipelines, and its copy are developed with AI coding assistance (Claude Code /
          Anthropic). Every output is reviewed, edited, and owned by a human maintainer before it ships — the AI
          tooling is a drafting aid, not a decision-maker, and it does not produce source records: every published
          data point traces back to a primary or corroborated source regardless of how the script that fetched it
          was written. The project&apos;s full instruction set for how AI tooling is used here is public — it&apos;s
          AGENTS.md, the same file that governs the ethical guardrails (privacy, scope, sourcing) this project holds
          itself to. Errors introduced during AI-assisted development are the maintainer&apos;s responsibility, not
          a caveat that limits it.
        </p>

        <h2 className="mt-8 text-base font-semibold text-ink">Report a problem</h2>
        <p className="mt-2 text-sm text-ink-3">
          Found a stale record, a wrong district, or a bug? See this site&apos;s{" "}
          <a href="/privacy" className="text-accent underline underline-offset-2">
            privacy page
          </a>{" "}
          for what data this site does and doesn&apos;t send anywhere.
        </p>
      </main>
    </>
  );
}
