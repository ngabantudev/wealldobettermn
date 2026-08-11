// src/lib/communityExtraction.ts
//
// Officeholder extraction for the Community Contribution Pipeline
// (AGENTS.md §2.6). This is the single most important correctness/safety
// file in that feature: it decides whether a name a visitor's submitted
// page mentions is ever allowed to become a published officeholder
// record. Nothing downstream re-checks its work — a record that survives
// this module goes live on the map immediately, badged "pending."
//
// Five independent layers enforce AGENTS.md §1b/§1d's "no variant for a
// private individual, by construction" here, NOT one prompt:
//   1. Schema-level restriction — the model's requested response schema
//      types `role` as a two-value enum, "Mayor" | "Council Member" only.
//   2. Quote verification — every record's `roleSourceQuote` is checked,
//      server-side, as an actual substring of the fetched page's own
//      visible text, AND as actually containing that specific person's
//      own name (not just any real text from the page — Workers AI's
//      smaller model, caught live against a real submission, will
//      sometimes reuse one person's genuine quote for several others in
//      the same list rather than relocating each one individually). A
//      record whose quote can't be found, or doesn't name the person
//      it's attached to, is dropped regardless of what the model
//      "meant" — this is the load-bearing check, because it means a
//      hallucinated OR misattributed record physically cannot survive,
//      independent of prompt compliance.
//   3. Keyword denylist — text surrounding a surviving quote is checked
//      against staff/clerk/administrator terms, catching a model that
//      mislabels a name it saw near "Mayor" in a staff-directory table.
//   4. Role-evidence check — text surrounding a surviving quote must
//      actually contain the claimed role's own keyword ("mayor" /
//      "council member"). Needed because many real city pages state a
//      role only ONCE, as a heading over a list of names, rather than
//      repeating it next to every person (found live against Grant,
//      MN) — the prompt no longer asks the model to fabricate role
//      wording that isn't there, so this mechanically covers what that
//      used to (unreliably) guarantee.
//   5. Minimum-viable-result gate — zero surviving records, or no mention
//      of the submitted city's own name anywhere on the page, fails the
//      whole submission with an explanation. Never a guess, never a
//      partial publish (AGENTS.md §3.3 "never fabricate or infer").
//
// `repPhotoUrl` is never populated here — AGENTS.md §1b's bar on official
// portraits ("never a scraped image") is too high to automate safely yet.
//
// CAVEAT, stated plainly rather than glossed over: the exact Workers AI
// request/response shape assumed below (`response_format: json_schema`,
// a `messages` chat array, the specific model id) reflects Cloudflare's
// documented behavior for instruct models at the time this was written,
// but has not been exercised against a live Workers AI binding in this
// environment — there is no Cloudflare account access here to verify it.
// `parseModelOutput()` is deliberately defensive about the response
// shape (see its own comment) precisely because of that uncertainty.
// Verify against a real `wrangler dev` run with the AI binding attached
// before relying on this in production, and adjust AI_MODEL/the request
// shape there if Workers AI's actual behavior differs.

import { extractPageTitle, htmlToVisibleText, normalize, normalizedIncludes } from "./htmlText.ts";
import { COMMUNITY_EXTRACTION_MAX_CHARS } from "./communityConfig.ts";

export const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Minimal shape this module needs from Cloudflare's `Ai` binding — kept
 * narrow and injectable so tests never touch a real binding. */
export interface CommunityAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

const ALLOWED_ROLES = ["Mayor", "Council Member"] as const;
export type AllowedRole = (typeof ALLOWED_ROLES)[number];

