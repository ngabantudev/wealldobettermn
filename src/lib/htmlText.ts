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

const SCRIPT_STYLE_RE = /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi;
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

function decodeEntities(text: string): string {
  let decoded = text.replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)));
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_match, code: string) => String.fromCharCode(parseInt(code, 16)));
  for (const [entity, char] of Object.entries(NAMED_ENTITIES)) {
    decoded = decoded.split(entity).join(char);
  }
  return decoded;
}

/** Strips scripts/styles/tags and decodes entities, collapsing whitespace to single spaces. */
export function htmlToVisibleText(html: string): string {
  const withoutScriptsAndStyles = html.replace(SCRIPT_STYLE_RE, " ");
  const withoutTags = withoutScriptsAndStyles.replace(TAG_RE, " ");
  const decoded = decodeEntities(withoutTags);
  return decoded.replace(WHITESPACE_RE, " ").trim();
}

function normalize(text: string): string {
  return text.replace(WHITESPACE_RE, " ").trim().toLowerCase();
}

/** Case- and whitespace-insensitive substring check, for quote/city-name verification. */
export function normalizedIncludes(haystack: string, needle: string): boolean {
  if (!needle.trim()) return false;
  return normalize(haystack).includes(normalize(needle));
}
