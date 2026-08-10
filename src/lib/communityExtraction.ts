// src/lib/communityExtraction.ts
//
// Officeholder extraction for the Community Contribution Pipeline
// (AGENTS.md §2.6). This is the single most important correctness/safety
// file in that feature: it decides whether a name a visitor's submitted
// page mentions is ever allowed to become a published officeholder
// record. Nothing downstream re-checks its work — a record that survives
// this module goes live on the map immediately, badged "pending."
//
// Four independent layers enforce AGENTS.md §1b/§1d's "no variant for a
// private individual, by construction" here, NOT one prompt:
//   1. Schema-level restriction — the model's requested response schema
//      types `role` as a two-value enum, "Mayor" | "Council Member" only.
//   2. Quote verification — every record's `roleSourceQuote` is checked,
//      server-side, as an actual substring of the fetched page's own
//      visible text. A record whose quote can't be found is dropped
//      regardless of what the model "meant" — this is the load-bearing
//      check, because it means a hallucinated attribution physically
//      cannot survive, independent of prompt compliance.
//   3. Keyword denylist — text surrounding a surviving quote is checked
//      against staff/clerk/administrator terms, catching a model that
//      mislabels a name it saw near "Mayor" in a staff-directory table.
//   4. Minimum-viable-result gate — zero surviving records, or no mention
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

import { htmlToVisibleText, normalize, normalizedIncludes } from "./htmlText.ts";
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
}

export type RejectReason =
  | "empty_name"
  | "role_not_in_enum"
  | "quote_not_found_in_source"
  | "denylist_keyword_nearby";

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
          // page's own text that states this person's role — never
          // paraphrased. This is what step 2 above verifies mechanically.
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
    `not a paraphrase or summary — that states their name and role together. Set repEmail/ ` +
    `repPhone to an empty string unless the page clearly presents that contact as belonging ` +
    `to the official's office itself, not a personal or ambiguous listing. If the page names no ` +
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
 * `normalizedPage` is expected to already be `normalize()`d — computed
 * once by validateExtraction() below and reused across every candidate,
 * rather than each call re-normalizing the whole page from scratch.
 */
function hasDenylistKeywordNearby(normalizedPage: string, quote: string): boolean {
  const normalizedQuote = normalize(quote);
  if (!normalizedQuote) return false;
  const index = normalizedPage.indexOf(normalizedQuote);
  if (index === -1) return false; // caller already checked existence; defensive only
  const start = Math.max(0, index - DENYLIST_WINDOW_CHARS);
  const end = Math.min(normalizedPage.length, index + normalizedQuote.length + DENYLIST_WINDOW_CHARS);
  const window = normalizedPage.slice(start, end);
  return DENYLIST_KEYWORD_RE.test(window);
}

interface RawCandidate {
  role?: unknown;
  repName?: unknown;
  roleSourceQuote?: unknown;
  repEmail?: unknown;
  repPhone?: unknown;
}

/**
 * Applies layers 1–3 (schema restriction, quote verification, denylist)
 * to the model's raw candidates against the page's own visible text.
 * Never trusts the model's output on its own — every record here is
 * mechanically checked, not just prompt-compliant.
 */
export function validateExtraction(
  rawOfficials: unknown[],
  visiblePageText: string,
): { officials: ValidatedOfficial[]; rejectedMentions: RejectedMention[] } {
  const officials: ValidatedOfficial[] = [];
  const rejectedMentions: RejectedMention[] = [];
  // Normalized once here rather than per-candidate inside
  // normalizedIncludes()/hasDenylistKeywordNearby() below — a page with
  // several candidate officials was re-lowercasing/re-collapsing the
  // whole page text from scratch on every single one.
  const normalizedPageText = normalize(visiblePageText);

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
    if (!quote || !normalizedPageText.includes(normalize(quote))) {
      rejectedMentions.push({ repName, claimedRole, reason: "quote_not_found_in_source" });
      continue;
    }
    if (hasDenylistKeywordNearby(normalizedPageText, quote)) {
      rejectedMentions.push({ repName, claimedRole, reason: "denylist_keyword_nearby" });
      continue;
    }

    officials.push({
      role: claimedRole as AllowedRole,
      repName,
      repEmail: typeof candidate.repEmail === "string" && candidate.repEmail.trim() ? candidate.repEmail.trim() : null,
      repPhone: typeof candidate.repPhone === "string" && candidate.repPhone.trim() ? candidate.repPhone.trim() : null,
      // Stored verbatim (not the model's original casing/whitespace) so
      // a later audit can see exactly what was verified against — the
      // page's own text, not a normalized/lowercased copy of it.
      roleSourceQuote: quote,
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
 * parsing, and the layers 1–4 structural gate. Never throws — every
 * failure mode is a typed, plain-language-ready result (AGENTS.md §3.3).
 */
export async function extractOfficials(params: ExtractOfficialsParams): Promise<ExtractionResult> {
  const { ai, pageHtml, cityName, model = AI_MODEL } = params;
  const visiblePageText = htmlToVisibleText(pageHtml);

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

  const { officials, rejectedMentions } = validateExtraction(parsed.officials, visiblePageText);
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
