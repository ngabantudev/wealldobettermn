// scripts/lib/slugify.mjs
//
// Shared by scripts/ingest/legistar.mjs and scripts/ingest/mn-campaign-
// finance.mjs (issue #129) — previously each had its own independent slug
// generator: legistar.mjs's own slugify() (lowercase, [^a-z0-9]+ -> "-",
// trim dashes) and mn-campaign-finance.mjs's slugifyCommitteeName() (same
// shape, plus NFKD-normalize + combining-diacritic strip beforehand). Only
// the campaign-finance version handled accented characters correctly — a
// Legistar person/body name with an accented character (é, ñ, ...) would
// have slugified differently from a campaign-finance committee slug for
// what should be the same identity, silently breaking the cross-dataset
// joins AGENTS.md §2.4 relies on stable IDs for. This is that
// diacritic-stripping version, unified for both callers.
//
// `fallback` lets each caller keep its own previous "empty input" default
// (legistar.mjs's callers expect "unknown"; mn-campaign-finance.mjs's
// expects "committee") without diverging on the actual slugging logic.
export function slugify(value, fallback = "unknown") {
  const slug = String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics after NFKD decomposition
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}
