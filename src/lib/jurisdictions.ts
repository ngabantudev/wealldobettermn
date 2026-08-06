// src/lib/jurisdictions.ts
//
// The registry half of AGENTS.md §2.1's two-file pattern for this layer:
// scripts/fetch-state-legislature.mjs is the fetch/ingest script, this is
// "one entry in the layer registry under src/lib/." One Jurisdiction
// record (src/lib/models.ts) per jurisdiction this repo tracks at the
// entity-model level — currently just the one FEATURES.md Phase 1 asks
// for. Add a row here, not a hardcoded string in a component, the next
// time a jurisdiction's entity data (as opposed to its map layer) is
// wired up.
//
// This registry is deliberately scoped to the `Jurisdiction` entity only
// — offices, holdings, bodies, etc. are not seeded here. Wiring the rest
// of the relational model to a real, ingested dataset is future work; see
// the PR description for what's deferred.

import type { Jurisdiction } from "./models";

export const JURISDICTIONS: readonly Jurisdiction[] = [
  {
    id: "mn-state-legislature",
    name: "Minnesota State Legislature",
    level: "state",
    ocd_id: "ocd-division/country:us/state:mn",
    // Honest, not flattering: scripts/fetch-state-legislature.mjs ingests
    // a full roster and a sample of recent roll-call votes, but no
    // meetings or agenda_item data (the House/Senate don't publish a
    // Legistar-shaped meetings feed the way Minneapolis/St. Paul do).
    // That combination — roster + partial votes, no meetings/agendas —
    // doesn't cleanly fit the A (full votes+meetings+agendas) / B
    // (meetings+agendas, no votes) / C (roster+contact only) ladder
    // FEATURES.md defines. Tiered C here because C's stated bar ("roster
    // + contact info only") is the closest true floor this jurisdiction
    // clears without over-claiming; the roll-call sample is real but
    // partial and not yet a structural guarantee the way a Legistar
    // `/votes` endpoint would be. Revisit once vote coverage is complete
    // enough to claim, or once the tier definitions themselves grow a
    // rung for this case — tracked as a knownGaps-style note rather than
    // picked silently.
    coverage_tier: "C",
  },
] as const;

export function getJurisdiction(id: string): Jurisdiction | undefined {
  return JURISDICTIONS.find((j) => j.id === id);
}
