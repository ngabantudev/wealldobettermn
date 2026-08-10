"use client";

// The real AGENTS.md §2.6 submission form — replaces the "not live yet"
// placeholder (ContributeComingSoon.tsx) now that POST /api/submissions
// actually exists and has been live-verified end to end. City is locked
// to whatever the visitor arrived with (?city=, set by AddOfficialsCTA's
// map-click/search entry points — see that component's own header) since
// that's already a real, recognized, uncovered city the map/search
// resolved; a visitor landing here with no city param (e.g. a bookmark,
// a direct link) gets a free-text field instead, since the server
// independently re-validates whatever name arrives either way
// (cityMatch.ts) — this form never trusts its own city field, it's a
// convenience, not a security boundary.

import { Check, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import CommunityOfficialsList, { type CommunityOfficial } from "./CommunityOfficialsList";
import TurnstileWidget from "./TurnstileWidget";

// Purely cosmetic — the real, single status update a screen reader gets
// is the one aria-live announcement in useLoadingMessage below, not this
// rotation itself (re-announcing a joke every few seconds would be
// obnoxious, not fun, for anyone using a screen reader). {city} is
// substituted in where present; a submission takes ~20-25s against real
// Workers AI (measured live against several real city sites), long enough
// that a static "Checking…" reads as broken rather than working.
function buildLoadingMessages(city: string): string[] {
  const name = city || "this city";
  return [
    "Politely knocking on City Hall's digital door…",
    `Asking ${name} who's actually in charge…`,
    "Untangling municipal red tape…",
    "Cross-referencing with the real mayor, not just vibes…",
    "Making sure nobody snuck in as “Supreme Overlord”…",
    "Counting council members (should be more than zero)…",
    "Fact-checking with the fervor of a nosy neighbor…",
    "Verifying democracy, one paragraph at a time…",
    `Double-checking this isn't just ${name}'s HOA newsletter…`,
    "Consulting the archives (and possibly a raccoon)…",
    "Summoning civic spirit — and a Workers AI model…",
    "Reading the fine print so you don't have to…",
  ];
}

/** Rotates through buildLoadingMessages while `active`; announces exactly once, on start, to screen readers. */
function useLoadingMessage(active: boolean, city: string) {
  const messages = buildLoadingMessages(city);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    // No reset-to-0 on deactivate: harmless to resume from wherever the
    // rotation last landed next time, and setting state synchronously in
    // an effect body (rather than from the interval callback below) is
    // exactly what react-hooks/set-state-in-effect flags.
    if (!active) return;
    const interval = setInterval(() => setIndex((i) => (i + 1) % messages.length), 2800);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return messages[index];
}

interface DomainSafetySummary {
  hostname: string;
  isGovernmentGatedTld: boolean;
  isFlaggedMalicious: boolean;
  hostnameContainsCityName: boolean;
}

interface SubmissionSuccess {
  status: "pending";
  submissionId: string;
  cityMatched: string;
  extracted: { officials: CommunityOfficial[] };
  confirmationsNeeded: number;
  domainSafety: DomainSafetySummary;
}

interface SubmissionRejection {
  status: "rejected";
  reason: string;
  message: string;
  submissionId?: string;
}

type SubmissionResponse = SubmissionSuccess | SubmissionRejection;

function isSubmissionResponse(value: unknown): value is SubmissionResponse {
  return typeof value === "object" && value !== null && "status" in value;
}

export default function ContributeForm() {
  const searchParams = useSearchParams();
  const cityFromLink = searchParams.get("city");
  const cityLocked = Boolean(cityFromLink);

  const [cityName, setCityName] = useState(cityFromLink ?? "");
  const [sourceUrl, setSourceUrl] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmissionResponse | null>(null);
  const loadingMessage = useLoadingMessage(submitting, cityName);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!turnstileToken || submitting) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cityName, sourceUrl, turnstileToken }),
      });
      const data: unknown = await res.json();
      if (isSubmissionResponse(data)) {
        setResult(data);
      } else {
        setResult({ status: "rejected", reason: "unexpected_response", message: "Something went wrong reading the server's response — please try again." });
      }
    } catch {
      setResult({ status: "rejected", reason: "network_error", message: "Couldn't reach the server — check your connection and try again." });
    } finally {
      setSubmitting(false);
      // Turnstile tokens are single-use — always get a fresh one for the next attempt.
      setTurnstileToken(null);
      setTurnstileResetKey((k) => k + 1);
    }
  }

  if (result?.status === "pending") {
    return <SubmissionSuccessSummary result={result} />;
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-ink">Add your city&apos;s officials</h1>
      <p className="mt-2 text-sm text-ink-3">
        Submit your city&apos;s official website. We&apos;ll check it&apos;s safe and pull out the mayor and
        council — it stays flagged pending until confirmed.
      </p>
      <p className="mt-2 text-sm text-ink-3">
        Just the page&apos;s text, nothing else — no GIS or map files needed. Your city shows as one point on
        the map either way.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <div>
          <label htmlFor="contribute-city" className="block text-sm font-medium text-ink-2">
            City
          </label>
          <input
            id="contribute-city"
            name="city"
            type="text"
            value={cityName}
            onChange={(e) => setCityName(e.target.value)}
            readOnly={cityLocked}
            required
            aria-describedby={cityLocked ? "contribute-city-locked-note" : undefined}
            className={`mt-1 w-full rounded-lg border border-hair-strong px-3 py-2 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              cityLocked ? "bg-panel-3 text-ink-3" : "bg-panel"
            }`}
          />
          {cityLocked && (
            <p id="contribute-city-locked-note" className="mt-1 text-xs text-ink-3">
              Set from the link you followed — go back to the map to pick a different city.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="contribute-url" className="block text-sm font-medium text-ink-2">
            Official website URL
          </label>
          <input
            id="contribute-url"
            name="sourceUrl"
            type="url"
            inputMode="url"
            placeholder="https://www.cityofexample.gov/"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-hair-strong bg-panel px-3 py-2 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <p className="mt-1 text-xs text-ink-3">
            Use the page listing the mayor and council (often under &ldquo;Government&rdquo; or &ldquo;City
            Council&rdquo;), not the homepage. This checks the page is safe and mentions
            {cityName ? ` ${cityName}` : " the city"} — it doesn&apos;t prove this is the real site. Other
            visitors confirm that afterward.
          </p>
        </div>

        <TurnstileWidget onToken={setTurnstileToken} resetKey={turnstileResetKey} />

        {result?.status === "rejected" && (
          <div role="alert" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--vote-no)", backgroundColor: "var(--vote-no-soft)", color: "var(--vote-no)" }}>
            {result.message}
          </div>
        )}

        <button
          type="submit"
          disabled={!turnstileToken || submitting || !sourceUrl.trim() || !cityName.trim()}
          className="rounded-lg bg-positive px-4 py-2.5 text-sm font-semibold text-on-positive hover:bg-positive-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? loadingMessage : "Submit"}
        </button>
        {/* One calm, plain-language announcement on submit — not the
            rotating joke text above, which would be tedious re-announced
            every couple seconds. This is the only thing a screen reader
            hears about the wait. */}
        <p role="status" aria-live="polite" className="sr-only">
          {submitting ? "Checking your submission — this can take up to 30 seconds." : ""}
        </p>
      </form>

      <h2 className="mt-8 text-base font-semibold text-ink">Something not working?</h2>
      <p className="mt-2 text-sm text-ink-3">
        Open an issue naming the city and its official website on the{" "}
        <a href="https://github.com/ngabantudev/wealldobettermn/issues" className="text-accent underline underline-offset-2">
          issue tracker
        </a>
        , and it&apos;ll be added by hand instead.
      </p>
    </>
  );
}

