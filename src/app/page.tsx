import WardMap from "@/components/WardMap";

// AGENTS.md §3.2 build-time enforcement lives in next.config.ts, not
// here. It used to be a side-effecting call at this module's top level
// (`loadAndValidateStateLegislatureData()`), on the theory that `next
// build`'s static prerender of this page would be the only place it ran.
// It wasn't: OpenNext bundles this page module into the deployed Worker
// too, and that module-scope readFileSync re-ran on every Worker cold
// start there, where public/ isn't on disk — every request 500'd. See
// next.config.ts for the fix and the full incident note, and
// src/lib/stateLegislatureData.ts for the validation logic itself.
// WardMap fetches state-legislature.geojson client-side for rendering.

export default function Home() {
  return <WardMap />;
}
