// src/lib/stateLegislatureData.ts
//
// Build-time loader for public/state-legislature.geojson — the AGENTS.md
// §2.1 "Build-Time Reads" point applied to §3.2's enforcement rule:
// "Build fails, loudly, if any record's verifiedAt predates the most
// recent general election date recorded in config."
//
// Before this file, assertVerifiedSinceLastGeneralElection (defined in
// electionConfig.ts) had no caller anywhere the app's own build actually
// runs — scripts/fetch-state-legislature.mjs calls it against records
// it's *about to write*, but nothing re-checked the file the app ships
// once it's sitting in public/. A committed file can silently go stale
// (or, as today, predate the verifiedAt field's own introduction) with
// no build signal at all. This module is that signal.
//
// loadAndValidateStateLegislatureData() is called from next.config.ts's
// production-build phase — deliberately NOT from a page or component
// module. It briefly lived as a module-scope call at the top of
// src/app/page.tsx instead, which worked for `next build`'s own static
// prerender but also got bundled into the deployed Cloudflare Worker by
// OpenNext, where the readFileSync below re-ran on every cold start
// against a filesystem that doesn't have public/ on it — a 500 on every
// request, site-wide (2026-08-06). next.config.ts is a genuinely
// build-time-only execution context (real Node process, real disk, never
// shipped to the Worker); that's where this belongs now. Do not call
// this function, or add a new readFileSync-at-module-scope pattern like
// it, from anything under src/app or src/components.
//
// A record with no `verifiedAt` field at all — the file's actual state
// as of this writing (scripts/fetch-state-legislature.mjs gained the
// field after the last real run; see git history) — is treated as
// failing this check, not passing it by default. "Cannot be shown to
// have been verified since the last general election" and "was
// verified before the last general election" are the same failure from
// a resident's point of view: neither gives any assurance the seat
// still has the person we're naming attached to it.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { FeatureCollection } from "geojson";
import {
  MN_STATE_GENERAL_ELECTION_DATE,
  assertVerifiedSinceLastGeneralElection,
} from "./electionConfig";

const PUBLIC_PATH = "public/state-legislature.geojson";
const DATA_PATH = path.join(process.cwd(), PUBLIC_PATH);

const FIX_COMMAND = "OPEN_STATES_API_KEY=<your key> node scripts/fetch-state-legislature.mjs";

interface FeaturePropertiesLike {
  stateDistrict?: string | null;
  verifiedAt?: unknown;
}

function districtLabel(properties: FeaturePropertiesLike | null | undefined): string {
  return properties?.stateDistrict ? `district ${properties.stateDistrict}` : "an unidentified district";
}

/**
 * Throws if any feature's `properties.verifiedAt` is missing or predates
 * the most recent MN state general election. Exported (not just used
 * internally) so a future consumer of the same file — an export script,
 * a test — can run the identical check without re-reading disk.
 */
export function validateStateLegislatureVerification(featureCollection: FeatureCollection): void {
  for (const feature of featureCollection.features) {
    const properties = feature.properties as FeaturePropertiesLike | null;
    const verifiedAt = properties?.verifiedAt;

    if (typeof verifiedAt !== "string" || verifiedAt.length === 0) {
      throw new Error(
        `[stale-verification] ${PUBLIC_PATH}: the feature for ${districtLabel(properties)} has no ` +
          `"verifiedAt" field on its properties. AGENTS.md §3.2 requires every officeholder record to ` +
          `carry a verifiedAt date, and a record that cannot be shown to have been verified since the ` +
          `most recent general election (${MN_STATE_GENERAL_ELECTION_DATE}) fails the same check as ` +
          `one that's provably too old. Regenerate this file with a live Open States API key:\n\n` +
          `  ${FIX_COMMAND}\n\n` +
          `See src/lib/electionConfig.ts and scripts/fetch-state-legislature.mjs.`,
      );
    }

    assertVerifiedSinceLastGeneralElection(
      verifiedAt,
      MN_STATE_GENERAL_ELECTION_DATE,
      `${PUBLIC_PATH} properties.verifiedAt (${districtLabel(properties)})`,
    );
  }
}

/**
 * Reads and validates public/state-legislature.geojson from disk. Called
 * at module scope from src/app/page.tsx so the check runs during
 * `next build`'s static prerender, not deferred to a client-side fetch
 * that a build could otherwise sail past.
 */
export function loadAndValidateStateLegislatureData(): FeatureCollection {
  const raw = readFileSync(DATA_PATH, "utf-8");
  const featureCollection = JSON.parse(raw) as FeatureCollection;
  validateStateLegislatureVerification(featureCollection);
  return featureCollection;
}
