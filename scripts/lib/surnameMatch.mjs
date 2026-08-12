// scripts/lib/surnameMatch.mjs
//
// Shared by scripts/lib/legistarRecentVotes.mjs and scripts/lib/
// limsRecentVotes.mjs — both join an upstream vote feed back to this
// app's own roster (fetch-wards.mjs's repName strings) by surname only,
// deliberately loose: neither upstream's official-name field always
// matches this app's roster verbatim (nicknames, a "Councilmember "
// prefix St. Paul's source data carries, suffix variants). A body this
// small (7-13 current seats per client) makes a bare surname collision
// very unlikely; each caller's own recentVotesFrom*() warns rather than
// guessing further if a name genuinely doesn't resolve, so a bad match
// is visible, not silent — this module only owns the normalization
// itself, not the warn-on-mismatch behavior (that stays per-caller,
// since what counts as "known" differs by upstream).
export function normalizeSurname(fullName) {
  const cleaned = String(fullName ?? "")
    .replace(/^councilmember\s+/i, "")
    .replace(/\b(jr\.?|sr\.?|ii|iii|iv)\b/gi, "")
    .trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1].toLowerCase() : "";
}
