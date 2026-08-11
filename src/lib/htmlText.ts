// src/lib/htmlText.ts
//
// Minimal, dependency-free HTML → visible-text stripping (AGENTS.md §0.8:
// dependency-light ETL). Used by communityExtraction.ts as the single
// canonical text both fed to the extraction model AND checked against for
// quote verification — the two MUST see the same text, or a legitimate
// quote could fail verification purely from a tag-boundary mismatch
// between "what the model saw" and "what we checked against."
//
// Not a real HTML parser: good enough to turn a government website's
// roughly-well-formed HTML into readable text, not robust against
// adversarial/malformed markup. That's an acceptable tradeoff here — a
// page this handles badly just produces less matchable text, which the
// extraction gate's "zero surviving records" fail-closed path already
// handles honestly (AGENTS.md §3.3 "never fabricate or infer").

// A real contact address hidden in an <a> tag's href — never visible in
// the page's own rendered text — is invisible to everything downstream
// of tag-stripping. Found live (Oakdale, MN): the page's visible text
// for each official was just "Email Mayor Kevin Zabel" (a generic link
// label), while the real address, kevin.zabel@oakdalemn.gov, lived only
// in href="mailto:kevin.zabel@oakdalemn.gov" — invisible to
// communityExtraction.ts's model call and to quote verification alike,
// since both work from this file's plain-text output. The model, with no
// real address to find, extracted the label text itself as repEmail —
// wrong data shipped as fact, worse than leaving the field null.
// Exposing the real address by appending it in parentheses to the link's
// own visible label, run BEFORE any tag stripping (needs the raw href
// attribute, which no longer exists once TAG_RE has run), fixes this at
// the source rather than special-casing the extraction prompt around a
// text shape the page's own markup never gave it a chance to see. Same
// treatment for tel: — a phone number hidden the same way is the
// identical failure mode, not something Oakdale happened not to hit.
const MAILTO_LINK_RE = /<a\b[^>]*\bhref\s*=\s*["']mailto:([^"'?]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
const TEL_LINK_RE = /<a\b[^>]*\bhref\s*=\s*["']tel:([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

function decodeUriComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed %-escape (rare, but not our job to reject a real
    // government page over) — the raw, still-readable value is a better
    // fallback than throwing and losing the whole page's extraction.
    return value;
  }
}

function exposeHiddenContactLinks(html: string): string {
  const withEmailsExposed = html.replace(MAILTO_LINK_RE, (_match, rawAddress: string, label: string) => {
    const address = decodeUriComponentSafe(rawAddress.split("?")[0]).trim();
    return address ? `${label} (${address})` : label;
  });
  return withEmailsExposed.replace(TEL_LINK_RE, (_match, rawNumber: string, label: string) => {
    const number = decodeUriComponentSafe(rawNumber.split("?")[0]).trim();
    return number ? `${label} (${number})` : label;
  });
}

const SCRIPT_STYLE_RE = /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi;
// Navigation chrome — menus, site header, site footer — is boilerplate,
// never a real per-person role attribution, but it stays in the text
// stream just like any other tag once stripped to plain text. Found live
// (Ham Lake, MN): a dense nav-menu breadcrumb ("...Administration/Clerk
// Building/Inspections...Mayor Brian Kirkham CM Jim Doyle...") crams many
// short, unrelated link labels together with no real separation, so an
// unrelated nav link like "Clerk" can land within communityExtraction.ts's
// DENYLIST_WINDOW_CHARS of a real official's name purely from menu
// density — not because anyone claimed that person IS a clerk. Stripping
// this chrome removes that noise at the source, for every future page,
// rather than chasing individual keyword collisions it causes one at a
// time. Same "not a real HTML parser" tradeoff as SCRIPT_STYLE_RE above:
// a page nesting a local, in-content <header> (rare, but valid HTML5)
// could lose that heading's text too — the failure mode is always fewer
// extracted records, never a wrong one, consistent with this file's
// broader "good enough, not robust against adversarial/malformed markup"
// posture.
const NAV_CHROME_RE = /<(nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi;
const TAG_RE = /<[^>]+>/g;
const WHITESPACE_RE = /\s+/g;

const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&mdash;": "—",
  "&ndash;": "–",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&rdquo;": "”",
  "&ldquo;": "“",
};

// One alternation covering every named entity, built once at module load
// — a single O(n) replace pass over the text, rather than one
// .split(entity).join(char) pass per entity (13 full-text scans for
// what one scan already covers).
const NAMED_ENTITY_RE = new RegExp(Object.keys(NAMED_ENTITIES).join("|"), "g");

function decodeEntities(text: string): string {
  let decoded = text.replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)));
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_match, code: string) => String.fromCharCode(parseInt(code, 16)));
  decoded = decoded.replace(NAMED_ENTITY_RE, (entity) => NAMED_ENTITIES[entity]);
  return decoded;
}

const TITLE_RE = /<title\b[^>]*>([\s\S]*?)<\/title>/i;

/**
 * The page's own <title> text, decoded and whitespace-collapsed the same
 * way htmlToVisibleText treats everything else — null if the page has
 * none. Used by communityExtraction.ts as a page-level (not proximity-
 * bounded) signal for pages like Inver Grove Heights, MN's real "Mayor &
 * Council" table: a Mayor's row says "Mayor," but the four Council
 * Member rows underneath have no role word anywhere near them at all —
 * not even far away, just genuinely absent — so no window size could
 * ever bridge that gap. The page's own title, which the city itself
 * wrote, is a real (if weaker, unbounded) signal in exactly that case.
 */
export function extractPageTitle(html: string): string | null {
  const match = TITLE_RE.exec(html);
  if (!match) return null;
  const decoded = decodeEntities(match[1]);
  const collapsed = decoded.replace(WHITESPACE_RE, " ").trim();
  return collapsed || null;
}

/** Strips scripts/styles/tags and decodes entities, collapsing whitespace to single spaces. */
export function htmlToVisibleText(html: string): string {
  // Must run first — needs the raw <a href="mailto:...">/<a href="tel:...">
  // markup intact, which every step below this one destroys.
  const withContactsExposed = exposeHiddenContactLinks(html);
  const withoutScriptsAndStyles = withContactsExposed.replace(SCRIPT_STYLE_RE, " ");
  const withoutChrome = withoutScriptsAndStyles.replace(NAV_CHROME_RE, " ");
  const withoutTags = withoutChrome.replace(TAG_RE, " ");
  const decoded = decodeEntities(withoutTags);
  return decoded.replace(WHITESPACE_RE, " ").trim();
}

/**
 * Case- and whitespace-collapsing normalization, exported so a caller
 * checking the same haystack against many needles (e.g.
 * communityExtraction.ts's per-candidate quote verification) can
 * normalize it once rather than re-normalizing on every
 * normalizedIncludes() call below.
 */
export function normalize(text: string): string {
  return text.replace(WHITESPACE_RE, " ").trim().toLowerCase();
}

/** Case- and whitespace-insensitive substring check, for quote/city-name verification. */
export function normalizedIncludes(haystack: string, needle: string): boolean {
  if (!needle.trim()) return false;
  return normalize(haystack).includes(normalize(needle));
}