export interface ValidatedOfficial {
  role: AllowedRole;
  repName: string;
  repEmail: string | null;
  repPhone: string | null;
  roleSourceQuote: string;
  // The ward/district/seat phrase as the page itself states it (e.g. "Ward
  // 2", "District 3", "At Large"), or null if the page doesn't say one —
  // NOT a resolved ward join key, and NOT backed by any polygon geometry.
  // This pipeline only ever reads the text of the page a visitor submits;
  // it never ingests a GIS/boundary file, and never will (see AGENTS.md
  // §2.6's "never resolves ward-accurate boundaries" non-goal — a
  // community-submitted city stays modeled as a single at-large point
  // regardless of what this field says). A city hall's own site is
  // usually the ONLY source that already states this in plain text next
  // to each name, so it's free to capture here — verified the same way
  // roleSourceQuote is (see validateExtraction below) — but unlike a bad
  // roleSourceQuote, a wardLabel that can't be verified against the page
  // just gets dropped to null rather than rejecting the whole official:
  // it's supplementary, not load-bearing for whether this is a real
  // office. Real ward-accurate boundary data for a graduated city, if it
  // ever happens, is a separate, hand-researched effort — the same way
  // Minneapolis/St. Paul's wards were built — never crowdsourced from a
  // submitted URL.
  wardLabel: string | null;
  // The term-expiration text as the page itself states it (e.g. "December
  // 31, 2028", "Term Expires: 2026"), or null if the page doesn't say
  // one — same verified-but-non-load-bearing treatment as wardLabel
  // above: dropped to null rather than rejecting the whole official if
  // it can't be found verbatim on the page. Stored as the page's own raw
  // text, not a parsed Date — term-date formats vary too much across MN
  // city sites to normalize reliably, and a wrong parse presented as
  // confident structured data would be worse than an honest string. Any
  // "is this term expired" comparison against today's date happens at
  // render time (CommunityOfficialsList.tsx), not here — a term that
  // hasn't expired yet at submission time could still expire before
  // anyone reviews it.
  termExpires: string | null;
}

export type RejectReason =
  | "empty_name"
  | "role_not_in_enum"
  | "quote_not_found_in_source"
  | "quote_missing_person_name"
  | "denylist_keyword_nearby"
  | "role_not_evidenced_nearby";

export interface RejectedMention {
  repName: string;
  claimedRole: string;
  reason: RejectReason;
}

export type ExtractionFailureReason = "no_city_name_evidence" | "no_officials_survived" | "model_output_unparseable" | "model_error";

export type ExtractionResult =
  | { ok: true; officials: ValidatedOfficial[]; rejectedMentions: RejectedMention[] }
  | { ok: false; reason: ExtractionFailureReason; message: string; rejectedMentions: RejectedMention[] };

// Checked against the text surrounding a surviving quote (see
// hasDenylistKeywordNearby below) — catches a model that mislabels a name
// it saw near "Mayor"/"Council Member" in a staff-directory table.
//
// Deliberately NOT "staff": a real submission (Hugo, MN's council page)
// had a "Staff Contact" section LABEL sitting immediately before its
// entire officials list — every one of five real, correctly-elected
// council members and the mayor fell inside this window's reach of that
// one heading, and three of five were wrongly rejected before this fix.
// "staff" is a generic collective noun that shows up constantly as page
// furniture ("Staff Directory," "Contact Staff") without describing any
// specific person's role, unlike the other words here (a real "City
// Clerk Jane Smith" or "City Manager John Doe" IS naming that person's
// actual job). Caught in live testing, not a hypothetical.
const DENYLIST_KEYWORDS = [
  "clerk",
  "administrator",
  "manager",
  "treasurer",
  "director",
  "attorney",
  "engineer",
  "secretary",
  "superintendent",
];

