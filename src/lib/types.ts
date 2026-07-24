export interface CandidateInfo {
  name: string;
  party: string;
  isIncumbent: boolean;
  // e.g. "Democratic Socialists of America" — organizations that have
  // publicly endorsed this candidate. Not a ballot-line party; kept
  // separate from `party` since a candidate can carry several of these.
  endorsements: string[];
}

export interface BillVote {
  // The roll call's own id (Open States' ocd-vote/... identifier) — a bill
  // can carry more than one roll call on the same day (an amendment, then
  // final passage), so identifier+date alone isn't a unique key for this.
  voteId: string;
  identifier: string; // e.g. "HF 4541"
  title: string;
  option: string; // this legislator's own vote: "yes" | "no" | etc.
  result: string; // the roll call's outcome: "pass" | "fail"
  date: string; // ISO date the vote was taken
  openstatesUrl: string | null;
}

export interface RepProperties {
  role: "Mayor" | "Council Member" | "County Commissioner" | "State Representative" | "State Senator";
  // "Minneapolis" | "St. Paul" — drives map color/filter grouping for every
  // role, including commissioners: a Hennepin district is grouped/colored
  // with Minneapolis, Ramsey with St. Paul, even though the district itself
  // covers a lot of suburbs the city name doesn't literally describe. `county`
  // below carries the accurate label for display.
  city: string;
  county: string | null;
  ward: number | null;
  district: number | null;
  // MN House/Senate districts are alphanumeric ("47B", "50"), not the plain
  // numbers `district` above holds for county commissioners — a separate
  // field rather than widening `district`'s type for every other role.
  stateDistrict: string | null;
  chamber: "house" | "senate" | null;
  repName: string | null;
  repParty: string;
  repPhotoUrl: string | null;
  repEmail: string | null;
  repPhone: string | null;
  officeSince: string;
  committees: string[];
  neighborhoods: string[];
  officeRoom: string | null;
  profileUrl: string | null;
  // Who's on the ballot for this seat's next election — independent of
  // repName above, which is always the current officeholder whether or not
  // they're running again. Empty until real filing data is sourced (no
  // clean API for this; see fetch-*.mjs).
  candidates: CandidateInfo[];
  // Precomputed candidates.length >= 2, set alongside candidates in the
  // same fetch script so it can't drift. Exists as its own primitive field
  // (not just derived from candidates.length at render time) because
  // MapLibre's fill/line-layer filter expressions need something they can
  // read directly off the tiled feature — see WardModal's isContested()
  // for the derivation this mirrors, used everywhere outside a layer filter.
  isContested: boolean;
  // State legislators only (null for every other role): share of this
  // legislator's own party-line roll-call votes where they voted with
  // their party's majority — see scripts/fetch-state-legislature.mjs for
  // the exact method. Null, not 0, when there weren't enough sampled
  // votes to compute a number worth showing.
  partyUnityPercent: number | null;
  // A handful of this legislator's most recent roll-call votes, newest
  // first — doubles as "what have they been voting on" and as the raw
  // material partyUnityPercent above is computed from.
  recentVotes: BillVote[];
}

export interface Hearing {
  title: string;
  datetime: string;
  location: string;
}
