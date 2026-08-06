import WardMap from "@/components/WardMap";
import { loadAndValidateStateLegislatureData } from "@/lib/stateLegislatureData";

// AGENTS.md §3.2 build-time enforcement (§2.1 "Build-Time Reads"): this
// runs once, at module-evaluation time on the server, so `next build`'s
// static prerender of this page executes it and fails loudly if
// public/state-legislature.geojson carries a record with a missing or
// stale verifiedAt. See src/lib/stateLegislatureData.ts. The returned
// value isn't consumed here — WardMap fetches the same file client-side
// for actual rendering — this call exists purely to force the check.
loadAndValidateStateLegislatureData();

export default function Home() {
  return <WardMap />;
}