const DENYLIST_WINDOW_CHARS = 200;

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    officials: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string", enum: [...ALLOWED_ROLES] },
          repName: { type: "string" },
          // A verbatim snippet (a sentence or short phrase) from the
          // page's own text that includes THIS person's own name — never
          // paraphrased, and never reused across two different people's
          // records (validateExtraction mechanically rejects both: see
          // its quote_missing_person_name and quote_not_found_in_source
          // checks). It does NOT need to also state their role in the
          // same snippet — see buildExtractionPrompt's own comment on
          // why, and validateExtraction's hasRoleEvidenceNearby for the
          // mechanical check that covers what a per-person role
          // statement otherwise would have.
          roleSourceQuote: { type: "string" },
          // Only the OFFICE's published contact, never anything that
          // reads as personal — the model is instructed to use an empty
          // string for anything ambiguous (AGENTS.md §1d "when in doubt,
          // leave it out"). Plain `type: "string"`, not a `["string",
          // "null"]` union: Workers AI's JSON-mode docs warn compliance
          // "isn't guaranteed... with complex schemas," and a type union
          // on these two fields was the concrete cause of a live
          // "5024: JSON Model couldn't be met" error during testing —
          // validateExtraction() below already treats an empty/missing
          // string the same as it would have treated null.
          repEmail: { type: "string" },
          repPhone: { type: "string" },
          // The ward/district/seat phrase, copied verbatim from the page,
          // or an empty string if the page doesn't state one for this
          // person — same plain-string-not-union reasoning as repEmail/
          // repPhone above. Never a resolved boundary; see
          // ValidatedOfficial.wardLabel's own comment.
          wardLabel: { type: "string" },
          // The term-expiration text, copied verbatim from the page, or
          // an empty string if the page doesn't state one for this
          // person — same plain-string-not-union reasoning as the fields
          // above. See ValidatedOfficial.termExpires's own comment.
          termExpires: { type: "string" },
        },
        required: ["role", "repName", "roleSourceQuote"],
      },
    },
  },
  required: ["officials"],
} as const;

export function buildExtractionPrompt(cityName: string, pageText: string) {
  const system =
    `You extract elected officials from a city government website's own text. ` +
    `You may ONLY report a person if the page's own words identify them as the Mayor or ` +
    `a Council Member (or Councilmember/Councilperson/Alderperson — normalize any of ` +
    `these to "Council Member") of ${cityName}, Minnesota, currently holding that office. ` +
    `Never report city clerks, administrators, managers, treasurers, attorneys, engineers, ` +
    `department staff, or any other non-elected role, even if they appear in the same list ` +
    `or table as the officials you do report. Never report a private individual who is ` +
    `merely mentioned, quoted, or thanked on the page. For every person you report, ` +
    `"roleSourceQuote" MUST be an exact, verbatim snippet copied from the page text below — ` +
    `not a paraphrase or summary — that includes THIS SPECIFIC PERSON'S OWN name. Every ` +
    `person needs their own distinct quote copied from THEIR OWN part of the page — never ` +
    `reuse the same snippet, or another person's snippet, for more than one person, even ` +
    `if several people share one heading. Many city sites state a role only ONCE, as a ` +
    `heading over a list of several names (for example a "Council Members" heading ` +
    `followed by four different people with no role word repeated next to each one) — when ` +
    `that's the case, quote each person's OWN name and the text immediately around THEIR ` +
    `OWN entry (their own address, phone, or term info, not the heading or another person's ` +
    `info); do NOT invent or paraphrase role wording that isn't literally sitting next to ` +
    `their name, even if you're confident about their role from the heading above them. If the page ` +
    `states which ward, district, or seat this specific person represents (for example ` +
    `"Ward 2", "District 3", or "At Large"), copy that phrase verbatim into "wardLabel" — ` +
    `otherwise set "wardLabel" to an empty string. Never guess or infer a ward the page ` +
    `doesn't explicitly state for that person. If the page states when this specific ` +
    `person's term ends or expires (for example "Term Expires: 12/31/2026" or "December 31, ` +
    `2028"), copy that text verbatim into "termExpires" — otherwise set "termExpires" to an ` +
    `empty string. Never guess or infer a term date the page doesn't explicitly state for ` +
    `that person. Set repEmail/ ` +
    `repPhone to an empty string unless the page clearly presents that contact as belonging ` +
    `to the official's office itself, not a personal or ambiguous listing. Some links show a ` +
    `generic label like "Email Mayor Smith" with the real address in parentheses right after ` +
    `it — e.g. "Email Mayor Smith (mayor.smith@example.gov)" — in that case, repEmail/repPhone ` +
    `MUST be only the actual address or number in parentheses, never the label text before it. ` +
    `If the page names no ` +
    `current Mayor or Council Member of ${cityName} at all, return an empty officials array ` +
    `— never guess or infer a person who isn't explicitly named with their role.`;
  const user = `Page text (from a website submitted as ${cityName}'s official site):\n\n${pageText}`;
  return { system, user };
}

