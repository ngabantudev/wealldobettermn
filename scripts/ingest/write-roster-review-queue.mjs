#!/usr/bin/env node
// scripts/ingest/write-roster-review-queue.mjs
//
// Stub for FEATURES.md Phase 5 step 6: "Surface changes in an admin
// review queue before publishing." This is NOT the review UI — it's the
// static contract a future admin surface would read from.
//
// A per-jurisdiction ingest script (state legislature, Minneapolis LIMS,
// Legistar) is expected to:
//   1. Fetch its current roster.
//   2. Load its previous snapshot (wherever that jurisdiction's ingest
//      persists it — out of scope here).
//   3. Call diffRoster() from ./roster-diff.mjs.
//   4. Append the returned `event` (if any) to the list this script
//      writes out, via appendPendingRosterChanges().
//
// Nothing in this file calls an upstream API or invents roster data —
// it only serializes events that a real diffRoster() call already
// produced. Running this file directly writes an empty queue, which is
// the honest state before any jurisdiction is wired up (AGENTS.md §3.1:
// an empty state is a known gap, not fabricated data).
//
// Where a real review UI would hook in: an admin route (e.g.
// /admin/roster-changes, gated outside the public build per AGENTS.md
// §2.1's server-boundary rule) would read this same JSON shape, let a
// human mark each event `reviewed: true` / `published: true`, and only
// then would the corresponding mutations be applied to the committed
// `holding` data. This script defines the shape that route would consume
// and produce; it does not implement the route itself.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REVIEW_QUEUE_PATH = path.join(__dirname, "../../public/roster-changes-pending.json");

/**
 * Read the current pending-review queue, or an empty one if it doesn't
 * exist yet (first run).
 *
 * @param {string} [filePath]
 * @returns {Promise<{schemaVersion: number, generatedAt: string | null, events: Array<Record<string, unknown>>}>}
 */
export async function readPendingQueue(filePath = REVIEW_QUEUE_PATH) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      return { schemaVersion: 1, generatedAt: null, events: [] };
    }
    throw err;
  }
}

/**
 * Append `roster_change` events (as produced by diffRoster()) to the
 * pending review queue and write it back out. Events already marked
 * `reviewed: true` are preserved as-is — this only adds new, unreviewed
 * events; it never overwrites a human's review decision.
 *
 * @param {Array<Record<string, unknown>>} events
 * @param {string} [filePath]
 */
export async function appendPendingRosterChanges(events, filePath = REVIEW_QUEUE_PATH) {
  const queue = await readPendingQueue(filePath);
  queue.events.push(...events);
  queue.generatedAt = new Date().toISOString();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
  return queue;
}

// Run directly (`node scripts/ingest/write-roster-review-queue.mjs`):
// ensures the public contract file exists with an honest empty queue,
// rather than a missing file or fabricated example data.
if (import.meta.url === `file://${process.argv[1]}`) {
  const queue = await readPendingQueue();
  await mkdir(path.dirname(REVIEW_QUEUE_PATH), { recursive: true });
  queue.generatedAt = new Date().toISOString();
  await writeFile(REVIEW_QUEUE_PATH, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
  console.log(
    `[roster-review-queue] wrote ${REVIEW_QUEUE_PATH} with ${queue.events.length} pending event(s).`,
  );
}
