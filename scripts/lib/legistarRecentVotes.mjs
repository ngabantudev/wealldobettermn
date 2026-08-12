// scripts/lib/legistarRecentVotes.mjs
//
// Issue #57 — joins scripts/ingest/legistar.mjs's already-resolved
// holding→vote records (public/legistar/{client}.json) into the
// RepProperties.recentVotes shape fetch-wards.mjs and
// fetch-commissioners.mjs write into wards.geojson / commissioners.geojson.
// Mirrors what fetch-state-legislature.mjs's computePartyUnity() does for
// Open States roll calls, but this data is already joined to a `holding`
// (legistar.mjs's own job, per FEATURES.md Phase 4) — the only work left
// here is matching that holding back to *this* fetch script's own rep
// record and shaping the result as a BillVote (src/lib/types.ts).
//
// Scope: only clients legistar.mjs actually covers (stpaul, hennepinmn —
// see LEGISTAR_CLIENTS there). Minneapolis (LIMS, blocked on an API key)
// and Ramsey County (no known Legistar client) stay on the honest empty
// state WardModal.tsx already renders when recentVotes is []. Reads the
// committed public/legistar/*.json snapshot directly — no network call,
// so a fetch-wards.mjs / fetch-commissioners.mjs run never depends on
// legistar.mjs having just run, and both continue to build fine with the
// upstream API unreachable (AGENTS.md §0.8/§3.2).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Shared with scripts/lib/limsRecentVotes.mjs — see that file's own
// comment for why the normalization itself is shared but the
// warn-on-mismatch behavior stays per-caller.
import { normalizeSurname } from "./surnameMatch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Matches fetch-state-legislature.mjs's RECENT_VOTES_TO_KEEP — same "a
// handful of most-recent votes, not a dense history" shape the UI expects
// from every recentVotes producer.
const RECENT_VOTES_TO_KEEP = 5;

// Legistar's own vote-value vocabulary, mapped onto the same option
// vocabulary scripts/ingest/state-bills.mjs's mapVoteOption() normalizes
// Open States options to — so WardModal's rendering (and any future
// party-unity-style computation) doesn't need to know which upstream a
// given BillVote came from.
const VOTE_VALUE_MAP = {
  yea: "yes",
  yes: "yes",
  nay: "no",
  no: "no",
  abstain: "other",
  absent: "absent",
  excused: "excused",
  "not voting": "not voting",
};

function mapLegistarVoteValue(rawValue) {
  const normalized = String(rawValue ?? "").trim().toLowerCase();
  return VOTE_VALUE_MAP[normalized] ?? "other";
}

// Surname-only match, deliberately loose: fetch-wards.mjs/
// fetch-commissioners.mjs's own roster names ("Councilmember Anika
// Bowie", "Jeffrey Lunde") don't always match Legistar's official_name
// verbatim (nicknames — "Jeff Lunde" vs "Jeffrey Lunde" — and a
// "Councilmember " prefix St. Paul's source data carries). A body this
// small (7-13 current seats) makes a bare surname collision very
// unlikely; matchRecentVotes() below warns rather than guessing further
// if a name genuinely doesn't resolve, so a bad match is visible, not
// silent.

// One JSON parse per client per script run, not per rep.
const clientIndexCache = new Map();