/**
 * Workers AI's exact response envelope for schema-constrained generation
 * is not something this environment can verify live (see module header).
 * Handle every plausible shape rather than assuming one: the parsed
 * object directly, a `.response` field holding either the object or a
 * JSON string, or nothing usable at all (returns null, never throws).
 */
export function parseModelOutput(raw: unknown): { officials: unknown[] } | null {
  const tryShape = (candidate: unknown): { officials: unknown[] } | null => {
    if (candidate && typeof candidate === "object" && Array.isArray((candidate as { officials?: unknown }).officials)) {
      return candidate as { officials: unknown[] };
    }
    return null;
  };

  const direct = tryShape(raw);
  if (direct) return direct;

  if (raw && typeof raw === "object" && "response" in raw) {
    const response = (raw as { response: unknown }).response;
    const fromObject = tryShape(response);
    if (fromObject) return fromObject;
    if (typeof response === "string") {
      try {
        return tryShape(JSON.parse(response));
      } catch {
        // Some models wrap JSON in prose or code fences despite
        // instructions — last-resort: find the first {...} block.
        const match = response.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            return tryShape(JSON.parse(match[0]));
          } catch {
            return null;
          }
        }
        return null;
      }
    }
  }
  return null;
}

// Word-boundary-aware, not a plain substring test: a naive
// `window.includes("director")` also matches inside "Directory" (e.g. a
// "Staff Directory" heading) — the same class of false positive the
// "staff" removal above fixes, just via a different word. \b isn't
// perfect for every case (won't catch a hyphenated or unusually-joined
// form) but covers the realistic "keyword embedded in a longer, unrelated
// word" case cheaply.
const DENYLIST_KEYWORD_RE = new RegExp(`\\b(?:${DENYLIST_KEYWORDS.join("|")})\\b`);

/**
 * Slices the `windowChars`-radius substring around a quote's
 * already-located position in the normalized page text — shared by
 * hasDenylistKeywordNearby and hasRoleEvidenceNearby below, which differ
 * only in window size and what pattern they test the result against.
 * Takes the quote's index/length rather than the quote text itself so
 * validateExtraction() can locate it exactly once per candidate (a quote
 * check, a name check, a denylist check, and a role-evidence check used
 * to each independently re-normalize the quote and re-scan the full page
 * text for it — up to four full-page scans per candidate for one `indexOf`
 * worth of information).
 */
function nearbyWindow(normalizedPage: string, quoteIndex: number, quoteLength: number, windowChars: number): string {
  const start = Math.max(0, quoteIndex - windowChars);
  const end = Math.min(normalizedPage.length, quoteIndex + quoteLength + windowChars);
  return normalizedPage.slice(start, end);
}

function hasDenylistKeywordNearby(normalizedPage: string, quoteIndex: number, quoteLength: number): boolean {
  return DENYLIST_KEYWORD_RE.test(nearbyWindow(normalizedPage, quoteIndex, quoteLength, DENYLIST_WINDOW_CHARS));
}

// The mechanical backstop for what buildExtractionPrompt's own comment
// explains: a real submission (Grant, MN's council page — found in live
// testing) states "Council Members" ONCE, as a heading, followed by four
// different people with no role word repeated next to any of them. The
// prompt no longer asks the model to quote role wording it doesn't have,
// so this fills the gap the removed requirement used to (badly) cover —
// requiring, mechanically, that the claimed role's own keyword actually
// appears somewhere near the quote, not just trusting the model's
// unverified role field. Wider than DENYLIST_WINDOW_CHARS on purpose: a
// shared heading can sit several people back from the last name in a
// realistic roster (measured against Grant's real page: up to ~330
// normalized characters from heading to 4th name), so a same-sized window
// would just recreate this bug for anyone but the first person or two
// after a heading. Still bounded, not "anywhere on the page" — an
// unrelated name mentioned far from any Mayor/Council Member heading
// still correctly fails this even with a verbatim, non-denylisted quote.
const ROLE_EVIDENCE_WINDOW_CHARS = 800;

