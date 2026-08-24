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
 * Also retries an ArcGIS-style error body — HTTP 200 with
 * `{ error: { code, message, ... } }` instead of the requested payload.
 * Found live while chasing fetch-wards.mjs's flaky ward counts: Hennepin
 * County's shared ArcGIS FeatureServer returns exactly this shape
 * ("Unable to complete operation") when several of this app's own
 * concurrent same-host requests (8 Hennepin suburbs, previously all fired
 * via one Promise.all) land on it at once — a real, reproducible upstream
 * behavior, not a one-off flake. Since the HTTP status claims success,
 * `!res.ok` alone can't see this class of failure; a caller that read
 * `geojson.features ?? []` off an error body like this got `[]` — a
 * *silent* wrong answer (0 wards for a real city), never a thrown error,
 * exactly the kind of failure AGENTS.md §0.3/§3.1 exists to prevent.
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
  const body = await res.json();
  if (body && typeof body === "object" && !Array.isArray(body) && body.error) {
    if (attempt <= maxRetries) {
      const delayMs = attempt * 2000;
      console.log(
        `[${logLabel}] upstream returned an error body (${body.error.message ?? "no message"}), ` +
          `retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt})...`,
      );
      await sleep(delayMs);
      return fetchJson(url, { headers, logLabel, maxRetries, attempt: attempt + 1 });
    }
    throw new Error(`Upstream error body for ${url}: ${JSON.stringify(body.error)}`);
  }
  return body;
}
