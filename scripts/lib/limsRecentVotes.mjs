// scripts/lib/limsRecentVotes.mjs
//
// Follow-up to #102's meetings/agenda PR — joins scripts/ingest/
// lims-minneapolis.mjs's already-fetched per-item roll call
// (public/lims/minneapolis-meetings.json's agendaItems[].votes[]) into
// the RepProperties.recentVotes shape fetch-wards.mjs writes into
// wards.geojson. Mirrors scripts/lib/legistarRecentVotes.mjs's shape and
// surname-matching approach exactly, adapted for LIMS's response
// structure: Legistar resolves votes to a `holding_id` via a separate
// votes[]/voteEvents[]/holdings[] join across public/legistar/{client}.json;
// LIMS instead embeds { MemberName, Vote } directly on each agenda item's
// LegislativeHistory row, so the "join" here is just building a
// meeting-id -> meeting lookup for date/sourceUrl and a surname index over
// agendaItems[].votes[] — no separate holdings table exists or is needed.
//
// Scope: Minneapolis City Council only (the one body LIMS's meetingCalendar/
// FileItemSearch cover). Reads the committed public/lims/
// minneapolis-meetings.json snapshot directly — no network call, so a
// fetch-wards.mjs run never depends on lims-minneapolis.mjs having just
// run, and continues to build fine with LIMS unreachable (AGENTS.md
// §0.8/§3.2).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Shared with scripts/lib/legistarRecentVotes.mjs — see that file's own
// comment for why the normalization itself is shared but the
// warn-on-mismatch behavior stays per-caller.
import { normalizeSurname } from "./surnameMatch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, "../../public/lims/minneapolis-meetings.json");

// Same "a handful of most-recent votes, not a dense history" convention
// every recentVotes producer in this repo uses.
const RECENT_VOTES_TO_KEEP = 5;

// LIMS's confirmed vote-value vocabulary (LESSONS.md, 2026-08 —
// cross-checked against a full year of live FileItemSearch data: only
// Aye/Nay/Absent/Abstain ever appear) mapped onto the same option
// vocabulary legistarRecentVotes.mjs normalizes Legistar's values to, so
// WardModal's VoteRow rendering doesn't need to know which upstream a
// given BillVote came from. Extra entries below (excused/not voting) are
// defensive, matching Legistar's map, even though live data has never
// shown them from LIMS — an unrecognized value falls to "other" rather
// than being guessed.
const VOTE_VALUE_MAP = {
  aye: "yes",
  yes: "yes",
  nay: "no",
  no: "no",
  abstain: "other",
  absent: "absent",
  excused: "excused",
  "not voting": "not voting",
};

function mapLimsVoteValue(rawValue) {
  const normalized = String(rawValue ?? "").trim().toLowerCase();
  return VOTE_VALUE_MAP[normalized] ?? "other";
}

let cachedIndex = null;

function buildIndex(data) {
  const bySurname = new Map(); // normalized surname -> BillVote[]
  const knownSurnames = new Set(); // every surname LIMS's votes[] mention, regardless of window position
  if (!data || !Array.isArray(data.meetings) || !Array.isArray(data.agendaItems)) {
    return { bySurname, knownSurnames };
  }

  const meetingsById = new Map(data.meetings.map((m) => [m.id, m]));

  for (const item of data.agendaItems) {
    const votes = Array.isArray(item.votes) ? item.votes : [];
    if (!votes.length) continue;
    // lims-minneapolis.mjs drops any agenda item whose meeting_id
    // doesn't resolve to a real Meeting rather than shipping one with a
    // synthesized id (AGENTS.md §3.1) — every item.meeting_id here is
    // expected to resolve. Skip defensively rather than build a BillVote
    // with a null `date` (src/lib/types.ts types it as a required
    // string, not string | null) if that invariant is ever violated.
    const meeting = meetingsById.get(item.meeting_id);
    if (!meeting || !meeting.date) continue;

    for (const vote of votes) {
      const surname = normalizeSurname(vote.memberName);
      if (!surname) continue;
      knownSurnames.add(surname);

      const billVote = {
        voteId: `${item.id}-${surname}`,
        identifier: item.matterFile ?? "",
        title: item.title ?? "",
        option: mapLimsVoteValue(vote.value),
        result: (item.passedFlagName ?? "").toLowerCase(),
        date: meeting.date,
        // LIMS doesn't resolve a per-item public record URL the way
        // Legistar's InSite Gateway.aspx redirect does — the meeting's
        // own agenda/source link is the closest real citation available.
        sourceUrl: meeting.sourceUrl ?? null,
      };
      if (!bySurname.has(surname)) bySurname.set(surname, []);
      bySurname.get(surname).push(billVote);
    }
  }

  for (const [surname, votes] of bySurname) {
    votes.sort((a, b) => b.date.localeCompare(a.date));
    bySurname.set(surname, votes.slice(0, RECENT_VOTES_TO_KEEP));
  }
  return { bySurname, knownSurnames };
}

function loadIndex() {
  if (cachedIndex) return cachedIndex;
  let data = null;
  try {
    data = JSON.parse(readFileSync(DATA_PATH, "utf8"));
  } catch (err) {
    // Missing/unreadable file -> empty index, same as
    // lims-minneapolis.mjs's own honest-empty-state fallback. Never
    // throws: a fetch-wards.mjs run must still succeed with no LIMS data
    // on disk (AGENTS.md §0.8).
    console.warn(`[limsRecentVotes] no usable ${DATA_PATH} (${err.message}) — recentVotes will stay empty for Minneapolis.`);
  }
  cachedIndex = buildIndex(data);
  return cachedIndex;
}

// repName is fetch-wards.mjs's MINNEAPOLIS_ROSTER[wardNum] value —
// surname-matched against every MemberName LIMS's roll calls mention.
// Returns [] (not an error) for a name that doesn't resolve, and logs
// once so a silent mismatch is still visible in the fetch script's own
// console output.
export function recentVotesFromLims(repName) {
  const { bySurname, knownSurnames } = loadIndex();
  const surname = normalizeSurname(repName);
  if (!surname) return [];
  const votes = bySurname.get(surname);
  if (votes) return votes;
  // No votes for this surname — could be a real gap (this member simply
  // hasn't had a recorded roll call in the current window yet) or a
  // genuine name mismatch. Only the latter is worth flagging.
  if (!knownSurnames.has(surname)) {
    console.warn(`[limsRecentVotes] no LIMS vote match for "${repName}" (surname "${surname}") — recentVotes left empty.`);
  }
  return [];
}
