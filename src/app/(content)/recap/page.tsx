import type { Metadata } from "next";
import { BILLS_COVERAGE_NOTE, BILLS_INGEST_STATUS } from "@/lib/billsRegistry";
import { LEGISTAR_JURISDICTIONS, type LegistarFullIngestFeed } from "@/lib/legistarJurisdictions";
import { MEETINGS_JURISDICTIONS, type MeetingsFeed } from "@/lib/meetingsRegistry";
import { MINNEAPOLIS_MEETINGS_VOTES_LAYER } from "@/lib/layers";
import type { Bill, VoteEvent as BillVoteEvent } from "@/lib/types";
// Bundler-resolved static JSON imports, not readFileSync — see
// src/app/bills/page.tsx's and src/app/meetings/page.tsx's own comments,
// and LESSONS.md's 2026-08-06 Cloudflare Workers / node:fs incident: a disk
// read anywhere under src/app gets bundled into the deployed Worker, which
// has no filesystem at build-serve time (public/ is served via the ASSETS
// binding, not node:fs). An `import` specifier must be a literal string, so
// none of these six paths can be built from the registry constants above —
// keep them in sync by hand if a data path ever moves, same constraint
// those two pages already live with.
import billsFileData from "../../../../public/state-bills.json";
import stpaulVotesData from "../../../../public/legistar/stpaul.json";
import hennepinmnVotesData from "../../../../public/legistar/hennepinmn.json";
import stpaulMeetingsData from "../../../../public/legistar/stpaul-meetings.json";
import hennepinmnMeetingsData from "../../../../public/legistar/hennepinmn-meetings.json";
import minneapolisMeetingsData from "../../../../public/lims/minneapolis-meetings.json";

// FEATURES.md has no ticket number for this page as of authorship — it
// answers AGENTS.md's question 2 ("What do they vote for?") across every
// level this site tracks, in one place, inspired by a peer platform's
// weekly multi-level vote digest but built to this repo's own rules: no
// accounts, no email, no personalization (AGENTS.md §0.7/§2.5 — this is a
// read-only recap, not a subscription product), and — per §3.1's "no
// placeholder data ships as fact" and §3.3's "Coverage Honesty" — every
// section is independently honest about what it can and can't show,
// rather than one glossy "your weekly digest" masking four very different
// coverage levels underneath. Static route (AGENTS.md §2.1 — takes no
// user input, needs no server boundary).
//
// This page does not introduce any new ingest or registry entry of its
// own. It is a second, differently-shaped *reader* of four layers that
// already exist (billsRegistry.ts, legistarJurisdictions.ts,
// meetingsRegistry.ts, layers.ts's MINNEAPOLIS_MEETINGS_VOTES_LAYER) — per
// AGENTS.md §2.1's registry pattern, the underlying coverage facts
// (BILLS_COVERAGE_NOTE, MEETINGS_COVERAGE_NOTE's constituent lists,
// MINNEAPOLIS_MEETINGS_VOTES_LAYER's coverage/knownGaps) are quoted from
// those single sources of truth rather than
// re-described by hand here, so this page can't drift from /bills or
// /meetings about the same underlying gap.

export const metadata: Metadata = {
  title: "Recap: what got voted on — We All Do Better",
  description:
    "A plain-language, sourced recap of recent votes and consent-agenda action across every level of Minnesota government this site tracks.",
};

const STPAUL_ENTRY = LEGISTAR_JURISDICTIONS.find((j) => j.client === "stpaul");
const HENNEPIN_ENTRY = LEGISTAR_JURISDICTIONS.find((j) => j.client === "hennepinmn");
const STPAUL_MEETINGS_ENTRY = MEETINGS_JURISDICTIONS.find((j) => j.client === "stpaul");
const HENNEPIN_MEETINGS_ENTRY = MEETINGS_JURISDICTIONS.find((j) => j.client === "hennepinmn");
const MINNEAPOLIS_MEETINGS_ENTRY = MEETINGS_JURISDICTIONS.find((j) => j.client === "minneapolis");

function loadBills(): Bill[] {
  // Same defensiveness as src/app/bills/page.tsx's loadBills(): an empty
  // array is never presented as more coverage than it is — isBillsLive
  // below also checks BILLS_INGEST_STATUS, so a stale "live" flag with a
  // genuinely empty bills array still renders the honest empty state.
  const parsed = billsFileData as { bills?: Bill[]; voteEvents?: BillVoteEvent[] };
  return Array.isArray(parsed.bills) ? parsed.bills : [];
}

