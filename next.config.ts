import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import { readFileSync } from "node:fs";
import path from "node:path";

const nextConfig: NextConfig = {
  // MapLibre owns a WebGL context + worker pool per instance; React
  // StrictMode's dev-only double-mount (create -> remove -> create) was
  // leaving the map stuck mid-style-load, so it's off for this app.
  reactStrictMode: false,
};

// AGENTS.md §3.2 build-time enforcement ("Build fails, loudly, if any
// record's verifiedAt predates the most recent general election date").
//
// This used to run as a side-effecting call at the top of src/app/page.tsx
// (`loadAndValidateStateLegislatureData()` at module scope), on the theory
// that `next build`'s static prerender of the home page would execute it.
// It did — locally. But that page module is also bundled wholesale into
// the deployed Worker by OpenNext, and its module-scope code re-runs on
// every Worker cold start there too. In the Workers runtime, public/ isn't
// on disk — assets are served via the ASSETS binding, not a filesystem —
// so the readFileSync inside it threw `ENOENT '/bundle/public/state-
// legislature.geojson'` on *every* incoming request, including static
// ones, taking the entire site down with a 500. (Live incident,
// 2026-08-06 — confirmed via `wrangler tail`.)
//
// A Next.js config function is the one place in this app that is
// genuinely build-time-only: Next calls it (with `phase`) while running
// `next build` in a plain Node process with real disk access, and neither
// the function nor its imports ever end up in the compiled route bundle
// OpenNext ships to the Worker.
//
// Next's config loader requires this file's own module (real Node ESM,
// no bundler), so relative imports here need explicit extensions and
// can't chain through a file that itself has extensionless (bundler-
// style) imports — src/lib/stateLegislatureData.ts does, so it can't be
// imported directly from here. electionConfig.ts has zero imports of its
// own, so it's safe: the election date and the threshold check stay
// single-sourced there; only the small "read the file, loop the
// features" glue below is duplicated against
// stateLegislatureData.ts's validateStateLegislatureVerification, which
// remains the version used by the app/scripts/tests. Keep the two in
// sync if the check itself ever changes.
async function validateStateLegislatureFreshnessAtBuildTime(): Promise<void> {
  const { MN_STATE_GENERAL_ELECTION_DATE, assertVerifiedSinceLastGeneralElection } = await import(
    "./src/lib/electionConfig.ts"
  );

  const PUBLIC_PATH = "public/state-legislature.geojson";
  const DATA_PATH = path.join(process.cwd(), PUBLIC_PATH);
  const raw = readFileSync(DATA_PATH, "utf-8");
  const featureCollection = JSON.parse(raw) as {
    features: Array<{ properties?: { stateDistrict?: string | null; verifiedAt?: unknown } | null }>;
  };

  for (const feature of featureCollection.features) {
    const properties = feature.properties;
    const verifiedAt = properties?.verifiedAt;
    const label = properties?.stateDistrict ? `district ${properties.stateDistrict}` : "an unidentified district";

    if (typeof verifiedAt !== "string" || verifiedAt.length === 0) {
      throw new Error(
        `[stale-verification] ${PUBLIC_PATH}: the feature for ${label} has no "verifiedAt" field on its ` +
          `properties. AGENTS.md §3.2 requires every officeholder record to carry a verifiedAt date. ` +
          `Regenerate this file with a live Open States API key:\n\n` +
          `  OPEN_STATES_API_KEY=<your key> node scripts/fetch-state-legislature.mjs\n\n` +
          `See src/lib/electionConfig.ts and scripts/fetch-state-legislature.mjs.`,
      );
    }

    assertVerifiedSinceLastGeneralElection(
      verifiedAt,
      MN_STATE_GENERAL_ELECTION_DATE,
      `${PUBLIC_PATH} properties.verifiedAt (${label})`,
    );
  }
}

export default async function config(phase: string): Promise<NextConfig> {
  if (phase === PHASE_PRODUCTION_BUILD) {
    await validateStateLegislatureFreshnessAtBuildTime();
  }
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    // Wires up local binding proxying (D1, AI, etc.) for `next dev` only —
    // per @opennextjs/cloudflare's own doc comment, this is for
    // integrating "the local Next.js dev server... with the open-next
    // Cloudflare adapter," not something a build needs. It used to run
    // unconditionally at module scope (no `phase` check at all), which
    // meant `next build` tried it too — harmless for bindings with local
    // emulation (D1), but the AI binding has none (Workers AI is always
    // "remote", confirmed by `wrangler dev`'s own bindings table), so
    // every plain `next build` — including CI's, which deliberately never
    // sets CLOUDFLARE_API_TOKEN (see ci.yml's own comment on why: deploys
    // here are Cloudflare Workers Builds, not GitHub Actions, and this
    // repo's build has never needed live Cloudflare credentials before)
    // — started failing outright trying to "start the remote proxy
    // session." Gating this to PHASE_DEVELOPMENT_SERVER restores AGENTS.md
    // §0.8's "the build must succeed with every upstream API unreachable"
    // for `next build`/CI, while `next dev` still gets real binding
    // proxying against the maintainer's own authenticated wrangler session.
    const { initOpenNextCloudflareForDev } = await import("@opennextjs/cloudflare");
    await initOpenNextCloudflareForDev();
  }
  return nextConfig;
}
