// src/app/api/submissions/route.ts
//
// POST /api/submissions — the Community Contribution Pipeline's entry
// point (AGENTS.md §2.6). This app's first dynamic route ever, per that
// section's own §2.1 exception. Orchestrates, in order:
//   1. rate limiting (per hashed-IP, migrations/0002)
//   2. Turnstile verification (bot-check, not identity)
//   3. city recognition (cityMatch.ts) — real MN city? already covered?
//   4. duplicate-pending check (one live submission per city)
//   5. domain safety (domainSafety.ts — malware blocklist + .gov/.mn.us signal)
//   6. SSRF-safe fetch of the submitted URL (serverFetch.ts)
//   7. extraction behind the four-layer structural gate (communityExtraction.ts)
//   8. insert the resulting `pending` row (communitySubmissions.ts)
//
// Every rejection returns a typed `reason` and a plain-language `message`
// meant to be shown directly to the visitor — AGENTS.md §3.3 "never
// fabricate or infer": a submission that fails anywhere in this chain
// gets an honest explanation, never a guess, and never a partial insert.
//
// `env` typing: this repo has no `@cloudflare/workers-types` dependency
// and no generated cloudflare-env.d.ts (gitignored, requires a live
// `wrangler login`) — same reasoning as communitySubmissions.ts's
// hand-rolled D1DatabaseLike and communityExtraction.ts's
// CommunityAiBinding. RouteEnv below is a narrow, local cast rather than
// pulling in that dependency for two field names.

import { randomUUID } from "node:crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse, type NextRequest } from "next/server";
import {
  COMMUNITY_SUBMISSION_RATE_LIMIT_PER_DAY,
  COMMUNITY_CONFIRMATIONS_REQUIRED,
} from "@/lib/communityConfig";
import { matchCity } from "@/lib/cityMatch";
import { checkDomainSafety } from "@/lib/domainSafety";
import { serverFetch } from "@/lib/serverFetch";
import { extractOfficials, type CommunityAiBinding } from "@/lib/communityExtraction";
import {
  countRecentSubmissionAttempts,
  getPendingSubmissionForCity,
  insertSubmission,
  recordSubmissionAttempt,
  type D1DatabaseLike,
} from "@/lib/communitySubmissions";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { hashIp } from "@/lib/voteDedup";

interface RouteEnv {
  DB: D1DatabaseLike;
  AI: CommunityAiBinding;
  TURNSTILE_SECRET_KEY?: string;
  COMMUNITY_HASH_SALT?: string;
}

type RejectReason =
  | "invalid_request"
  | "rate_limited"
  | "turnstile_failed"
  | "city_not_recognized"
  | "city_already_covered"
  | "duplicate_pending"
  | "domain_flagged_malicious"
  | "invalid_url"
  | "unsupported_scheme"
  | "bare_ip_hostname"
  | "blocked_hostname"
  | "private_ip_target"
  | "too_many_redirects"
  | "response_too_large"
  | "timeout"
  | "unreachable"
  | "no_city_name_evidence"
  | "no_officials_survived"
  | "model_output_unparseable"
  | "model_error";

function rejected(reason: RejectReason, message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ status: "rejected", reason, message, ...extra }, { status });
}

