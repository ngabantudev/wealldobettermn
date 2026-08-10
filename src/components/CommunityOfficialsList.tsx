// Shared officials-list rendering for the Community Contribution Pipeline
// (AGENTS.md §2.6) — used both by ContributeForm.tsx's own success view
// (right after a visitor submits) and AddOfficialsCTA.tsx's pending
// notice (a later visitor returning to the map). One component so the
// two never drift apart, and so a fix like "show phone, not just email"
// only has to land once.
export interface CommunityOfficial {
  role: "Mayor" | "Council Member";
  repName: string;
  repEmail: string | null;
  repPhone: string | null;
  // Text only, never a resolved boundary — see communityExtraction.ts's
  // ValidatedOfficial.wardLabel for why.
  wardLabel: string | null;
}

export default function CommunityOfficialsList({ officials }: { officials: CommunityOfficial[] }) {
  return (
    <ul className="mt-4 divide-y divide-hair rounded-lg border border-hair">
      {officials.map((official) => (
        <li key={`${official.role}-${official.repName}`} className="px-4 py-3">
          <p className="text-sm font-semibold text-ink">{official.repName}</p>
          <p className="text-xs text-ink-3">
            {official.wardLabel ? `${official.role}, ${official.wardLabel}` : official.role}
          </p>
          {(official.repEmail || official.repPhone) && (
            <p className="mt-0.5 text-xs text-ink-3">{[official.repEmail, official.repPhone].filter(Boolean).join(" · ")}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
