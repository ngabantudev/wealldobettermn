#!/usr/bin/env node
// scripts/ingest/probe-legistar.mjs
//
// FEATURES.md Phase 7, step 2: "Probe for Legistar —
// webapi.legistar.com/v1/{guess}/bodies is cheap to test, any hit
// promotes that city straight to Tier A; do this before writing a single
// scraper." This is that probe and nothing else — no scraping, no vote
// ingestion. A hit only proves a Legistar client instance exists for a
// guessed slug; wiring up the actual votes/meetings/agenda ingest for a
// promoted city is separate, later work.
//
// Deliberately dependency-free (no fetch wrapper library) and read-only:
// every request is a plain GET against a public, unauthenticated Legistar
// endpoint, capped at one in flight at a time with a pause between
// requests, and identified with a real User-Agent + contact per AGENTS.md
// §2.2's Good-Citizen Fetcher rule. This is a "cheap to test" probe, not a
// bulk scrape — CANDIDATE_SLUGS below should stay a short, deliberately
// curated list, not every city in cities.ts guessed at once.
//
// Usage: node scripts/ingest/probe-legistar.mjs
// Writes results into public/jurisdiction-platform-inventory.json,
// updating only the cities it actually probed — every other record in
// that file is left exactly as the seed step wrote it (AGENTS.md §3.3
// Coverage Honesty: an unprobed city stays "unknown", never guessed).

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INVENTORY_PATH = path.join(__dirname, "../../public/jurisdiction-platform-inventory.json");

const USER_AGENT = "wealldobettermn-etl/0.1 (github.com/ngabantudev/wealldobettermn; +https://github.com/ngabantudev/wealldobettermn/issues)";

// Good-citizen pacing (AGENTS.md §2.2): one request in flight, a pause
// between each. This probe hits at most a handful of cities per run, so
// there's no need to be any more aggressive than this.
const REQUEST_DELAY_MS = 1500;
const REQUEST_TIMEOUT_MS = 10_000;

// Candidate Legistar client slugs to test, keyed by the city name as it
// appears in src/lib/cities.ts's CITIES (so results merge back onto the
// seeded inventory by exact match). A city can carry more than one guess
// (Legistar client slugs aren't always the obvious one); the first slug
// that returns a hit wins and the rest are skipped. This list is
// intentionally short and hand-curated per the "cheap to test" framing in
// FEATURES.md Phase 7 — extend it deliberately, not by bulk-guessing every
// mapped city's name variants.
export const CANDIDATE_SLUGS = [
  { city: "Minneapolis", slugs: ["minneapolis"] },
  { city: "St. Paul", slugs: ["stpaul"] },
  { city: "Bloomington", slugs: ["bloomingtonmn"] },
  { city: "Plymouth", slugs: ["plymouthmn"] },
  { city: "Minnetonka", slugs: ["minnetonka"] },
  { city: "St. Louis Park", slugs: ["stlouispark"] },
  { city: "Richfield", slugs: ["richfieldmn"] },
  { city: "Blaine", slugs: ["blainemn"] },
  { city: "Brooklyn Park", slugs: ["brooklynpark"] },
  { city: "Coon Rapids", slugs: ["coonrapids"] },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Read-only GET against a single guessed Legistar client's `/bodies`
// endpoint. Returns the endpoint URL on a genuine hit (200 with a JSON
// array body — Legistar's shape for this endpoint), or null for anything
// else: 404 (no such client), any other error status, a timeout, or a
// response that isn't the JSON array shape expected. Never throws for an
// ordinary "no such client" outcome — that's the expected result for most
// guesses, not a failure.
async function probeSlug(slug) {
  const url = `https://webapi.legistar.com/v1/${slug}/bodies`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    if (!Array.isArray(body)) return null;
    return url;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const raw = await readFile(INVENTORY_PATH, "utf-8");
  const inventory = JSON.parse(raw);
  const byCity = new Map(inventory.jurisdictions.map((j) => [j.city, j]));

  for (const { city, slugs } of CANDIDATE_SLUGS) {
    const record = byCity.get(city);
    if (!record) {
      console.warn(`[probe-legistar] "${city}" not found in seeded inventory — skipping.`);
      continue;
    }

    let hitUrl = null;
    for (const slug of slugs) {
      console.log(`[probe-legistar] probing ${city} -> ${slug}...`);
      hitUrl = await probeSlug(slug);
      await sleep(REQUEST_DELAY_MS);
      if (hitUrl) break;
    }

    const probedAt = new Date().toISOString();
    if (hitUrl) {
      console.log(`[probe-legistar] HIT: ${city} -> ${hitUrl}`);
      record.platform = "legistar";
      record.sourceUrl = hitUrl;
      record.probedAt = probedAt;
      record.coverageTier = "A";
    } else {
      // No hit on any guessed slug — still honestly "unknown", not
      // "confirmed not Legistar": a wrong guess and "this city genuinely
      // isn't on Legistar" look identical from here. Only `probedAt`
      // moves, so a reviewer can see this city was checked.
      record.probedAt = probedAt;
    }
  }

  inventory.generatedAt = new Date().toISOString();
  await writeFile(INVENTORY_PATH, JSON.stringify(inventory, null, 2) + "\n");
  console.log(`[done] updated ${INVENTORY_PATH}`);
}

main().catch((err) => {
  console.error("[probe-legistar] failed:", err);
  process.exitCode = 1;
});
