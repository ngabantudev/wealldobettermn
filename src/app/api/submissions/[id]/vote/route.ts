// src/app/api/submissions/[id]/vote/route.ts
//
// POST /api/submissions/:id/vote — the third of AGENTS.md §2.6's four
// sanctioned dynamic routes. Turnstile-gated confirm/flag on a still-
// `pending` submission. Orchestrates:
//   1. Turnstile verification (bot-check, not identity — same posture as
//      POST /api/submissions)
//   2. dedup key + voter IP hash (voteDedup.ts) — the same salted-hash
//      discipline as everywhere else this pipeline touches an IP
//   3. castVote() — D1's own race-safe state transition; this route never
//      re-implements any of that logic, just maps its typed outcomes to
//      HTTP responses
//   4. on triggeredGraduation, ctx.waitUntil() a repository_dispatch —
//      see githubDispatch.ts's own header for why this hands off to a
//      GitHub Action rather than the Worker committing to main itself
//
// Never receives or processes a user's address — AGENTS.md §2.5 untouched.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse, type NextRequest } from "next/server";
import { GITHUB_REPO } from "@/lib/communityConfig";
import { castVote, type D1DatabaseLike, type VoteType } from "@/lib/communitySubmissions";
import { triggerRepositoryDispatch } from "@/lib/githubDispatch";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { computeDedupKey, hashIp } from "@/lib/voteDedup";

interface RouteEnv {
  DB: D1DatabaseLike;
  TURNSTILE_SECRET_KEY?: string;
  COMMUNITY_HASH_SALT?: string;
  GITHUB_DISPATCH_TOKEN?: string;
}

type RejectReason =
  | "invalid_request"
  | "turnstile_failed"
  | "not_found"
  | "already_settled"
  | "duplicate"
  | "self_confirmation_blocked"
  | "server_misconfigured";

function rejected(reason: RejectReason, message: string, status: number) {
  return NextResponse.json({ status: "rejected", reason, message }, { status });
}

// Same reasoning as POST /api/submissions' own getClientIp — Cloudflare's
// header, trustworthy inside a Worker, no fallback to a client-forgeable
// one. This value gates both vote dedup and the self-confirmation check.
function getClientIp(request: NextRequest): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

const VALID_VOTE_TYPES: VoteType[] = ["confirm", "flag"];

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: submissionId } = await context.params;
  if (!submissionId) {
    return rejected("invalid_request", "Missing submission id.", 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rejected("invalid_request", "That request wasn't valid JSON.", 400);
  }
  const { voteType, turnstileToken } = (body ?? {}) as Record<string, unknown>;
  if (typeof voteType !== "string" || !VALID_VOTE_TYPES.includes(voteType as VoteType)) {
    return rejected("invalid_request", 'voteType must be "confirm" or "flag".', 400);
  }
  if (typeof turnstileToken !== "string" || !turnstileToken.trim()) {
    return rejected("invalid_request", "The bot-check didn't complete — please try again.", 400);
  }

  const { env, ctx } = await getCloudflareContext({ async: true });
  const typedEnv = env as unknown as RouteEnv;
  const db = typedEnv.DB;
  const ip = getClientIp(request);

  // Same fail-loud posture as POST /api/submissions — see that route's
  // own comment on why a missing salt must never silently degrade to an
  // unsalted hash.
  if (!typedEnv.COMMUNITY_HASH_SALT) {
    console.error("[api/submissions/vote] COMMUNITY_HASH_SALT is not configured — refusing to hash IPs unsalted.");
    return rejected("server_misconfigured", "This feature isn't configured correctly right now — please try again later.", 500);
  }
  const salt = typedEnv.COMMUNITY_HASH_SALT;

  const turnstileOk = await verifyTurnstileToken(turnstileToken, { secretKey: typedEnv.TURNSTILE_SECRET_KEY ?? "" }, ip);
  if (!turnstileOk) {
    return rejected("turnstile_failed", "The bot-check didn't pass — please try again.", 400);
  }

  const voterIpHash = await hashIp(salt, ip);
  const dedupKey = await computeDedupKey({ salt, ip, submissionId });

  const result = await castVote(db, {
    submissionId,
    voteType: voteType as VoteType,
    dedupKey,
    createdAt: new Date().toISOString(),
    voterIpHash,
  });

  switch (result.outcome) {
    case "not_found":
      return rejected("not_found", "That submission doesn't exist.", 404);
    case "already_settled":
      return rejected(
        "already_settled",
        `This submission is no longer accepting votes (status: ${result.status}).`,
        400,
      );
    case "duplicate":
      return rejected("duplicate", "You've already voted on this submission.", 409);
    case "self_confirmation_blocked":
      return rejected(
        "self_confirmation_blocked",
        "You can't confirm your own submission — it needs a confirmation from someone else first.",
        403,
      );
    case "recorded": {
      if (result.triggeredGraduation) {
        if (!typedEnv.GITHUB_DISPATCH_TOKEN) {
          // Logged, not surfaced to the visitor — their vote was still
          // recorded correctly in D1 either way. A missing token here
          // means graduation just doesn't fire yet, not that the vote
          // failed.
          console.error("[api/submissions/vote] GITHUB_DISPATCH_TOKEN is not configured — cannot fire graduation dispatch.");
        } else {
          const token = typedEnv.GITHUB_DISPATCH_TOKEN;
          ctx.waitUntil(
            triggerRepositoryDispatch(
              "community-submission-graduated",
              { submissionId, dispatchedAt: new Date().toISOString() },
              { token, repo: GITHUB_REPO },
            ).then((dispatchResult) => {
              if (!dispatchResult.ok) {
                console.error(
                  `[api/submissions/vote] repository_dispatch for graduation of ${submissionId} failed (status ${dispatchResult.status}).`,
                );
              }
            }),
          );
        }
      }
      return NextResponse.json({
        status: "recorded",
        confirmations: result.confirmations,
        flags: result.flags,
      });
    }
  }
}
