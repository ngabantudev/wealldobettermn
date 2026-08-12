import type { Metadata } from "next";
import Gloss from "@/components/Gloss";
import {
  MEETINGS_JURISDICTIONS,
  UNWIRED_MEETINGS_JURISDICTIONS,
  type Meeting,
  type MeetingAgendaItem,
  type MeetingsFeed,
} from "@/lib/meetingsRegistry";
// Bundler-resolved static JSON imports, not readFileSync — see
// src/app/bills/page.tsx's own comment and LESSONS.md's 2026-08-06
// Cloudflare Workers / node:fs entry for why: a disk read anywhere under
// src/app gets bundled into the deployed Worker, which has no filesystem
// at build-serve time (assets are served via the ASSETS binding, not
// node:fs). An `import` specifier must be a literal string, so this can't
// be built from MEETINGS_JURISDICTIONS's own `dataPath` field — the two
// have to be kept in sync by hand if a data path ever moves, same
// constraint that page's comment documents for BILLS_DATA_PATH.
import stpaulMeetingsData from "../../../../public/legistar/stpaul-meetings.json";
import hennepinmnMeetingsData from "../../../../public/legistar/hennepinmn-meetings.json";
import minneapolisMeetingsData from "../../../../public/lims/minneapolis-meetings.json";

export const metadata: Metadata = {
  title: "Meetings & agendas — We All Do Better",
  description: "Upcoming meetings and agendas, by body, for every jurisdiction this site has a connected feed for.",
};

