// src/lib/githubDispatch.ts
//
// Fires a GitHub `repository_dispatch` event — the one mechanism the
// Worker uses to hand off both graduation and post-graduation-dispute
// work to a GitHub Action, rather than doing git/GitHub-API work itself
// inside a request handler (AGENTS.md §2.6). Two event types, one
// function:
//   - "community-submission-graduated", fired by POST
//     /api/submissions/:id/vote when castVote()'s triggeredGraduation
//     comes back true — a dedicated Action commits the graduated record
//     to public/mayors.geojson on main, with no human review at the
//     moment of publish (the named risk acceptance AGENTS.md §2.6
//     documents in full).
//   - "community-submission-disputed", fired by POST
//     /api/submissions/:id/dispute when recordDispute()'s
//     triggeredRevertIssue comes back true — a dedicated Action does the
//     actual `git revert` + opens an unmerged PR + opens an issue tagging
//     the maintainer. Deliberately NOT built as direct Issues/Git-Data/
//     Pulls API calls from inside this fetch handler (a real,
//     considered alternative — more Worker-side complexity and a second
//     write-scope surface for no real benefit over reusing this same
//     dispatch mechanism a second time).
//
// Always called via `ctx.waitUntil(...)` by its route callers — a failed
// dispatch should never fail the vote/dispute request itself (the vote
// was still recorded in D1 either way), just get logged so it's
// diagnosable. This module itself never throws.

export interface GithubDispatchDeps {
  /** Injected for tests — defaults to the runtime global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Fine-grained PAT scoped to this repo only, `repository_dispatch` write. */
  token: string;
  /** e.g. "ngabantudev/wealldobettermn". */
  repo: string;
}

export type DispatchEventType = "community-submission-graduated" | "community-submission-disputed";

export interface DispatchResult {
  ok: boolean;
  status: number;
}

/**
 * Fires one repository_dispatch event. Never throws — a network failure
 * or a non-2xx GitHub response comes back as `{ ok: false, status }`
 * (status 0 for a network-level failure, since there's no HTTP response
 * to read a status from) for the caller to log, not to react to
 * synchronously.
 */
export async function triggerRepositoryDispatch(
  eventType: DispatchEventType,
  clientPayload: Record<string, unknown>,
  deps: GithubDispatchDeps,
): Promise<DispatchResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = `https://api.github.com/repos/${deps.repo}/dispatches`;

  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${deps.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "wealldobettermn-worker/0.1 (contact: steveyang.dev@proton.me)",
      },
      body: JSON.stringify({ event_type: eventType, client_payload: clientPayload }),
    });
    // GitHub's dispatches endpoint returns 204 No Content on success —
    // res.ok (2xx) is the only signal available, there's no body to parse.
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
