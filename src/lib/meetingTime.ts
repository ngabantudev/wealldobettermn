// src/lib/meetingTime.ts
//
// Every meeting's `time` field is normalized to zero-padded 24-hour at
// ingest time (scripts/ingest/legistar.mjs's normalizeTimeTo24h(), used
// by both that script's mapEventToMeeting() and scripts/ingest/
// lims-minneapolis.mjs's mapMeetingCalendarRow()) — that's the right
// shape for sorting (a plain string compare is correct), but not for
// display. This is the one shared place that turns "15:30" into "3:30
// PM" for both consumers that render a meeting's time to a resident:
// src/app/(content)/meetings/page.tsx and WardModal.tsx's this-week
// teaser. One function, not two independently-formatted copies.
export function formatMeetingTime(time: string | null): string | null {
  if (!time) return null;
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return time; // unrecognized shape — show as-is, never guessed
  const hour24 = Number(match[1]);
  const minute = match[2];
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute} ${period}`;
}

// WardModal.tsx's sidebar "this week" teaser used to just render whatever
// scripts/ingest/legistar.mjs's selectMeetingsThisWeek() had baked into
// {client}-meetings-this-week.json at the moment that ingest script last
// ran — a real "this week" only on the day of that run, and silently stale
// every day after, since nothing runs that ingest on a schedule (no GitHub
// Actions workflow triggers it; AGENTS.md §3.2's ingest table). A resident
// visiting a week (or more) after the last manual ingest would see a
// "this week" that had already fully elapsed, or an empty list that looked
// like "nothing scheduled" rather than "this data is stale."
//
// Fix: the ingest scripts now write a wider rolling teaser window
// (MEETINGS_TEASER_WINDOW_DAYS = 30 days ahead, see that constant's own
// comment in scripts/ingest/legistar.mjs) instead of a literal 7 days, and
// this function re-derives the *actual* current week from that wider
// window against the real clock, every time WardModal renders — so display
// stays correct for up to 30 days after an ingest run, not just on the day
// of one. `today` is a parameter (not read internally via `new Date()`)
// purely so this stays trivially testable against a fixed reference date.
export function filterMeetingsThisWeek<T extends { date: string | null }>(
  meetings: readonly T[],
  today: Date = new Date(),
): T[] {
  const todayIso = today.toISOString().slice(0, 10);
  const windowEnd = new Date(`${todayIso}T00:00:00Z`);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 6); // 7-day window, inclusive of today
  const windowEndIso = windowEnd.toISOString().slice(0, 10);
  return meetings.filter((m) => m.date !== null && m.date >= todayIso && m.date <= windowEndIso);
}
