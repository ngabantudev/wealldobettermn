// Shared officials-list rendering for the Community Contribution Pipeline
// (AGENTS.md §2.6) — used both by ContributeForm.tsx's own success view
// (right after a visitor submits) and AddOfficialsCTA.tsx's pending
// notice (a later visitor returning to the map). One component so the
// two never drift apart, and so a fix like "show phone, not just email"
// only has to land once.
import { isTermExpired } from "@/lib/termExpires";

export interface CommunityOfficial {
  role: "Mayor" | "Council Member";
  repName: string;
  repEmail: string | null;
  repPhone: string | null;
  // Text only, never a resolved boundary — see communityExtraction.ts's
  // ValidatedOfficial.wardLabel for why.
  wardLabel: string | null;
  // Raw page text, e.g. "December 31, 2028" — see
  // communityExtraction.ts's ValidatedOfficial.termExpires for why this
  // is never a parsed/structured date at this layer.
  termExpires: string | null;
}

export default function CommunityOfficialsList({ officials }: { officials: CommunityOfficial[] }) {
  return (
    <ul className="mt-4 divide-y divide-hair rounded-lg border border-hair">
      {officials.map((official) => {
        // Computed at render time, not stored — see termExpires.ts's own
        // header on why "now" has to be whenever this is actually viewed.
        const expired = isTermExpired(official.termExpires, new Date());
        return (
          <li key={`${official.role}-${official.repName}`} className="px-4 py-3">
            <p className="text-sm font-semibold text-ink">{official.repName}</p>
            <p className="text-xs text-ink-3">
              {official.wardLabel ? `${official.role}, ${official.wardLabel}` : official.role}
            </p>
            {(official.repEmail || official.repPhone) && (
              <p className="mt-0.5 text-xs text-ink-3">{[official.repEmail, official.repPhone].filter(Boolean).join(" · ")}</p>
            )}
            {official.termExpires && (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
                <span>Term expires {official.termExpires}</span>
                {expired && (
                  // Same --stale/--stale-soft tokens the rest of the app
                  // already uses for staleness — a plausibility signal
                  // worth a second look, not an alarm: the page itself
                  // might just be out of date, not necessarily this
                  // extraction's fault.
                  <span
                    className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
                    style={{ backgroundColor: "var(--stale-soft)", color: "var(--stale)" }}
                  >
                    expired
                  </span>
                )}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