const ROLE_EVIDENCE_PATTERNS: Record<AllowedRole, RegExp> = {
  Mayor: /\bmayor\b/,
  "Council Member": /\bcouncil\s*-?\s*(?:member|person)s?\b|\balderperson\b|\balder(?:man|woman)\b/,
};

/** Same nearbyWindow() as hasDenylistKeywordNearby, but checking for the
 * PRESENCE of evidence for the claimed role rather than the absence of a
 * denylisted one — see ROLE_EVIDENCE_WINDOW_CHARS's own comment for why
 * the window is wider. */
function hasRoleEvidenceNearby(normalizedPage: string, quoteIndex: number, quoteLength: number, role: AllowedRole): boolean {
  return ROLE_EVIDENCE_PATTERNS[role].test(nearbyWindow(normalizedPage, quoteIndex, quoteLength, ROLE_EVIDENCE_WINDOW_CHARS));
}

// A page-LEVEL (unbounded, not window-based) fallback for "Council
// Member" only — found live (Inver Grove Heights, MN): a real table
// listed a Mayor's row with "Mayor" right there, then four Council
// Member rows underneath with NO role word anywhere near them, not even
// far away — the page's ONLY textual signal that they're council members
// is its own <title>, "Mayor & Council | Inver Grove Heights, MN". No
// window size could bridge that gap, because there is nothing to find
// within any distance — the word simply never occurs near those names at
// all. A real government page whose own title explicitly frames itself
// as "Mayor & Council" (both words, the city's own description of the
// page) is real, if weaker, page-level evidence — deliberately NOT
// applied to "Mayor" (which self-identifies reliably via the "Mayor"
// prefix in every real case seen so far, so the tighter, proximity-bound
// check is both sufficient and safer to keep there) and deliberately
// requiring BOTH words together, not a bare "council" (which could just
// as easily be a "Planning Council" or "council meetings" page with
// nothing to do with the elected body).
const MAYOR_WORD_RE = /\bmayor\b/i;
const COUNCIL_WORD_RE = /\bcouncil\b/i;

export function pageTitleIndicatesMayorCouncilRoster(pageTitle: string | null): boolean {
  if (!pageTitle) return false;
  return MAYOR_WORD_RE.test(pageTitle) && COUNCIL_WORD_RE.test(pageTitle);
}

interface RawCandidate {
  role?: unknown;
  repName?: unknown;
  roleSourceQuote?: unknown;
  repEmail?: unknown;
  repPhone?: unknown;
  wardLabel?: unknown;
  termExpires?: unknown;
}

/**
 * Applies layers 1–4 (schema restriction, quote verification — including
 * the name-belongs-to-this-person check — denylist, and role-evidence) to
 * the model's raw candidates against the page's own visible text. Never
 * trusts the model's output on its own — every record here is
 * mechanically checked, not just prompt-compliant.
 */
