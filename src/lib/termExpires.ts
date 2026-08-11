// src/lib/termExpires.ts
//
// Best-effort parsing of a community-extracted termExpires string
// (communityExtraction.ts's ValidatedOfficial.termExpires) into a
// comparable date, for CommunityOfficialsList.tsx's "this term has
// already expired" flag. Never authoritative — MN city sites state this
// in wildly inconsistent formats ("December 31, 2028", "Term Expires:
// 12/31/2026", a bare "2026") — a failed parse is treated as "don't
// know," never as "not expired" (a false negative) or "expired" (a false
// positive); the raw text is shown either way, this only controls
// whether a supplementary flag is added on top of it.
//
// Deliberately NOT computed at extraction/submission time and stored —
// a term that hasn't expired yet when someone submits could still expire
// before anyone confirms or even views it, so this is always computed
// fresh, at render time, against whatever "now" actually is then.

// JS's own `new Date(text)` is surprisingly lenient — `new Date("Term
// Expires: 2026")` doesn't fail, it silently parses to January 1, 2026,
// having found a bare year and nothing else. For a real MN local term
// (which runs through the END of its stated year, not the start), that
// would make a still-current term look "expired" for up to twelve months
// early. So: only trust native Date parsing when the text actually
// contains a specific month/day signal; a bare year always gets our own
// December 31st interpretation instead.
const MONTH_NAME_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const NUMERIC_DATE_RE = /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}/;
const YEAR_RE = /\b(20\d{2})\b/;

/** Parses a termExpires string into a Date, or null if it can't confidently do so. */
export function parseTermExpiresDate(text: string): Date | null {
  const hasSpecificDate = MONTH_NAME_RE.test(text) || NUMERIC_DATE_RE.test(text);
  if (hasSpecificDate) {
    const direct = new Date(text);
    if (!Number.isNaN(direct.getTime())) return direct;
  }

  // A bare year ("Term Expires: 2026") with no month/day — MN local
  // terms run calendar years, so treat the year as expiring at its end.
  const yearMatch = text.match(YEAR_RE);
  if (yearMatch) {
    return new Date(Number(yearMatch[1]), 11, 31);
  }

  // Last resort, for a date shape neither check above anticipated —
  // still gated behind Number.isNaN, never trusted blindly.
  const direct = new Date(text);
  return Number.isNaN(direct.getTime()) ? null : direct;
}

/**
 * Whether a termExpires string names a date already in the past,
 * relative to `now`. Never throws; unparseable text always reports
 * `false` (no flag shown), never `true` — see this module's own header
 * on why a false positive here would be worse than staying silent.
 */
export function isTermExpired(termExpires: string | null, now: Date): boolean {
  if (!termExpires) return false;
  const parsed = parseTermExpiresDate(termExpires);
  if (!parsed) return false;
  return parsed.getTime() < now.getTime();
}
