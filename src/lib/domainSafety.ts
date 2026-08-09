// src/lib/domainSafety.ts
//
// Two automated, zero-new-vendor signals for a submitted URL, layered on
// top of (not replacing) serverFetch.ts's SSRF mitigations and
// communityExtraction.ts's structural extraction gate — the "rigorously
// tested for malware, bots, etc." half of AGENTS.md §2.6's design.
// Researched before building (2026-08): there is no licensable,
// build-time-fetchable Tier 1/2 directory of MN cities' official website
// URLs (checked League of MN Cities, MN.gov, MnGeo, MN Secretary of
// State — MN.gov's own directory page actively hCaptcha-blocks scripted
// fetches, and LMC's is copyrighted with no reuse grant), so "is this
// really the city's official site" cannot be automated as a hard
// cross-reference. What CAN be honestly automated, and is implemented
// here, is narrower: a known-bad-domain check and a structural
// authenticity heuristic. Neither is proof of legitimacy — see each
// function's own comment for exactly what it can and can't tell you.

import { queryDoh } from "./dohQuery.ts";

export interface DomainSafetyDeps {
  /** Injected for tests — defaults to the runtime global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * A positive, structural authenticity SIGNAL, not proof: `.gov` domains
 * are gated by CISA (proof of U.S. government status required before
 * issuance — see CISA's own DOTGOV fact sheet), and Minnesota's `.mn.us`
 * is issued under a similarly state-gated registrar. A submission on
 * either TLD is meaningfully more likely to be a real government site
 * than an unverified claim on a `.com`/`.org`/`.net`. The absence of a
 * gated TLD is NOT a red flag on its own — most small MN cities run on
 * an ordinary `cityofX.com`-style domain, which is completely normal and
 * must not be penalized; this signal is additive evidence only, never a
 * rejection criterion.
 */
export function isGovernmentGatedTld(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h.endsWith(".gov") || h.endsWith(".mn.us");
}

// Cloudflare's malware/phishing-blocking resolver ("1.1.1.1 for
// Families" — security.cloudflare-dns.com / 1.1.1.2) rather than the
// plain 1.1.1.1 resolver serverFetch.ts's SSRF check already uses: this
// one sinkholes or NXDOMAINs a request for a domain on Cloudflare's own
// known-malware/phishing category list. Zero new vendor relationship —
// still Cloudflare, the same host this project already trusts for
// hosting, Turnstile, and Workers AI — no API key, no documented rate
// limit at this volume (public DoH infrastructure serving ordinary DNS
// traffic at internet scale).
const SECURITY_DOH_URL = "https://security.cloudflare-dns.com/dns-query";

/**
 * Checks whether Cloudflare's malware/phishing resolver refuses to
 * resolve the given hostname — i.e. it's already on a known-bad list.
 * This is a BLOCKLIST check, not an authenticity check: a domain that
 * passes is merely "not currently known-bad," never confirmed legitimate,
 * and a brand-new spoof domain that hasn't been reported yet will pass
 * clean. Fails closed on any error (can't confirm safety → treat as
 * flagged), same posture as serverFetch.ts's own DNS pre-check. Request/
 * parse plumbing lives in dohQuery.ts, shared with serverFetch.ts's own
 * DoH check — only the interpretation of the answers differs here.
 */
export async function isDomainFlaggedMalicious(hostname: string, deps: DomainSafetyDeps = {}): Promise<boolean> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const result = await queryDoh(SECURITY_DOH_URL, hostname, fetchImpl);
  if (!result) return true;
  if (result.status !== 0) return true; // NXDOMAIN (3) or any non-NOERROR — the resolver refused to answer
  // A malware/phishing hit commonly sinkholes to 0.0.0.0 rather than
  // NXDOMAINing outright — either shape means "blocked," not "resolved."
  return result.answers.some((a) => a.type === 1 && a.data === "0.0.0.0");
}

export interface DomainSafetyResult {
  hostname: string;
  isGovernmentGatedTld: boolean;
  isFlaggedMalicious: boolean;
}

/** Runs both checks for a submitted URL's hostname — see the two functions above for what each does and doesn't mean. */
export async function checkDomainSafety(hostname: string, deps: DomainSafetyDeps = {}): Promise<DomainSafetyResult> {
  const isFlaggedMalicious = await isDomainFlaggedMalicious(hostname, deps);
  return { hostname, isGovernmentGatedTld: isGovernmentGatedTld(hostname), isFlaggedMalicious };
}