export function validateExtraction(
  rawOfficials: unknown[],
  visiblePageText: string,
  // See pageTitleIndicatesMayorCouncilRoster's own comment — the page's
  // <title>, used only as a Council Member-specific role-evidence
  // fallback when the normal windowed check finds nothing nearby.
  // Optional/defaulted so every existing call site (and every existing
  // test) that doesn't care about this keeps working unchanged.
  pageTitle: string | null = null,
): { officials: ValidatedOfficial[]; rejectedMentions: RejectedMention[] } {
  const officials: ValidatedOfficial[] = [];
  const rejectedMentions: RejectedMention[] = [];
  // Normalized once here rather than per-candidate inside
  // normalizedIncludes()/hasDenylistKeywordNearby() below — a page with
  // several candidate officials was re-lowercasing/re-collapsing the
  // whole page text from scratch on every single one.
  const normalizedPageText = normalize(visiblePageText);
  // Computed once, reused for every "Council Member" candidate that fails
  // the normal windowed check — see pageTitleIndicatesMayorCouncilRoster's
  // own comment.
  const titleIndicatesRoster = pageTitleIndicatesMayorCouncilRoster(pageTitle);

  for (const entry of rawOfficials) {
    const candidate = (entry ?? {}) as RawCandidate;
    const repName = typeof candidate.repName === "string" ? candidate.repName.trim() : "";
    const claimedRole = typeof candidate.role === "string" ? candidate.role : "";
    const quote = typeof candidate.roleSourceQuote === "string" ? candidate.roleSourceQuote.trim() : "";

    if (!repName) {
      rejectedMentions.push({ repName: "(unnamed)", claimedRole, reason: "empty_name" });
      continue;
    }
    if (!ALLOWED_ROLES.includes(claimedRole as AllowedRole)) {
      rejectedMentions.push({ repName, claimedRole, reason: "role_not_in_enum" });
      continue;
    }
    if (!quote) {
      rejectedMentions.push({ repName, claimedRole, reason: "quote_not_found_in_source" });
      continue;
    }
    // Located exactly once here — normalizedQuote/quoteIndex are reused
    // by every check below instead of each one independently
    // re-normalizing the quote and re-scanning the full (uncapped)
    // page text for it.
    const normalizedQuote = normalize(quote);
    const quoteIndex = normalizedPageText.indexOf(normalizedQuote);
    if (!normalizedQuote || quoteIndex === -1) {
      rejectedMentions.push({ repName, claimedRole, reason: "quote_not_found_in_source" });
      continue;
    }
    // A real quote existing on the page isn't the same as it being THIS
    // person's quote — found in live testing against a real submission
    // (Grant, MN): Workers AI's smaller instruct model, given several
    // people to independently re-locate in a repetitive list, sometimes
    // takes the cheap way out and reuses one person's genuine, verbatim
    // quote for several OTHER candidates too, rather than doing the
    // harder work of finding each person's own local text. Every check
    // above this line still passes for a reused quote (it's real page
    // text, not a hallucination) — this is the one that actually catches
    // it, and it's exactly what buildExtractionPrompt's prompt asks for
    // ("that includes their name"), just mechanically enforced rather
    // than trusted.
    if (!normalizedQuote.includes(normalize(repName))) {
      rejectedMentions.push({ repName, claimedRole, reason: "quote_missing_person_name" });
      continue;
    }
    if (hasDenylistKeywordNearby(normalizedPageText, quoteIndex, normalizedQuote.length)) {
      rejectedMentions.push({ repName, claimedRole, reason: "denylist_keyword_nearby" });
      continue;
    }
    const roleEvidencedNearby = hasRoleEvidenceNearby(normalizedPageText, quoteIndex, normalizedQuote.length, claimedRole as AllowedRole);
    // Page-level fallback, Council Member only — see
    // pageTitleIndicatesMayorCouncilRoster's own comment on why "Mayor"
    // doesn't get this same fallback.
    const roleEvidenced = roleEvidencedNearby || (claimedRole === "Council Member" && titleIndicatesRoster);
    if (!roleEvidenced) {
      rejectedMentions.push({ repName, claimedRole, reason: "role_not_evidenced_nearby" });
      continue;
    }

    // Same load-bearing idea as the quote check above, applied to a
    // supplementary field: a wardLabel the model asserts but that never
    // actually appears on the page (a hallucinated "Ward 4" for an
    // at-large city, say) is dropped to null rather than trusted — but
    // unlike roleSourceQuote, an unverifiable wardLabel does NOT reject
    // the whole official. It's a bonus label, not proof of office; "when
    // in doubt, leave it out" (AGENTS.md §1d) applies to the label, not
    // to the person's entire record.
    const rawWardLabel = typeof candidate.wardLabel === "string" ? candidate.wardLabel.trim() : "";
    const wardLabel = rawWardLabel && normalizedPageText.includes(normalize(rawWardLabel)) ? rawWardLabel : null;
    const rawTermExpires = typeof candidate.termExpires === "string" ? candidate.termExpires.trim() : "";
    const termExpires = rawTermExpires && normalizedPageText.includes(normalize(rawTermExpires)) ? rawTermExpires : null;

    // Same "when in doubt, leave it out" treatment as wardLabel above,
    // now applied to contact fields too — found live (Oakdale, MN, before
    // the mailto:/tel: fix in htmlText.ts): a model with no real address
    // visible to it will sometimes invent one rather than leave the
    // field empty. Neither check rejects the whole official — a bad
    // phone/email is a data-quality issue on one field, not proof the
    // person isn't real.
    const rawRepEmail = typeof candidate.repEmail === "string" ? candidate.repEmail.trim() : "";
    const repEmail = rawRepEmail && normalizedPageText.includes(normalize(rawRepEmail)) ? rawRepEmail : null;
    const rawRepPhone = typeof candidate.repPhone === "string" ? candidate.repPhone.trim() : "";
    const repPhone = rawRepPhone && normalizedPageText.includes(normalize(rawRepPhone)) ? rawRepPhone : null;

    officials.push({
      role: claimedRole as AllowedRole,
      repName,
      repEmail,
      repPhone,
      // Stored verbatim (not the model's original casing/whitespace) so
      // a later audit can see exactly what was verified against — the
      // page's own text, not a normalized/lowercased copy of it.
      roleSourceQuote: quote,
      wardLabel,
      termExpires,
    });
  }

  return { officials, rejectedMentions };
}