function loadBillVoteEvents(): BillVoteEvent[] {
  const parsed = billsFileData as { bills?: Bill[]; voteEvents?: BillVoteEvent[] };
  return Array.isArray(parsed.voteEvents) ? parsed.voteEvents : [];
}

// The most recent of a bill's own action dates — never re-derived from
// `status` (a free-text field kept as the source reports it, per AGENTS.md
// §3.3), just a max() over the dates the source itself recorded.
function latestActionDate(bill: Bill): string | null {
  if (bill.actions.length === 0) return null;
  return bill.actions.reduce((latest, action) => (action.date > latest ? action.date : latest), bill.actions[0].date);
}

function mostRecentAction(bill: Bill): Bill["actions"][number] | null {
  if (bill.actions.length === 0) return null;
  return [...bill.actions].sort((a, b) => b.date.localeCompare(a.date))[0];
}

// Bills with at least one recorded action, newest-action-first, capped at a
// readable count. This is a recency slice of the delta-poll coverage
// billsRegistry.ts already documents (BILLS_COVERAGE_NOTE) — not a claim
// that these are the *only* bills that moved recently, just the most
// recently active ones this site has actually ingested. The full set is
// still one click away via /bills.
const RECAP_BILL_COUNT = 20;
function recentlyActiveBills(bills: Bill[]): Bill[] {
  return bills
    .filter((bill) => latestActionDate(bill) !== null)
    .sort((a, b) => (latestActionDate(b) ?? "").localeCompare(latestActionDate(a) ?? ""))
    .slice(0, RECAP_BILL_COUNT);
}

function billSourceUrl(bill: Bill): string {
  return bill.sources.find((s) => s.url)?.url ?? bill.provenance.primarySourceUrl;
}

