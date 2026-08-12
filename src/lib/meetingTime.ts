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
