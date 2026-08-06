#!/usr/bin/env node
// scripts/ingest/agenda-versions.mjs
//
// Phase 6 (FEATURES.md): "handle amended agendas — keep both versions,
// diff them, show what changed." This module owns that bookkeeping so
// individual fetch scripts don't reinvent it. It never overwrites a
// prior AgendaItemSnapshot — see src/lib/types.ts for the versioned
// shapes this operates on (AGENTS.md §0.5: "a map that silently
// overwrites its own history is worse than no map").
//
// Dependency-light per AGENTS.md §0.8: no dependencies at all.
//
// @typedef {import("../../src/lib/types.js").AgendaItem} AgendaItem
// @typedef {import("../../src/lib/types.js").AgendaItemSnapshot} AgendaItemSnapshot
// @typedef {import("../../src/lib/types.js").AgendaItemDiff} AgendaItemDiff

const DIFFED_FIELDS = /** @type {const} */ (["title", "description", "documentHash"]);

/**
 * Append a new snapshot to an agenda item's version history. Never
 * mutates or drops an existing version — an amendment is recorded as a
 * new entry, not an edit in place, so `versions` is always the full,
 * walkable amendment trail.
 *
 * @param {AgendaItem | null} existing - the current record, or null if this is the first time this agendaItemId has been seen.
 * @param {Omit<AgendaItemSnapshot, "version" | "supersedesVersion">} nextSnapshot
 * @returns {AgendaItem}
 */
export function appendAgendaItemVersion(existing, nextSnapshot) {
  if (existing && existing.agendaItemId !== nextSnapshot.agendaItemId) {
    throw new Error(
      `appendAgendaItemVersion: agendaItemId mismatch ("${existing.agendaItemId}" vs "${nextSnapshot.agendaItemId}")`
    );
  }

  const priorVersion = existing ? existing.currentVersion : 0;
  const version = priorVersion + 1;

  /** @type {AgendaItemSnapshot} */
  const snapshot = {
    ...nextSnapshot,
    version,
    supersedesVersion: existing ? priorVersion : null,
  };

  return {
    agendaItemId: nextSnapshot.agendaItemId,
    currentVersion: version,
    versions: existing ? [...existing.versions, snapshot] : [snapshot],
  };
}

/**
 * A simple record-level diff between two snapshots of the same agenda
 * item — "what changed when this got amended," not a general-purpose
 * deep-diff. Only the fields a resident would care about (title,
 * description, which archived document it now points at) are compared.
 *
 * @param {AgendaItemSnapshot} before
 * @param {AgendaItemSnapshot} after
 * @returns {AgendaItemDiff}
 */
export function diffAgendaItemSnapshots(before, after) {
  if (before.agendaItemId !== after.agendaItemId) {
    throw new Error(
      `diffAgendaItemSnapshots: agendaItemId mismatch ("${before.agendaItemId}" vs "${after.agendaItemId}")`
    );
  }

  const changedFields = DIFFED_FIELDS.filter((field) => before[field] !== after[field]).map((field) => ({
    field,
    before: before[field],
    after: after[field],
  }));

  return {
    agendaItemId: before.agendaItemId,
    fromVersion: before.version,
    toVersion: after.version,
    changedFields,
  };
}
