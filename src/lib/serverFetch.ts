// src/lib/serverFetch.ts
//
// SSRF-mitigated fetch of a visitor-submitted URL — the one runtime
// third-party fetch triggered by user input anywhere in this app
// (AGENTS.md §2.6, the Community Contribution Pipeline's one disclosed
// exception to §2.3's "no runtime third-party request triggered by user
// input").
//
// Read this before trusting it: Cloudflare Workers' fetch() gives no
// low-level control over the socket/IP a request actually connects to —
// there's no Node http.Agent-equivalent hook here. Every check below is a
// pre-flight, DNS/hostname-based heuristic performed BEFORE Cloudflare's
// own fetch actually happens, not a guarantee about what happens a moment
// later. A determined DNS-rebinding attacker who flips a hostname's A
// record between our check and the platform's own resolution could evade
// this. Two things narrow the real blast radius without closing it:
// Workers egress onto Cloudflare's own public edge, not this project's
// private infrastructure (no adjacent internal service or metadata
// endpoint of OURS on the other side of a successful rebind), and this
// function is called once per submission, rate-limited upstream
// (COMMUNITY_SUBMISSION_RATE_LIMIT_PER_DAY in communityConfig.ts) — it is
// never exposed as a general-purpose URL-fetch proxy.

import {
  COMMUNITY_FETCH_MAX_BYTES,
  COMMUNITY_FETCH_MAX_REDIRECTS,
  COMMUNITY_FETCH_TIMEOUT_MS,
} from "./communityConfig.ts";

export type ServerFetchRejectReason =
  | "invalid_url"
  | "unsupported_scheme"
  | "bare_ip_hostname"
  | "blocked_hostname"
  | "private_ip_target"
  | "too_many_redirects"
  | "response_too_large"
  | "timeout"
  | "unreachable";

export type ServerFetchResult =
  | { ok: true; text: string; finalUrl: string }
  | { ok: false; reason: ServerFetchRejectReason; message: string };

export interface ServerFetchDeps {
  /** Injected for tests — defaults to the runtime global `fetch`. Used for
   * both the DNS-over-HTTPS pre-check and the actual page fetch, so a
   * single mock can cover both in a test. */
  fetchImpl?: typeof fetch;
}

// Plain ASCII only — an em-dash/section-sign here made the Workers
// runtime's fetch() warn on every request ("header value... contains
// non-ASCII characters... would likely result in a TypeError exception
// [in a browser]"), caught during live testing. HTTP header values are
// meant to be ASCII (or carefully-encoded, which isn't worth it for a
// User-Agent string); the citation moved to a plain "AGENTS.md section
// 2.2" instead of "§2.2".
const USER_AGENT =
  "wealldobettermn-community-contribution/1.0 (+https://wealldobettermn.org/privacy; " +
  "contact via https://github.com/ngabantudev/wealldobettermn/issues) - AGENTS.md section 2.2 Good-Citizen Fetcher";

const BLOCKED_HOSTNAMES = new Set(["localhost"]);
const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".internal", ".localhost"];

// Private/loopback/link-local/metadata ranges (AGENTS.md §2.6's SSRF
// discussion). Checked against DNS-resolved addresses, not just literal
// hostnames — see resolvesToPrivateAddress() below.
const PRIVATE_IPV4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // covers the 169.254.169.254 cloud-metadata address
  ["0.0.0.0", 8],
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    n = (n << 8) | value;
  }
  return n >>> 0;
}

export function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  for (const [base, bits] of PRIVATE_IPV4_RANGES) {
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) continue;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    if ((n & mask) === (baseInt & mask)) return true;
  }
  return false;
}

// Heuristic, not exhaustive (see module header): catches the common
// textual forms (::1, fc00::/7 unique-local, fe80::/10 link-local) without
// attempting full IPv6 canonicalization.
export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::1" || normalized === "::") return true;
  const firstGroup = normalized.split(":")[0];
  if (/^f[cd]/.test(firstGroup)) return true; // fc00::/7
  if (/^fe[89ab]/.test(firstGroup)) return true; // fe80::/10
  return false;
}

export function looksLikeBareIp(hostname: string): boolean {
  if (ipv4ToInt(hostname) !== null) return true;
  const stripped = hostname.replace(/^\[|\]$/g, "");
  return stripped.includes(":"); // IPv6 literal
}

export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  return BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

