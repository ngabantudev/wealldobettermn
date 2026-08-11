// src/app/api/submissions/[id]/dispute/route.ts
//
// POST /api/submissions/:id/dispute — the fourth and last of AGENTS.md
// §2.6's sanctioned dynamic routes. Post-graduation only: the deliberately
// asymmetric safety valve for the zero-pre-commit-review graduation
// design (see communityConfig.ts's COMMUNITY_GRADUATION_DISPUTE_THRESHOLD
// and COMMUNITY_CONFIRMATIONS_REQUIRED for the full reasoning). At
// threshold, hands off to a GitHub Action (via the same repository_dispatch
// mechanism POST /api/submissions/:id/vote uses for graduation) that does
// the actual `git revert` + opens an unmerged PR + opens an issue tagging
// the maintainer — nothing merges automatically here, deliberately: an
// automatic revert would recreate the same Sybil risk graduation itself
// already accepts, one level later.
//
// No voteType (there's only ever one kind of post-graduation action), and
// no self-confirmation-style check — disputing your own already-graduated
// submission isn't the same failure mode POST .../vote's block exists for;
// a submitter flagging their own past mistake is a legitimate use of this
// endpoint, not an attack on it.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse, type NextRequest } from "next/server";
import { GITHUB_REPO } from "@/lib/communityConfig";
import { recordDispute, type D1DatabaseLike } from "@/lib/communitySubmissions";
import { triggerRepositoryDispatch } from "@/lib/githubDispatch";
import { verifyTurnstileToken } from "@/lib/turnstile";

interface RouteEnv {
  DB: D1DatabaseLike;
  TURNSTILE_SECRET_KEY?: string;
  GITHUB_DISPATCH_TOKEN?: string;
}

type RejectReason = "invalid_request" | "turnstile_failed" | "not_found_or_not_graduated" | "server_misconfigured";

function rejected(reason: RejectReason, message: string, status: number) {
  return NextResponse.json({ status: "rejected", reason, message }, { status });
}

function getClientIp(request: NextRequest): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

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
  const { turnstileToken } = (body ?? {}) as Record<string, unknown>;
  if (typeof turnstileToken !== "string" || !turnstileToken.trim()) {
    return rejected("invalid_request", "The bot-check didn't complete — please try again.", 400);
  }

  const { env, ctx } = await getCloudflareContext({ async: true });
  const typedEnv = env as unknown as RouteEnv;
  const db = typedEnv.DB;
  const ip = getClientIp(request);

  const turnstileOk = await verifyTurnstileToken(turnstileToken, { secretKey: typedEnv.TURNSTILE_SECRET_KEY ?? "" }, ip);
  if (!turnstileOk) {
    return rejected("turnstile_failed", "The bot-check didn't pass — please try again.", 400);
  }

  const result = await recordDispute(db, submissionId);
  if (!result) {
    return rejected(
      "not_found_or_not_graduated",
      "That submission doesn't exist, or hasn't graduated yet — disputes only apply to already-published records.",
      404,
    );
  }

  if (result.triggeredRevertIssue) {
    if (!typedEnv.GITHUB_DISPATCH_TOKEN) {
      console.error("[api/submissions/dispute] GITHUB_DISPATCH_TOKEN is not configured — cannot fire revert dispatch.");
    } else {
      const token = typedEnv.GITHUB_DISPATCH_TOKEN;
      ctx.waitUntil(
        triggerRepositoryDispatch(
          "community-submission-disputed",
          { submissionId, dispatchedAt: new Date().toISOString() },
          { token, repo: GITHUB_REPO },
        ).then((dispatchResult) => {
          if (!dispatchResult.ok) {
            console.error(
              `[api/submissions/dispute] repository_dispatch for revert of ${submissionId} failed (status ${dispatchResult.status}).`,
            );
          }
        }),
      );
    }
  }

  return NextResponse.json({
    status: "recorded",
    disputeCount: result.disputeCount,
  });
}