export interface ExtractOfficialsParams {
  ai: CommunityAiBinding;
  pageHtml: string;
  cityName: string;
  model?: string;
}

/**
 * Orchestrates the full extraction: cheap city-name pre-filter (saves an
 * inference call on obviously-wrong URLs), the model call, defensive
 * parsing, and the full five-layer structural gate (see this module's own
 * header). Never throws — every failure mode is a typed,
 * plain-language-ready result (AGENTS.md §3.3).
 */
export async function extractOfficials(params: ExtractOfficialsParams): Promise<ExtractionResult> {
  const { ai, pageHtml, cityName, model = AI_MODEL } = params;
  const visiblePageText = htmlToVisibleText(pageHtml);
  const pageTitle = extractPageTitle(pageHtml);

  if (!normalizedIncludes(visiblePageText, cityName)) {
    return {
      ok: false,
      reason: "no_city_name_evidence",
      message: `That page doesn't appear to mention ${cityName} anywhere — it may be the wrong site.`,
      rejectedMentions: [],
    };
  }

  // Capped for the model call only — quote verification below still
  // checks the FULL visiblePageText, never this truncated slice. See
  // COMMUNITY_EXTRACTION_MAX_CHARS's own comment for why this exists and
  // what it trades away.
  const textForModel = visiblePageText.slice(0, COMMUNITY_EXTRACTION_MAX_CHARS);
  const { system, user } = buildExtractionPrompt(cityName, textForModel);
  let raw: unknown;
  try {
    raw = await ai.run(model, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: RESPONSE_JSON_SCHEMA },
    });
  } catch (err) {
    // Logged server-side only — never exposed to the visitor, per
    // AGENTS.md §3.3's "never fabricate or infer" applied to error
    // messages too: the client gets an honest, generic explanation, but
    // this is otherwise a silent failure mode with no diagnosability at
    // all without it.
    console.error("[communityExtraction] ai.run failed:", err);
    return {
      ok: false,
      reason: "model_error",
      message: "We couldn't process that page right now — please try again shortly.",
      rejectedMentions: [],
    };
  }

  const parsed = parseModelOutput(raw);
  if (!parsed) {
    return {
      ok: false,
      reason: "model_output_unparseable",
      message: "We couldn't make sense of that page's officials — please try again or try a different page on the site.",
      rejectedMentions: [],
    };
  }

  const { officials, rejectedMentions } = validateExtraction(parsed.officials, visiblePageText, pageTitle);
  if (officials.length === 0) {
    return {
      ok: false,
      reason: "no_officials_survived",
      message: `We couldn't confidently identify a current Mayor or Council Member for ${cityName} on that page.`,
      rejectedMentions,
    };
  }

  return { ok: true, officials, rejectedMentions };
}
