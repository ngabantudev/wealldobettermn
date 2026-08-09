// src/lib/voteDedup.ts
//
// Computes the salted, one-way, day-bucketed dedup key for a community
// submission vote (AGENTS.md §2.6). This is the narrow, disclosed
// exception to §0.12/§1b's "leaves no trace" posture — see this module's
// own constraints before touching it:
//
//   - The visitor's raw IP is NEVER stored, logged, or returned by this
//     module — only sha256(salt + ip + submissionId + dayBucket) is ever
//     produced, and the caller stores only that hash (see
//     migrations/0001_community_submissions.sql's votes.dedup_key).
//   - The salt is per-deployment (a Worker secret, never committed, never
//     logged) — without it, the hash alone doesn't let anyone reconstruct
//     or dictionary-attack the original IP even if the `votes` table
//     leaked.
//   - The day bucket (COMMUNITY_VOTE_DEDUP_WINDOW_DAYS) means the SAME
//     visitor voting on the SAME submission tomorrow produces a
//     DIFFERENT key — this is a short-lived friction layer, not a
//     durable identity, matching AGENTS.md §2.6's explicit statement that
//     Turnstile + this hash is "not identity verification."
//
// Uses Web Crypto (`crypto.subtle`), available identically in Cloudflare
// Workers and in Node — no new dependency, no environment-specific code.

import { COMMUNITY_VOTE_DEDUP_WINDOW_DAYS } from "./communityConfig.ts";

/** UTC day-bucket string, e.g. "2026-08-09" — granularity matches COMMUNITY_VOTE_DEDUP_WINDOW_DAYS when that's 1. */
function dayBucket(now: Date, windowDays: number): string {
  const epochDays = Math.floor(now.getTime() / (windowDays * 24 * 60 * 60 * 1000));
  return String(epochDays);
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface ComputeDedupKeyParams {
  /** A per-deployment secret (Worker secret, never committed). */
  salt: string;
  /** The visitor's IP address — consumed here and never returned or stored by the caller. */
  ip: string;
  submissionId: string;
  now?: Date;
  windowDays?: number;
}

/**
 * Returns a one-way hash suitable for storing in `votes.dedup_key` — the
 * only thing this function's result is ever used for. Never reconstructs
 * or exposes the original IP.
 */
export async function computeDedupKey(params: ComputeDedupKeyParams): Promise<string> {
  const now = params.now ?? new Date();
  const windowDays = params.windowDays ?? COMMUNITY_VOTE_DEDUP_WINDOW_DAYS;
  const bucket = dayBucket(now, windowDays);
  return sha256Hex(`${params.salt}:${params.ip}:${params.submissionId}:${bucket}`);
}