/**
 * DNS-over-HTTPS pre-check against Cloudflare's own resolver — already
 * §2.3-permitted infrastructure (this repo's host), not a new third party.
 * Fails closed: any error, non-OK response, or empty answer set is treated
 * as "can't confirm this is safe," never as "assume it's fine."
 */
export async function resolvesToPrivateAddress(hostname: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`, {
      headers: { accept: "application/dns-json" },
    });
    if (!res.ok) return true;
    const body = (await res.json()) as { Answer?: Array<{ data: string; type: number }> };
    const answers = body.Answer ?? [];
    if (answers.length === 0) return true; // nothing resolved — nothing safe to fetch
    return answers.some((a) => {
      if (a.type === 1) return isPrivateIPv4(a.data); // A record
      if (a.type === 28) return isPrivateIPv6(a.data); // AAAA record
      return false;
    });
  } catch {
    return true;
  }
}

async function preflightValidate(
  rawUrl: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; url: URL } | { ok: false; reason: ServerFetchRejectReason; message: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url", message: "That doesn't look like a valid URL." };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "unsupported_scheme", message: "Only https:// URLs are accepted." };
  }
  if (looksLikeBareIp(url.hostname)) {
    return {
      ok: false,
      reason: "bare_ip_hostname",
      message: "A city's official site should be a domain name, not a bare IP address.",
    };
  }
  if (isBlockedHostname(url.hostname)) {
    return { ok: false, reason: "blocked_hostname", message: "That hostname isn't a publicly reachable government site." };
  }
  if (await resolvesToPrivateAddress(url.hostname, fetchImpl)) {
    return { ok: false, reason: "private_ip_target", message: "That address doesn't resolve to a publicly reachable site." };
  }
  return { ok: true, url };
}

/** Reads a Response body up to a byte cap, aborting the stream early rather than buffering it unbounded. */
async function readCapped(res: Response, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false }> {
  if (!res.body) {
    const text = await res.text();
    return new TextEncoder().encode(text).length > maxBytes ? { ok: false } : { ok: true, text };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(value);
    }
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder("utf-8", { fatal: false }).decode(combined) };
}

/**
 * Fetches a visitor-submitted URL once, applying every mitigation
 * described in this module's header. Never throws — every failure mode
 * returns a typed, plain-language `message` instead, per AGENTS.md §3.3
 * "never fabricate or infer": a submission that fails here gets an honest
 * explanation shown directly to the visitor, never a guess.
 */
export async function serverFetch(rawUrl: string, deps: ServerFetchDeps = {}): Promise<ServerFetchResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let currentUrl = rawUrl;
  let hopsTaken = 0;

  for (;;) {
    const preflight = await preflightValidate(currentUrl, fetchImpl);
    if (!preflight.ok) return preflight;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), COMMUNITY_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetchImpl(preflight.url.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      });
    } catch (err) {
      clearTimeout(timeoutId);
      // Duck-typed, not `instanceof Error` — the runtime's AbortError may
      // be a DOMException rather than an Error subclass, and tests mock
      // this rejection directly rather than waiting out a real timer.
      const name = err && typeof err === "object" && "name" in err ? (err as { name?: unknown }).name : undefined;
      if (name === "AbortError") {
        return { ok: false, reason: "timeout", message: "That site took too long to respond." };
      }
      return { ok: false, reason: "unreachable", message: "That site couldn't be reached." };
    }
    clearTimeout(timeoutId);

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        return { ok: false, reason: "unreachable", message: "That site redirected without a destination." };
      }
      if (hopsTaken >= COMMUNITY_FETCH_MAX_REDIRECTS) {
        return { ok: false, reason: "too_many_redirects", message: "That site redirected too many times." };
      }
      hopsTaken += 1;
      // Re-resolved and re-validated from scratch at the top of the loop —
      // a redirect target never skips the preflight checks above.
      currentUrl = new URL(location, preflight.url).toString();
      continue;
    }

    if (!res.ok) {
      return { ok: false, reason: "unreachable", message: `That site returned an error (HTTP ${res.status}).` };
    }

    const body = await readCapped(res, COMMUNITY_FETCH_MAX_BYTES);
    if (!body.ok) {
      return { ok: false, reason: "response_too_large", message: "That page was too large to process." };
    }
    return { ok: true, text: body.text, finalUrl: preflight.url.toString() };
  }
}