function buildIndex(data) {
  const bySurname = new Map(); // normalized surname -> BillVote[]
  // Every surname Legistar's own person list carries for this client,
  // independent of whether they turned up in the (bounded, per
  // legistar.mjs's own knownGaps) votes window — lets
  // recentVotesFromLegistar() below tell "this person exists but has no
  // recorded votes yet" (expected, no warning) apart from "this name
  // doesn't match anyone Legistar knows about" (worth a warning).
  const knownSurnames = new Set();
  if (!data || !Array.isArray(data.holdings)) return { bySurname, knownSurnames };

  const persons = new Map((data.persons ?? []).map((p) => [p.id, p]));
  const agendaItems = new Map((data.agendaItems ?? []).map((a) => [a.id, a]));
  const voteEvents = new Map((data.voteEvents ?? []).map((v) => [v.id, v]));

  // holding_id -> surname, across every holding regardless of term dates.
  // Deliberately NOT filtered to "currently active" holdings: both known
  // clients' /officerecords data issues a fresh holding row (with its own
  // term_end) on re-election even for a continuously-serving member, and
  // a recent vote can carry a holding_id whose own term_end already
  // looks expired by that convention — confirmed against live data during
  // #57 (e.g. a August 2026 Hennepin vote attached to a holding whose
  // term_end reads "2024-12-31"). Filtering here would silently drop real
  // votes for sitting members. The tradeoff: a genuinely former
  // officeholder's votes would merge into a current member's recentVotes
  // if the two ever share an exact surname on the same small body — see
  // recentVotesFromLegistar()'s repName argument, which always comes from
  // this app's own current roster, not from Legistar's person list.
  const holdingSurname = new Map();
  for (const holding of data.holdings) {
    const person = persons.get(holding.person_id);
    if (!person) continue;
    const surname = normalizeSurname(person.official_name);
    holdingSurname.set(holding.id, surname);
    if (surname) knownSurnames.add(surname);
  }

  for (const vote of data.votes ?? []) {
    const surname = holdingSurname.get(vote.holding_id);
    if (!surname) continue; // vote references a holding/person we don't have — skip, don't attribute
    const voteEvent = voteEvents.get(vote.vote_event_id);
    const agendaItem = voteEvent ? agendaItems.get(voteEvent.agenda_item_id) : null;
    if (!voteEvent || !agendaItem) continue;

    const billVote = {
      voteId: vote.id,
      identifier: agendaItem.file_number || agendaItem.external_id || "",
      title: agendaItem.title ?? "",
      option: mapLegistarVoteValue(vote.value),
      result: (voteEvent.result ?? "").toLowerCase(),
      date: voteEvent.date,
      // legistar.mjs resolves this per matter via its InSite Gateway.aspx
      // redirect (see resolveLegislationUrl() there) — null only when
      // that resolution itself failed for this specific matter (a
      // per-matter knownGaps entry then explains why), never guessed.
      sourceUrl: agendaItem.source_url ?? null,
    };
    if (!bySurname.has(surname)) bySurname.set(surname, []);
    bySurname.get(surname).push(billVote);
  }

  for (const [surname, votes] of bySurname) {
    votes.sort((a, b) => b.date.localeCompare(a.date));
    bySurname.set(surname, votes.slice(0, RECENT_VOTES_TO_KEEP));
  }
  return { bySurname, knownSurnames };
}

function loadClientIndex(client) {
  if (clientIndexCache.has(client)) return clientIndexCache.get(client);
  const filePath = path.join(__dirname, `../../public/legistar/${client}.json`);
  let data = null;
  try {
    data = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    // Missing/unreadable file -> empty index, same as legistar.mjs's own
    // honest-empty-state fallback. Never throws: a fetch-wards.mjs run
    // must still succeed with no Legistar data on disk (AGENTS.md §0.8).
    console.warn(`[legistarRecentVotes] no usable public/legistar/${client}.json (${err.message}) — recentVotes will stay empty for this client.`);
  }
  const index = buildIndex(data);
  clientIndexCache.set(client, index);
  return index;
}

// repName is whatever name string the calling fetch-*.mjs already has for
// this seat (St. Paul's ArcGIS `name` field, Hennepin's hand-transcribed
// roster `name`) — surname-matched against the Legistar client's current
// roster. Returns [] (not an error) for a name that doesn't resolve, and
// logs once so a silent mismatch is still visible in the fetch script's
// own console output.
export function recentVotesFromLegistar(client, repName) {
  const { bySurname, knownSurnames } = loadClientIndex(client);
  const surname = normalizeSurname(repName);
  if (!surname) return [];
  const votes = bySurname.get(surname);
  if (votes) return votes;
  // No votes for this surname — could be a real gap (this member simply
  // hasn't had a recorded vote in legistar.mjs's bounded window yet) or a
  // genuine name mismatch. Only the latter is worth flagging.
  if (!knownSurnames.has(surname)) {
    console.warn(`[legistarRecentVotes] no ${client} Legistar match for "${repName}" (surname "${surname}") — recentVotes left empty.`);
  }
  return [];
}
