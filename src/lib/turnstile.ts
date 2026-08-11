// src/lib/turnstile.ts
//
// Server-side verification of a Cloudflare Turnstile token — the
// Community Contribution Pipeline's bot-check on submission and on every
// confirm/flag vote (AGENTS.md §2.6). Turnstile itself is already
// §2.3-permitted infrastructure (this app's host), disclosed on /privacy
// alongside the rest of §2.6's exceptions.
//
// Deliberately a friction layer, not identity verification — see
// voteDedup.ts and AGENTS.md §2.6's own explicit statement that this
// mechanism does not detect coordinated votes from distinct devices/IPs.
// Its job here is narrower: stop the cheapest, most casual abuse (a
// single script hammering the endpoint), not defeat a determined
// adversary.

export interface TurnstileVerifyDeps {
  /** Injected for tests — defaults to the runtime global `fetch`. */
  fetchImpl?: typeof fetch;
  secretKey: string;
}

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface SiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
}

/**
 * Verifies a Turnstile response token. Fails closed on every error path
 * — a network failure, a non-OK response, or unparseable JSON is treated
 * as "not verified," never as "assume it passed."
 */
export async function verifyTurnstileToken(token: string, deps: TurnstileVerifyDeps, remoteIp?: string): Promise<boolean> {
  if (!token || !token.trim()) return false;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const body = new URLSearchParams({ secret: deps.secretKey, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const res = await fetchImpl(SITEVERIFY_URL, { method: "POST", body });
    if (!res.ok) return false;
    const json = (await res.json()) as SiteverifyResponse;
    return json.success === true;
  } catch {
    return false;
  }
}
