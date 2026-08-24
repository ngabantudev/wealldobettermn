// src/lib/dateFormat.ts
//
// Shared by every bare-date (YYYY-MM-DD, no time component) rendering site
// in this app (issue #130) — WardModal.tsx's formatTeaserDate/
// formatOfficeSince, WardMap.tsx's formatLastUpdated, and meetings/
// page.tsx's formatMeetingDate each independently reimplemented the exact
// same call, three of the four carrying a hand-copied comment re-
// explaining the same gotcha. Consolidated here so a fifth date-rendering
// site can't be added without this fix, the way the fourth one already
// nearly was.
//
// `timeZone: "UTC"` matters here — every date this app stores is a bare
// YYYY-MM-DD string (midnight UTC, no time component), and formatting one
// in the browser's local zone rolls it back a day (or, near a month/year
// boundary, a whole month or year) for any resident west of UTC — most of
// this app's own userbase, being Minnesota-based. `${iso}T00:00:00Z` (not
// just `iso` on its own) makes the UTC-midnight instant explicit rather
// than relying on the JS engine's own date-only-string parsing quirks —
// verified equivalent to a bare `new Date(iso)` for every real bare-date
// input this app produces, but explicit here rather than depended-on.
export function formatUtcDate(iso: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
}