function getClientIp(request: NextRequest): string {
  // Cloudflare's own header, set at the edge — trustworthy inside a
  // Worker (unlike x-forwarded-for, which a client could forge if this
  // were reached directly rather than through Cloudflare's network).
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rejected("invalid_request", "That request wasn't valid JSON.", 400);
  }
  const { cityName, sourceUrl, turnstileToken } = (body ?? {}) as Record<string, unknown>;
  if (typeof cityName !== "string" || !cityName.trim() || typeof sourceUrl !== "string" || !sourceUrl.trim()) {
    return rejected("invalid_request", "A city name and a URL are both required.", 400);
  }
  if (typeof turnstileToken !== "string" || !turnstileToken.trim()) {
    return rejected("invalid_request", "The bot-check didn't complete — please try again.", 400);
  }

  const { env } = await getCloudflareContext({ async: true });
  const typedEnv = env as unknown as RouteEnv;
  const db = typedEnv.DB;
  const salt = typedEnv.COMMUNITY_HASH_SALT ?? "";
  const ip = getClientIp(request);

  // 1. Rate limit — checked before doing any real work, so a limited
  // visitor's request is cheap to reject.
  const ipHash = await hashIp(salt, ip);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentAttempts = await countRecentSubmissionAttempts(db, ipHash, oneDayAgo);
  if (recentAttempts >= COMMUNITY_SUBMISSION_RATE_LIMIT_PER_DAY) {
    return rejected("rate_limited", "You've submitted a few of these already today — please try again tomorrow.", 429);
  }
  await recordSubmissionAttempt(db, ipHash, new Date().toISOString());

  // 2. Turnstile — a friction layer against casual bot abuse, not identity
  // verification (AGENTS.md §2.6).
  const turnstileOk = await verifyTurnstileToken(turnstileToken, { secretKey: typedEnv.TURNSTILE_SECRET_KEY ?? "" }, ip);
  if (!turnstileOk) {
    return rejected("turnstile_failed", "The bot-check didn't pass — please try again.", 400);
  }

  // 3. City recognition — real MN city we have an anchor point for, and
  // not already one this app has officials data for (§2.6 "Scope": brand-
  // new cities only; corrections to an existing roster are out of scope).
  const cityMatchResult = matchCity(cityName);
  if (!cityMatchResult.recognized) {
    return rejected("city_not_recognized", `"${cityName}" doesn't match a Minnesota city this map recognizes.`, 400);
  }
  if (cityMatchResult.alreadyCovered) {
    return rejected(
      "city_already_covered",
      `${cityMatchResult.canonicalName} already has officials data on this site. This pipeline is for brand-new cities only — see /privacy for how to report a correction instead.`,
      400,
    );
  }
  const canonicalCityName = cityMatchResult.canonicalName as string;

  // 4. Duplicate-pending check — a fast, friendly rejection before the
  // fetch/extraction work; idx_one_pending_per_city is the real guarantee
  // underneath this (see insertSubmission's own comment), so a race here
  // still can't produce two live submissions for the same city.
  const existingPending = await getPendingSubmissionForCity(db, canonicalCityName);
  if (existingPending) {
    return rejected(
      "duplicate_pending",
      `${canonicalCityName} already has a pending submission awaiting confirmation.`,
      409,
      { submissionId: existingPending.id },
    );
  }

  // 5. Domain safety — a known-bad-domain blocklist check and a .gov/
  // .mn.us structural signal (domainSafety.ts). Neither proves
  // legitimacy; the blocklist hit is what actually disqualifies.
  let hostname: string;
  try {
    hostname = new URL(sourceUrl).hostname;
  } catch {
    return rejected("invalid_url", "That doesn't look like a valid URL.", 400);
  }
  const domainSafety = await checkDomainSafety(hostname);
  if (domainSafety.isFlaggedMalicious) {
    return rejected(
      "domain_flagged_malicious",
      "That site is on a known malware/phishing list and can't be accepted.",
      400,
    );
  }

  // 6. SSRF-safe fetch — see serverFetch.ts's own header for exactly what
  // this does and doesn't guarantee on this platform.
  const fetchResult = await serverFetch(sourceUrl);
  if (!fetchResult.ok) {
    return rejected(fetchResult.reason as RejectReason, fetchResult.message, 400);
  }

  // 7. Extraction behind the four-layer structural gate — see
  // communityExtraction.ts's own header for what each layer catches.
  const extraction = await extractOfficials({ ai: typedEnv.AI, pageHtml: fetchResult.text, cityName: canonicalCityName });
  if (!extraction.ok) {
    return rejected(extraction.reason as RejectReason, extraction.message, 400, { rejectedMentions: extraction.rejectedMentions });
  }

  // 8. Insert the pending row. idx_one_pending_per_city is the last line
  // of defense against a race with step 4 above — if it fires, treat it
  // the same as a duplicate-pending rejection rather than a 500.
  const submissionId = randomUUID();
  try {
    await insertSubmission(db, {
      id: submissionId,
      cityName: canonicalCityName,
      gnisId: cityMatchResult.gnisId,
      sourceUrl,
      officials: extraction.officials,
      submittedAt: new Date().toISOString(),
    });
  } catch {
    return rejected(
      "duplicate_pending",
      `${canonicalCityName} already has a pending submission awaiting confirmation.`,
      409,
    );
  }

  return NextResponse.json({
    status: "pending",
    submissionId,
    cityMatched: canonicalCityName,
    extracted: { officials: extraction.officials },
    rejectedMentions: extraction.rejectedMentions,
    confirmationsNeeded: COMMUNITY_CONFIRMATIONS_REQUIRED,
    domainSafety,
  });
}