// A bill can carry more than one roll call (BillVote's own comment in
// types.ts: "an amendment, then final passage") — this recap shows the
// most recent one per bill, not the full history (that's /bills' job once
// it renders per-bill detail).
function mostRecentVoteEventFor(bill: Bill, voteEvents: BillVoteEvent[]): BillVoteEvent | null {
  const matches = voteEvents.filter((v) => v.billId === bill.id);
  if (matches.length === 0) return null;
  return [...matches].sort((a, b) => b.date.localeCompare(a.date))[0];
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function BillRow({ bill, voteEvent }: { bill: Bill; voteEvent: BillVoteEvent | null }) {
  const action = mostRecentAction(bill);
  const tally = voteEvent?.tallies[0] ?? null;
  // Prefer the roll call's own source page (house.mn.gov / senate.mn.gov
  // vote detail) when one exists; the tally itself, not just a bare "pass"
  // word, is what makes this row a receipt rather than an assertion.
  const voteUrl = voteEvent?.sources.find((s) => s.url)?.url ?? tally?.url ?? null;

  return (
    <li className="well rounded-xl border border-hair p-4">
      <p className="font-medium text-ink-2">
        {bill.identifier} — {bill.title}
      </p>
      {action && (
        <p className="mt-1 text-sm text-ink-3">
          Most recent action: {action.description} ({formatDate(action.date)})
        </p>
      )}
      {voteEvent && tally ? (
        <p className="mt-1 text-sm text-ink-2">
          Roll call ({formatDate(voteEvent.date)}): <span className="font-medium">{voteEvent.result}</span>,{" "}
          {tally.yes}–{tally.no}
          {tally.other > 0 ? `–${tally.other} other` : ""}
          {voteEvent.tallyDisagreement && (
            <span className="ml-1 text-xs text-ink-4">(sources disagree on the exact count — see the bill for both)</span>
          )}
        </p>
      ) : (
        // AGENTS.md §3.2: "voice votes ... recorded as 'no recorded vote,'
        // itself a finding." Surfaced, never silently dropped and never a
        // fabricated tally.
        <p className="mt-1 text-sm text-ink-4">
          No recorded floor roll call for this bill yet — its most recent action was not a recorded vote.
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        <a href={billSourceUrl(bill)} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
          Bill text &amp; status
        </a>
        {voteUrl && (
          <a href={voteUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
            Full roll call
          </a>
        )}
      </div>
    </li>
  );
}

function StateLegislatureSection() {
  const bills = loadBills();
  const voteEvents = loadBillVoteEvents();
  const isBillsLive = BILLS_INGEST_STATUS === "live" && bills.length > 0;
  const rows = isBillsLive ? recentlyActiveBills(bills) : [];

  return (
    <section aria-labelledby="recap-state" className="mt-10">
      <h2 id="recap-state" className="text-lg font-bold text-ink">
        Minnesota Legislature
      </h2>
      {isBillsLive ? (
        <>
          <p className="mt-1 text-sm text-ink-3">
            The {rows.length} most recently active bills this site has ingested, newest action first. See{" "}
            <a href="/bills" className="text-accent underline underline-offset-2">
              /bills
            </a>{" "}
            for the full ingested set ({bills.length} bills).
          </p>
          <ul className="mt-3 space-y-3">
            {rows.map((bill) => (
              <BillRow key={bill.id} bill={bill} voteEvent={mostRecentVoteEventFor(bill, voteEvents)} />
            ))}
          </ul>
        </>
      ) : (
        <div role="status" className="well mt-3 space-y-2 rounded-xl border border-hair-strong p-4 text-sm text-ink-3">
          <p className="font-medium text-ink-2">No bill data ingested yet.</p>
          {/* BILLS_COVERAGE_NOTE quoted verbatim from billsRegistry.ts, per
              this page's own task brief, so this empty state can't drift
              out of sync with /bills' own wording of the same gap. */}
          <p>{BILLS_COVERAGE_NOTE}</p>
          <p>
            See{" "}
            <a href="https://www.revisor.mn.gov/bills/" className="text-accent underline underline-offset-2">
              the Minnesota Revisor&apos;s own bill search
            </a>{" "}
            in the meantime.
          </p>
        </div>
      )}
    </section>
  );
}

// The exact consent-pill markup and copy from src/app/meetings/page.tsx's
// MeetingCard — reused verbatim per this page's own task brief, rather than
// a second visual/copy convention for the same underlying flag
// (MeetingAgendaItem.isConsent) drifting into existence.
function ConsentPill() {
  return (
    <span
      className="mt-0.5 inline-block shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent"
      title="Passed on the consent agenda — approved as a group with no individual discussion or vote called out. AGENTS.md §0.4: 'flag items passed on consent.'"
    >
      Consent
    </span>
  );
}

function LegistarJurisdictionSection({
  jurisdiction,
  votesFeed,
  meetingsFeed,
  calendarUrl,
  votesCoverage,
}: {
  jurisdiction: string;
  votesFeed: LegistarFullIngestFeed | undefined;
  meetingsFeed: MeetingsFeed | undefined;
  calendarUrl: string;
  votesCoverage: string;
}) {
  const votesLive = votesFeed?.status === "ingested" && (votesFeed?.voteEvents.length ?? 0) > 0;
  const recentVoteEvents = votesLive
    ? [...(votesFeed?.voteEvents ?? [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10)
    : [];

  const today = new Date().toISOString().slice(0, 10);
  const recentConsentItems = meetingsFeed
    ? meetingsFeed.agendaItems
        .filter((item) => item.isConsent)
        .map((item) => ({ item, meeting: meetingsFeed.meetings.find((m) => m.id === item.meeting_id) ?? null }))
        .filter((row) => row.meeting?.date && row.meeting.date < today)
        .sort((a, b) => (b.meeting?.date ?? "").localeCompare(a.meeting?.date ?? ""))
        .slice(0, 8)
    : [];

  const anyLive = votesLive || recentConsentItems.length > 0;

  return (
    <section aria-labelledby={`recap-${votesFeed?.client ?? jurisdiction}`} className="mt-10">
      <h2 id={`recap-${votesFeed?.client ?? jurisdiction}`} className="text-lg font-bold text-ink">
        {jurisdiction}
      </h2>
      <p className="mt-1 text-sm text-ink-3">{votesCoverage}</p>

      {!anyLive ? (
        <div role="status" className="well mt-3 space-y-2 rounded-xl border border-hair-strong p-4 text-sm text-ink-3">
          <p className="font-medium text-ink-2">No recent votes or consent-agenda action on file right now.</p>
          <p>
            See{" "}
            <a href={calendarUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
              {jurisdiction}&rsquo;s own meeting calendar
            </a>{" "}
            in the meantime.
          </p>
        </div>
      ) : (
        <>
          {votesLive && (
            <div className="mt-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-3">Recent roll-call votes</h3>
              <ul className="mt-2 space-y-2">
                {recentVoteEvents.map((voteEvent) => {
                  const agendaItem = votesFeed?.agendaItems.find((a) => a.id === voteEvent.agenda_item_id) ?? null;
                  const href = agendaItem?.source_url ?? votesFeed?.provenance.primarySourceUrl ?? calendarUrl;
                  return (
                    <li key={voteEvent.id} className="well rounded-xl border border-hair p-3 text-sm">
                      <p className="text-ink-2">
                        {agendaItem?.file_number ? <span className="font-medium">{agendaItem.file_number}</span> : null}
                        {agendaItem?.file_number ? " — " : ""}
                        {agendaItem?.title ?? "Untitled agenda item"}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-4">
                        {voteEvent.result} · {formatDate(voteEvent.date)}
                      </p>
                      <a href={href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-accent underline underline-offset-2">
                        Legislation record
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {recentConsentItems.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-3">Recent consent-agenda items</h3>
              <p className="mt-1 text-xs text-ink-4">
                Approved as a group with no individual discussion or vote called out — AGENTS.md §0.4: &ldquo;make the routine
                visible.&rdquo;
              </p>
              <ul className="mt-2 space-y-2">
                {recentConsentItems.map(({ item, meeting }) => (
                  <li key={item.id} className="well rounded-xl border border-hair p-3 text-sm">
                    <div className="flex items-start gap-2">
                      <ConsentPill />
                      <span className="text-ink-2">
                        {item.matterFile ? <span className="font-medium">{item.matterFile}</span> : null}
                        {item.matterFile ? " — " : ""}
                        {item.title}
                      </span>
                    </div>
                    {meeting?.date && <p className="mt-0.5 text-xs text-ink-4">{formatDate(meeting.date)}</p>}
                    {meeting?.sourceUrl && (
                      <a
                        href={meeting.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-accent underline underline-offset-2"
                      >
                        Official meeting record
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {votesFeed && (
            <p className="mt-3 text-xs text-ink-4">
              Roll-call data from {votesFeed.provenance.sourceAgency} via the Legistar public API, fetched{" "}
              {votesFeed.provenance.fetchedAt ?? "unknown time"}. See{" "}
              <a href={votesFeed.provenance.primarySourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                the raw feed
              </a>
              .
            </p>
          )}
        </>
      )}
    </section>
  );
}

// Minneapolis's LIMS feed carries agenda-item-level pass/fail results
// (passedFlagName) but not per-councilmember Holding/Vote data or a
// consent-agenda flag the way the Legistar feeds do (see
// MINNEAPOLIS_MEETINGS_VOTES_LAYER's knownGaps) — LegistarJurisdictionSection
// above assumes both exist, so this is a purpose-built (not shared)
// rendering rather than a mismatched reuse of that component.
function MinneapolisSection({ meetingsFeed }: { meetingsFeed: MeetingsFeed | undefined }) {
  const today = new Date().toISOString().slice(0, 10);
  const recentActions = meetingsFeed
    ? meetingsFeed.agendaItems
        .filter((item) => item.passedFlagName)
        .map((item) => ({ item, meeting: meetingsFeed.meetings.find((m) => m.id === item.meeting_id) ?? null }))
        .filter((row) => row.meeting?.date && row.meeting.date < today)
        .sort((a, b) => (b.meeting?.date ?? "").localeCompare(a.meeting?.date ?? ""))
        .slice(0, 8)
    : [];
  const isLive = meetingsFeed?.status === "ingested" && recentActions.length > 0;

  return (
    <section aria-labelledby="recap-minneapolis" className="mt-10">
      <h2 id="recap-minneapolis" className="text-lg font-bold text-ink">
        Minneapolis City Council
      </h2>
      <p className="mt-1 text-sm text-ink-3">{MINNEAPOLIS_MEETINGS_VOTES_LAYER.coverage}</p>

      {!isLive ? (
        <div role="status" className="well mt-3 space-y-2 rounded-xl border border-hair-strong p-4 text-sm text-ink-3">
          <p className="font-medium text-ink-2">No recent agenda action on file right now.</p>
          <p>
            See{" "}
            <a
              href={MINNEAPOLIS_MEETINGS_ENTRY?.calendarUrl ?? MINNEAPOLIS_MEETINGS_VOTES_LAYER.primarySourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-2"
            >
              Minneapolis&rsquo;s own LIMS council record
            </a>{" "}
            in the meantime.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-3">Recent agenda action</h3>
            <p className="mt-1 text-xs text-ink-4">
              Item-level result only — LIMS doesn&rsquo;t expose which councilmember voted which way the way Legistar does
              for St. Paul and Hennepin County above, and has no consent-agenda flag equivalent (see coverage note).
            </p>
            <ul className="mt-2 space-y-2">
              {recentActions.map(({ item, meeting }) => (
                <li key={item.id} className="well rounded-xl border border-hair p-3 text-sm">
                  <p className="text-ink-2">
                    {item.matterFile ? <span className="font-medium">{item.matterFile}</span> : null}
                    {item.matterFile ? " — " : ""}
                    {item.title}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-4">
                    {item.passedFlagName} · {meeting?.date ? formatDate(meeting.date) : "date unknown"}
                  </p>
                  {meeting?.sourceUrl && (
                    <a
                      href={meeting.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-accent underline underline-offset-2"
                    >
                      Official meeting record
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {meetingsFeed && (
            <p className="mt-3 text-xs text-ink-4">
              Meeting/agenda data from {meetingsFeed.provenance.sourceAgency} via the LIMS API, fetched{" "}
              {meetingsFeed.provenance.fetchedAt ?? "unknown time"}. See{" "}
              <a
                href={meetingsFeed.provenance.primarySourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                the raw feed
              </a>
              .
            </p>
          )}
        </>
      )}
    </section>
  );
}

function CongressSection() {
  return (
    <section aria-labelledby="recap-congress" className="mt-10">
      <h2 id="recap-congress" className="text-lg font-bold text-ink">
        U.S. Congress
      </h2>
      <div role="status" className="well mt-3 space-y-2 rounded-xl border border-hair-strong p-4 text-sm text-ink-3">
        <p className="font-medium text-ink-2">Not connected yet.</p>
        <p>
          No ingest script or data file exists in this repo for federal roll-call votes, bills, or sponsorships. AGENTS.md
          §3.2 names Congress.gov (bills, sponsorships, roll calls) and Bioguide (officeholder term/committee data) as the
          intended Tier 1 sources for Minnesota&rsquo;s federal House and Senate delegation, but neither has been wired up
          yet — this is an honest gap, not a placeholder (AGENTS.md §3.1).
        </p>
        <p>
          See{" "}
          <a href="https://www.congress.gov/" target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
            Congress.gov
          </a>{" "}
          in the meantime.
        </p>
      </div>
    </section>
  );
}

export default function RecapPage() {
  const stpaulVotes = stpaulVotesData as LegistarFullIngestFeed;
  const hennepinVotes = hennepinmnVotesData as LegistarFullIngestFeed;
  const stpaulMeetings = stpaulMeetingsData as MeetingsFeed;
  const hennepinMeetings = hennepinmnMeetingsData as MeetingsFeed;
  const minneapolisMeetings = minneapolisMeetingsData as MeetingsFeed;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-xl font-semibold text-ink">Recap: what got voted on</h1>
      <p className="mt-2 text-sm text-ink-3">
        A plain-language, sourced recap of recent votes and consent-agenda action — AGENTS.md&rsquo;s question 2, &ldquo;What
        do they vote for?&rdquo; — across every level of Minnesota government this site currently tracks. Every row links to
        its own primary source; a level with no connected feed says so plainly instead of going unmentioned.
      </p>

      <StateLegislatureSection />

      <LegistarJurisdictionSection
        jurisdiction="St. Paul City Council"
        votesFeed={stpaulVotes}
        meetingsFeed={stpaulMeetings}
        calendarUrl={STPAUL_MEETINGS_ENTRY?.calendarUrl ?? "https://www.stpaul.gov/meetings-agendas-and-minutes"}
        votesCoverage={STPAUL_ENTRY?.coverage ?? ""}
      />

      <LegistarJurisdictionSection
        jurisdiction="Hennepin County Board"
        votesFeed={hennepinVotes}
        meetingsFeed={hennepinMeetings}
        calendarUrl={HENNEPIN_MEETINGS_ENTRY?.calendarUrl ?? "https://www.hennepincounty.gov/government/board-meetings"}
        votesCoverage={HENNEPIN_ENTRY?.coverage ?? ""}
      />

      <MinneapolisSection meetingsFeed={minneapolisMeetings} />

      <CongressSection />
    </main>
  );
}
