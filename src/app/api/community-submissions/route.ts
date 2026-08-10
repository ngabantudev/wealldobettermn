// src/app/api/community-submissions/route.ts
//
// GET /api/community-submissions — the third of AGENTS.md §2.6's four
// sanctioned dynamic routes, named and disclosed there since that section
// was written; this is the first time it's actually implemented. Read-only,
// edge-cached, and explicitly NOT part of the §2.4 versioned static-JSON
// contract — a transient view over live (pending/graduating) community
// submissions, not something a downstream sister site is expected to
// consume. Only public/mayors.geojson, after a submission graduates and
// the next deploy picks it up, is part of that contract.
//
// Never receives or processes a user's address — §2.5's hard line is
// untouched by this route; it takes no input at all beyond the request
// itself.
//
// Response shape is plain JSON, not (yet) the GeoJSON FeatureCollection
// the original design doc sketched for map-wide pending-pin rendering —
// that's a separate, larger feature (merging into WardMap's live data,
// dashed pin styling, the DOM record-list accessibility sync) that hasn't
// been built. This route's first real consumer is AddOfficialsCTA.tsx,
// checking whether the one city it's about to show a CTA for already has
// a submission in flight — a plain list is all that needs today, and
// this can grow into (or sit alongside) a GeoJSON shape later without
// this consumer caring.
import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { COMMUNITY_CONFIRMATIONS_REQUIRED } from "@/lib/communityConfig";
import { listLiveSubmissionsForMap, type D1DatabaseLike } from "@/lib/communitySubmissions";

interface RouteEnv {
  DB: D1DatabaseLike;
}

export async function GET() {
  const { env } = await getCloudflareContext({ async: true });
  const db = (env as unknown as RouteEnv).DB;

  const submissions = await listLiveSubmissionsForMap(db);

  return NextResponse.json(
    {
      // rejectedMentions is never read from SubmissionRecord here — it
      // isn't even a field on that type (communitySubmissions.ts's
      // mapRow() never selects it out of extracted_json's sibling
      // column) — same AGENTS.md §1b discipline POST /api/submissions
      // already enforces: record the office, never a denylisted mention.
      submissions: submissions.map((s) => ({
        id: s.id,
        cityName: s.cityName,
        gnisId: s.gnisId,
        status: s.status,
        officials: s.officials,
        confirmations: s.confirmations,
        confirmationsNeeded: COMMUNITY_CONFIRMATIONS_REQUIRED,
        submittedAt: s.submittedAt,
      })),
    },
    {
      headers: {
        // Low-cardinality, low-write-volume, read-only — safe to cache
        // briefly at the edge rather than hitting D1 on every panel open.
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    },
  );
}