function SubmissionSuccessSummary({ result }: { result: SubmissionSuccess }) {
  const officials = result.extracted.officials;
  return (
    <>
      <h1 className="text-xl font-semibold text-ink">{result.cityMatched} is now pending</h1>
      <div
        role="status"
        className="mt-4 rounded-lg border px-3 py-2 text-sm"
        style={{ borderColor: "var(--vote-yes)", backgroundColor: "var(--vote-yes-soft)", color: "var(--vote-yes)" }}
      >
        Found {officials.length} official{officials.length === 1 ? "" : "s"}. This is live on the map now, labeled
        pending, until it&apos;s confirmed.
      </div>

      <CommunityOfficialsList officials={officials} />

      <h2 className="mt-6 text-sm font-semibold text-ink-2">What we checked</h2>
      <p className="mt-1 text-xs text-ink-3">
        Source: <span className="font-medium text-ink-2">{result.domainSafety.hostname}</span>. These are
        plausibility signals, not proof — a green check makes a submission MORE likely to be legitimate, it
        doesn&apos;t confirm it.
      </p>
      <ul className="mt-2 space-y-1.5">
        <SignalRow passed={!result.domainSafety.isFlaggedMalicious} label="Not on a known malware/phishing list" />
        <SignalRow
          passed={result.domainSafety.isGovernmentGatedTld}
          label=".gov or .mn.us domain (state/federally gated — not required, just a bonus)"
        />
        <SignalRow
          passed={result.domainSafety.hostnameContainsCityName}
          label={`Domain contains "${result.cityMatched}" (not required, just a bonus)`}
        />
      </ul>
    </>
  );
}

function SignalRow({ passed, label }: { passed: boolean; label: string }) {
  return (
    <li className="flex items-start gap-1.5 text-xs text-ink-3">
      {passed ? (
        <Check aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--vote-yes)" }} strokeWidth={2.25} />
      ) : (
        // Muted, not --vote-no red: absence of a bonus signal is NOT a
        // failure (AGENTS.md §2.6 — the .gov/city-name-in-domain checks
        // are additive-only, most legitimate small-city sites won't have
        // either), so this deliberately doesn't read as an alarm.
        <X aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={2.25} />
      )}
      <span>{label}</span>
    </li>
  );
}
