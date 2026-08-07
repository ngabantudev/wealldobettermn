// scripts/lib/dataManifest.mjs
//
// Writes/updates public/data-manifest.json — a filename -> short content
// hash map for every public/*.geojson and public/*.json file WardMap.tsx
// fetches client-side. See issue #67 Finding 3.
//
// Why: WardMap.tsx used to fetch every one of these with `{ cache:
// "no-store" }`, which defeats the browser's HTTP cache entirely, on
// every single page load — a resident who reloads five minutes after
// their last visit, with no new deploy in between, re-downloads the
// full multi-megabyte payload from scratch. `no-store` was there for a
// real reason (a stale cached response from before a field got added
// crashes the modal on a field the current component code expects to
// exist), just a much bigger hammer than the problem needed.
//
// The fix is a fingerprinted-URL pattern, same idea Next.js already
// uses for its own /_next/static/* chunks (see public/_headers): the
// manifest below is committed to the repo alongside the data files it
// describes (AGENTS.md §2.2 "commit the derived output"), statically
// imported into the client bundle at build time, and used to build a
// cache-busting query param per file — `/wards.geojson?v=<hash>`. A new
// deploy that changes a file's content changes its hash, which changes
// the URL, which is a guaranteed cache miss (no stale-field risk); an
// unchanged file keeps its URL across reloads/deploys, so the browser
// (and Cloudflare's edge) can actually cache it — see public/_headers'
// Cache-Control rule for these paths.
//
// Deterministic (AGENTS.md §2.2): a plain SHA-256 of the file's own
// bytes, nothing else — same content in, same hash out, every time.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(__dirname, "../../public/data-manifest.json");

// 10 hex chars of SHA-256 (40 bits) is already far past any realistic
// collision risk for a manifest with a handful of entries — this isn't
// a security boundary, just a cache-busting token, so there's no reason
// to ship the full 64-char digest into every data URL on the site.
function shortHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 10);
}

async function readManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

// Called by each fetch-*.mjs script right after it writes its own
// public/ output file, with that same file's final bytes — `contents`
// is a string or Buffer, not re-read from disk, so this can't drift
// from what was actually written even if the write and the hash race
// (they don't, since this always runs after `await writeFile`, but
// hashing the same bytes rather than re-reading is one less thing to
// get wrong). Only updates `filename`'s own entry — read-modify-write
// against whatever's currently committed, so scripts that don't run in
// the same batch (state-legislature needs an API key; wards/
// commissioners don't) never clobber each other's entries.
export async function updateDataManifest(filename, contents) {
  const manifest = await readManifest();
  manifest[filename] = shortHash(Buffer.from(contents));
  // Sorted keys: a diff-friendly, deterministic byte-for-byte output
  // regardless of which script ran in which order this time.
  const sorted = Object.fromEntries(Object.keys(manifest).sort().map((key) => [key, manifest[key]]));
  await writeFile(MANIFEST_PATH, JSON.stringify(sorted, null, 2) + "\n");
}
