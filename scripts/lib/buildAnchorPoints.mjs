// scripts/lib/buildAnchorPoints.mjs
//
// Shared logic behind build-city-anchor-points.mjs and
// build-county-anchor-points.mjs — both scripts do exactly the same
// thing (read an already-fetched statewide boundary GeoJSON, compute one
// guaranteed-interior anchor point per feature via
// @turf/point-on-feature, write a small sorted/deterministic JSON
// artifact) over a different entity shape. Factored out here after a
// /simplify pass flagged the two as a near-total copy-paste of each
// other — see either script's own header for why the artifact itself
// needs to exist (AGENTS.md §2.6, Community Contribution Pipeline).
//
// Deterministic and re-runnable (AGENTS.md §2.2): same boundaries file
// bytes in, byte-identical output out — no generated-at timestamp, no
// random IDs.

import { readFile, writeFile } from "node:fs/promises";
import { pointOnFeature } from "@turf/point-on-feature";
import { updateDataManifest } from "./dataManifest.mjs";

const SCHEMA_VERSION = 1;

/**
 * @param {object} options
 * @param {string} options.entityNoun - "city" | "county" — used in log/error text only.
 * @param {string} options.boundariesFilename - e.g. "city-boundaries.geojson", for error messages.
 * @param {string} options.boundariesPath - absolute path to the source GeoJSON.
 * @param {string} options.outputPath - absolute path to write the anchor-points JSON to.
 * @param {string} options.outputFilename - basename, for the data manifest entry.
 * @param {number} options.minExpectedFeatures - sanity floor; below this the source looks stale/truncated.
 * @param {string} options.refetchHint - e.g. "Run `npm run data:city-boundaries` first."
 * @param {boolean} [options.duplicatesExpected] - true for cities (a name can legitimately repeat across
 *   counties — see build-county-cities.mjs's own Blaine handling), false for counties (every MN county
 *   name is unique, so a duplicate here signals an upstream data quirk rather than a normal collision).
 *   Only changes the log wording, not the behavior — either way, only the first occurrence is kept and
 *   every duplicate is reported, never silently dropped.
 */
export async function buildAnchorPointsFile({
  entityNoun,
  boundariesFilename,
  boundariesPath,
  outputPath,
  outputFilename,
  minExpectedFeatures,
  refetchHint,
  duplicatesExpected = false,
}) {
  const logPrefix = `[build-${entityNoun}-anchor-points]`;

  const features = await loadBoundaries({ boundariesFilename, boundariesPath, minExpectedFeatures, refetchHint });
  const points = buildAnchorPoints({ features, entityNoun, boundariesFilename, logPrefix, duplicatesExpected });

  const output = { schemaVersion: SCHEMA_VERSION, points };
  const contents = JSON.stringify(output, null, 2) + "\n";
  await writeFile(outputPath, contents);
  await updateDataManifest(outputFilename, contents);
  console.log(`${logPrefix} wrote ${Object.keys(points).length} anchor points to ${outputPath}`);
}

async function loadBoundaries({ boundariesFilename, boundariesPath, minExpectedFeatures, refetchHint }) {
  let raw;
  try {
    raw = await readFile(boundariesPath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`public/${boundariesFilename} not found. ${refetchHint}`);
    }
    throw err;
  }

  let geojson;
  try {
    geojson = JSON.parse(raw);
  } catch {
    throw new Error(`public/${boundariesFilename} is not valid JSON (corrupt/truncated write?). ${refetchHint}`);
  }

  const features = geojson.features ?? [];
  if (features.length < minExpectedFeatures) {
    throw new Error(
      `public/${boundariesFilename} only has ${features.length} feature(s), expected at least ${minExpectedFeatures} — looks stale or truncated. ${refetchHint}`,
    );
  }
  return features;
}

/**
 * One anchor point per feature. Throws on any feature this can't place —
 * a silently-skipped feature here is a silent coverage gap in the
 * Community Contribution Pipeline's plausibility gate later (a
 * legitimately-submitted city/county could be wrongly rejected as "not
 * recognized"), so a bad input feature fails the whole build rather than
 * producing an incomplete file (AGENTS.md §3.1 "never fabricate or
 * silently drop").
 */
function buildAnchorPoints({ features, entityNoun, boundariesFilename, logPrefix, duplicatesExpected }) {
  /** @type {Record<string, { gnisId: number | null, lng: number, lat: number }>} */
  const points = {};
  const duplicates = [];

  for (const feature of features) {
    const props = feature.properties ?? {};
    const name = props.name;
    if (!name) {
      throw new Error(`A ${boundariesFilename} feature is missing its "name" property (gnisId: ${props.gnisId ?? "unknown"}).`);
    }
    if (Object.prototype.hasOwnProperty.call(points, name)) {
      duplicates.push(name);
      continue;
    }

    let anchor;
    try {
      anchor = pointOnFeature(feature);
    } catch (err) {
      throw new Error(`Could not compute an anchor point for "${name}" (gnisId: ${props.gnisId ?? "unknown"}): ${err.message}`);
    }
    const [lng, lat] = anchor.geometry.coordinates;
    points[name] = { gnisId: props.gnisId ?? null, lng, lat };
  }

  if (duplicates.length > 0) {
    const consequence = duplicatesExpected
      ? `Community submissions matching one of these names will resolve to whichever occurrence was listed first in ${boundariesFilename}.`
      : `Every MN ${entityNoun} name is expected to be unique — this signals an upstream data quirk worth checking.`;
    console.warn(`${logPrefix} ${duplicates.length} duplicate ${entityNoun} name(s) kept only their first occurrence: ${duplicates.join(", ")}. ${consequence}`);
  }

  // Sorted keys: deterministic, diff-friendly output regardless of the
  // source file's own feature order.
  return Object.fromEntries(Object.keys(points).sort().map((name) => [name, points[name]]));
}
