// Shared by every client component that fetches a public/*.geojson or
// public/*.json data file — originally WardMap.tsx's own helper, pulled
// out here so SearchBar.tsx's lazy address-chunk fetches (see
// addressChunks.ts, issue #70) can build the same cache-busted URLs
// without either duplicating this function or routing every chunk fetch
// back through WardMap.tsx.
//
// Builds a cache-busted URL — `?v=<content hash>` — sourced from
// public/data-manifest.json (see scripts/lib/dataManifest.mjs). Every one
// of these fetches used to pass `{ cache: "no-store" }`, which defeats the
// browser's HTTP cache entirely on every load — see issue #67 Finding 3.
// The fix is this file's content hash baked into the URL instead: a
// re-ingest that actually changes the file changes its hash, which
// changes the URL, which is a guaranteed cache miss (no risk of a stale
// response missing a field the current component code expects); an
// unchanged file keeps the same URL across reloads and even across
// deploys, so the browser (and Cloudflare's edge) can actually cache it —
// see public/_headers' Cache-Control rule for these paths.
//
// `dataManifest` is a plain JSON import, bundled into the calling
// component's own JS at build time, so a fresh deploy always ships the
// current hashes without a second runtime fetch to look them up. Falls
// back to the bare filename (no query param) if a file is somehow missing
// from the manifest, rather than throwing — an unfingerprinted fetch of
// the current file is a fine degrade, and a source of noisy failures is
// not.
import dataManifest from "../../public/data-manifest.json";

// `filename` is a plain `string`, not `keyof typeof dataManifest`: most
// call sites name a fixed file known at compile time (wards.geojson,
// address-index/manifest.json, ...), but src/lib/addressChunks.ts's
// per-county address chunk filenames (`address-index/<key>.json`) are
// only known once the manifest itself has been fetched at runtime — a
// key like that can never be part of a static union the build knows
// ahead of time. Per this repo's own "if a type is hard, the model is
// probably wrong" rule, a runtime-computed key genuinely isn't a
// compile-time literal, so `string` here is the honest type rather than
// a cast to force a fit that doesn't exist. The lookup below is a plain
// `Record<string, string>` index for the same reason.
export function dataUrl(filename: string): string {
  const manifest: Record<string, string> = dataManifest;
  const hash = manifest[filename];
  return hash ? `/${filename}?v=${hash}` : `/${filename}`;
}
