// scripts/lib/fetchJson.mjs
//
// Shared by every scripts/fetch-*.mjs and scripts/ingest/*.mjs that fetches
// JSON from a live upstream (issue #131) — previously reimplemented 5
// times: 3 identical bare copies (fetch-city-boundaries.mjs, fetch-
// commissioners.mjs, fetch-wards.mjs — plain fetch, throw-on-!ok, no
// retry) and 2 near-identical richer copies with 429/Retry-After backoff
// (fetch-state-legislature.mjs, scripts/ingest/state-bills.mjs — the
// latter's own comment already admitted it was a copy of the former).
// Only the two richer copies satisfied AGENTS.md §2.2's "good-citizen
// fetcher" requirement (backoff, rate-limit respect) — a MnDOT/MnGeo or
// county ArcGIS endpoint starting to rate-limit (as the Open States API
// already does) would have hard-failed the other three instead of backing
// off. Every caller now gets the same backoff behavior.
//
// USER_AGENT unifies on scripts/ingest/state-bills.mjs's string — more
// §2.2-compliant than the other four scripts' bare "mn-civic-map-etl/0.1"
// (it names the project and points at the repo as a contact-ish
// reference). A deliberate, minor behavior change bundled into this
// consolidation, not a silent one: a future User-Agent change (e.g. an
// actual contact email per §2.2) now only needs updating in one place —
// the exact problem this issue's own fix note called out.
export const USER_AGENT = "wealldobettermn-etl/0.1 (github.com/ngabantudev/wealldobettermn)";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches a URL and parses the response as JSON, retrying on HTTP 429
 * (honoring a Retry-After header in seconds, falling back to
 * attempt*2000ms) up to `maxRetries` times — the behavior fetch-state-
 * legislature.mjs and scripts/ingest/state-bills.mjs already had, now
 * extended to every caller. Throws on any other non-OK response, or once
 * retries are exhausted for a persistent 429 — every existing caller's own
 * fail-loud posture (AGENTS.md §0.3/§3.1) is preserved, this only adds
 * politeness on top of it, never a silent partial/fabricated result.
 *
 * `logLabel` controls the retry-wait log line's bracketed prefix
 * (`[${logLabel}] rate limited, waiting Ns...`) — pass the same prefix
 * each script's own other console.log calls already use, so a mid-run
 * backoff line reads as coming from the same script, not a mystery
 * shared-module log.
 *
 * @param {string} url
 * @param {{ headers?: Record<string, string>, logLabel?: string, maxRetries?: number, attempt?: number }} [options]
 */
export async function fetchJson(url, { headers = {}, logLabel = "fetch", maxRetries = 5, attempt = 1 } = {}) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers } });
  if (res.status === 429 && attempt <= maxRetries) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 2000;
    console.log(`[${logLabel}] rate limited, waiting ${Math.round(delayMs / 1000)}s (attempt ${attempt})...`);
    await sleep(delayMs);
    return fetchJson(url, { headers, logLabel, maxRetries, attempt: attempt + 1 });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}