const FEEDS_BY_CLIENT: Record<string, MeetingsFeed> = {
  stpaul: stpaulMeetingsData as MeetingsFeed,
  hennepinmn: hennepinmnMeetingsData as MeetingsFeed,
  minneapolis: minneapolisMeetingsData as MeetingsFeed,
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface BodyGroup {
  bodyId: string;
  bodyName: string;
  upcoming: Meeting[];
  upcomingHiddenCount: number;
  recent: Meeting[];
}

// Groups one jurisdiction's meetings by body_id, splitting each body's
// meetings into "upcoming" (date >= today) and "recent" (date < today,
// within the ingest's own look-back window) — never inventing a third
// bucket for a meeting with no parseable date; those are dropped from
// display (they'd render as "Invalid Date" otherwise) but stay counted in
// the raw meetings array the page's own numbers are derived from.
// `upcoming` is capped at MAX_UPCOMING_MEETINGS_PER_BODY (soonest first,
// so the cap never hides the immediately-next meeting) — see that
// constant's own comment for why; `recent` is left uncapped since a
// rolling 14-day lookback naturally bounds it to a handful per body.
function groupMeetingsByBody(meetings: Meeting[]): BodyGroup[] {
  const today = todayIso();
  const byBody = new Map<string, BodyGroup>();

  for (const meeting of meetings) {
    if (!meeting.date) continue;
    const key = meeting.body_id;
    if (!byBody.has(key)) {
      byBody.set(key, { bodyId: key, bodyName: meeting.bodyName ?? "Unnamed body", upcoming: [], upcomingHiddenCount: 0, recent: [] });
    }
    const group = byBody.get(key);
    if (!group) continue;
    if (meeting.date >= today) group.upcoming.push(meeting);
    else group.recent.push(meeting);
  }

  for (const group of byBody.values()) {
    group.upcoming.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    group.recent.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    if (group.upcoming.length > MAX_UPCOMING_MEETINGS_PER_BODY) {
      group.upcomingHiddenCount = group.upcoming.length - MAX_UPCOMING_MEETINGS_PER_BODY;
      group.upcoming = group.upcoming.slice(0, MAX_UPCOMING_MEETINGS_PER_BODY);
    }
  }

  return [...byBody.values()].sort((a, b) => a.bodyName.localeCompare(b.bodyName));
}

// A single Minneapolis City Council meeting can carry 100+ agenda items
// (a real regular-meeting agenda — officer elections, appointments,
// routine business — not a data bug; confirmed live, one July 2026
// meeting alone had 121). Minneapolis's LIMS feed also structurally
// covers ~26 distinct bodies (Council + every committee/subcommittee/
// board/commission LIMS tracks) in the same rolling window Legistar's
// St. Paul/Hennepin clients cover with 2-3 bodies each — so even before
// any single meeting's agenda size, the *number* of meetings rendered is
// 5-10x larger for Minneapolis. Together these pushed /meetings past 1MB
// on a route OpenNext serves through the Worker on every request (not
// the static ASSETS binding — confirmed via `.open-next/assets` not
// containing meetings.html), which tripped Cloudflare Workers' resource
// limits in production (error 1102). Both caps below are the same
// visible-truncation pattern scripts/ingest/legistar.mjs's own
// MAX_MATTERS_PER_CLIENT already uses for a different request-volume
// concern — never a silent drop (AGENTS.md §3.3): each cap renders an
// explicit "+N more — see the full record/feed" note when it bites.
const MAX_AGENDA_ITEMS_PER_MEETING = 10;
const MAX_UPCOMING_MEETINGS_PER_BODY = 4;

function agendaItemsFor(feed: MeetingsFeed, meetingId: string): { items: MeetingAgendaItem[]; totalCount: number } {
  const all = feed.agendaItems
    .filter((item) => item.meeting_id === meetingId)
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  return { items: all.slice(0, MAX_AGENDA_ITEMS_PER_MEETING), totalCount: all.length };
}

function formatMeetingDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function MeetingCard({ feed, meeting }: { feed: MeetingsFeed; meeting: Meeting }) {
  const { items, totalCount } = agendaItemsFor(feed, meeting.id);
  const consentCount = items.filter((item) => item.isConsent).length;
  const hiddenCount = totalCount - items.length;

  return (
    <li id={meeting.id} className="well rounded-xl border border-hair p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-ink">{meeting.date ? formatMeetingDate(meeting.date) : "Date unknown"}</p>
        {meeting.time && <p className="text-sm text-ink-3">{meeting.time}</p>}
      </div>
      {meeting.location && <p className="mt-0.5 text-sm text-ink-3">{meeting.location}</p>}

      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        {meeting.agendaUrl && (
          <a href={meeting.agendaUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
            Agenda (PDF)
          </a>
        )}
        {meeting.minutesUrl && (
          <a href={meeting.minutesUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
            Minutes (PDF)
          </a>
        )}
        {meeting.sourceUrl && (
          <a href={meeting.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
            Official meeting record
          </a>
        )}
      </div>

      {totalCount > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-ink-2">
            {totalCount} agenda item{totalCount === 1 ? "" : "s"}
            {consentCount > 0 && (
              <span className="ml-1 text-xs text-ink-4">
                ({consentCount} on consent — passed as a group, per AGENTS.md §0.4)
              </span>
            )}
          </summary>
          <ul className="mt-2 space-y-2 border-l border-hair pl-3">
            {items.map((item) => (
              <li key={item.id} className="text-sm text-ink-2">
                <div className="flex items-start gap-2">
                  {item.isConsent && (
                    <Gloss
                      term="consent-agenda"
                      className="mt-0.5 inline-block shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-inset"
                      glossClassName="mt-1 block text-xs italic text-ink-4"
                    >
                      Consent
                    </Gloss>
                  )}
                  <span>
                    {item.matterFile ? <span className="font-medium text-ink-3">{item.matterFile}</span> : null}
                    {item.matterFile ? " — " : ""}
                    {item.title}
                  </span>
                </div>
                {(item.actionName || item.passedFlagName) && (
                  <p className="mt-0.5 text-xs text-ink-4">
                    {[item.actionName, item.passedFlagName].filter(Boolean).join(" — ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {hiddenCount > 0 && (
            <p className="mt-2 text-xs text-ink-4">
              +{hiddenCount} more item{hiddenCount === 1 ? "" : "s"} not shown here.{" "}
              {meeting.sourceUrl ? (
                <a href={meeting.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
                  See the full record
                </a>
              ) : (
                "See the raw feed link below for the full record."
              )}
            </p>
          )}
        </details>
      ) : (
        <p className="mt-2 text-xs text-ink-4">No agenda items on file for this meeting yet.</p>
      )}
    </li>
  );
}

// St. Paul/Hennepin run through Legistar; Minneapolis runs through LIMS —
// this component is shared across both vendors (MeetingsFeed's shape is
// vendor-agnostic), so the "via {vendor}" citation in its footer can't be
// a single hardcoded string. Keyed by `client` since that's the one field
// every feed already carries and the registry already uses to route
// data-path imports (meetingsRegistry.ts, FEEDS_BY_CLIENT above).
function apiLabelFor(client: string): string {
  return client === "minneapolis" ? "the LIMS API" : "the Legistar public API";
}

function JurisdictionSection({
  jurisdiction,
  calendarUrl,
  coverage,
  feed,
}: {
  jurisdiction: string;
  calendarUrl: string;
  coverage: string;
  feed: MeetingsFeed;
}) {
  const groups = groupMeetingsByBody(feed.meetings);
  const isLive = feed.status === "ingested" && feed.meetings.length > 0;

  return (
    <section aria-labelledby={`jurisdiction-${feed.client}`} className="mt-10">
      <h2 id={`jurisdiction-${feed.client}`} className="text-lg font-bold text-ink">
        {jurisdiction}
      </h2>
      <p className="mt-1 text-sm text-ink-3">{coverage}</p>

      {feed.diff && (feed.diff.addedIds.length > 0 || feed.diff.removedIds.length > 0 || feed.diff.changed.length > 0) && (
        <p className="mt-2 rounded-lg bg-panel-2 px-3 py-2 text-xs text-ink-3" role="status">
          Changed since the last refresh: {feed.diff.addedIds.length} meeting(s) added, {feed.diff.removedIds.length} removed,{" "}
          {feed.diff.changed.length} field change(s) (e.g. a reschedule).
        </p>
      )}

      {!isLive ? (
        <div role="status" className="well mt-3 space-y-2 rounded-xl border border-hair-strong p-4 text-sm text-ink-3">
          <p className="font-medium text-ink-2">
            {feed.status === "ingested" ? "No meetings in the current window." : "No meetings feed connected right now."}
          </p>
          <p>{feed.note}</p>
          <p>
            See{" "}
            <a href={calendarUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
              {jurisdiction}&rsquo;s own meeting calendar
            </a>{" "}
            in the meantime.
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-8">
          {groups.map((group) => (
            <div key={group.bodyId}>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-3">{group.bodyName}</h3>
              {group.upcoming.length > 0 && (
                <>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-ink-4">Upcoming</p>
                  <ul className="mt-1.5 space-y-2">
                    {group.upcoming.map((meeting) => (
                      <MeetingCard key={meeting.id} feed={feed} meeting={meeting} />
                    ))}
                  </ul>
                  {group.upcomingHiddenCount > 0 && (
                    <p className="mt-1.5 text-xs text-ink-4">
                      +{group.upcomingHiddenCount} more upcoming meeting{group.upcomingHiddenCount === 1 ? "" : "s"} for{" "}
                      {group.bodyName}.{" "}
                      <a href={calendarUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
                        See {jurisdiction}&rsquo;s own meeting calendar
                      </a>
                      .
                    </p>
                  )}
                </>
              )}
              {group.recent.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink-4">
                    Recent ({group.recent.length})
                  </summary>
                  <ul className="mt-1.5 space-y-2">
                    {group.recent.map((meeting) => (
                      <MeetingCard key={meeting.id} feed={feed} meeting={meeting} />
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
          <p className="text-xs text-ink-4">
            Data from {feed.provenance.sourceAgency} via {apiLabelFor(feed.client)}, fetched {feed.provenance.fetchedAt ?? "unknown time"}
            . See{" "}
            <a href={feed.provenance.primarySourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              the raw feed
            </a>
            .
          </p>
        </div>
      )}
    </section>
  );
}

// FEATURES.md / issue #58 "Per-body meetings/agenda view." Static route
// (AGENTS.md §2.1 — takes no user input, needs no server boundary). Every
// jurisdiction rendered here comes from MEETINGS_JURISDICTIONS /
// UNWIRED_MEETINGS_JURISDICTIONS in src/lib/meetingsRegistry.ts — this file
// has no jurisdiction-specific branching of its own to keep in sync by
// hand (AGENTS.md §2.1 "do NOT hand-wire a layer into page files").
export default function MeetingsPage() {
  return (
    <>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-xl font-semibold text-ink">Meetings &amp; agendas</h1>
        <p className="mt-2 text-sm text-ink-3">
          What each body is about to decide, by meeting date — including items passed on the{" "}
          <Gloss term="consent-agenda">consent agenda</Gloss>, flagged below (AGENTS.md §0.4: &ldquo;make the routine visible&rdquo;).
        </p>

        {MEETINGS_JURISDICTIONS.map((entry) => {
          const feed = FEEDS_BY_CLIENT[entry.client];
          if (!feed) return null;
          return (
            <JurisdictionSection
              key={entry.client}
              jurisdiction={entry.jurisdiction}
              calendarUrl={entry.calendarUrl}
              coverage={entry.coverage}
              feed={feed}
            />
          );
        })}

        <section aria-labelledby="unwired-jurisdictions" className="mt-10">
          <h2 id="unwired-jurisdictions" className="text-lg font-bold text-ink">
            Not connected yet
          </h2>
          <p className="mt-1 text-sm text-ink-3">
            No fabricated dates for any of these — an honest gap, with a link to where a resident can look themselves.
          </p>
          <ul className="mt-3 space-y-3">
            {UNWIRED_MEETINGS_JURISDICTIONS.map((entry) => (
              <li key={entry.jurisdiction} className="well rounded-xl border border-hair-strong p-4 text-sm">
                <p className="font-medium text-ink-2">{entry.jurisdiction}</p>
                <p className="mt-1 text-ink-3">{entry.reason}</p>
                <a href={entry.calendarUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-accent underline underline-offset-2">
                  {entry.jurisdiction}&rsquo;s own meeting calendar
                </a>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
