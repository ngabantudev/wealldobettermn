// Data for MastheadSaying.tsx — the auto-rotating headline that replaced
// the old static "We All Do Better" wordmark in SiteHeader. Eight mottos
// from Minnesota's Indigenous, Somali, Hmong, and Pan-African diaspora
// communities, each paired with the explanation shown when a visitor
// opens it.
//
// Deliberately separate from the component, same split as coverage.ts /
// CoverageNotice.tsx: pure data, no JSX, so the rotation logic can't
// quietly drift from what's actually in the list, and so this list is
// the one place to edit to add, correct, or reorder a saying.
//
// Text reproduced as supplied by the maintainer, not independently
// verified against a primary linguistic source — this is cultural
// content, not a civic record, so AGENTS.md Part 3's sourcing/citation
// machinery doesn't govern it the way it governs officials or hearings
// data. It still deserves the same care in spirit: before this ships, a
// fluent reviewer from each community listed should confirm spelling,
// diacritics (the Dakota "ŋ" in particular is easy to mangle in transit),
// and that the explanation doesn't flatten or mis-state the source
// worldview. Treat a correction here as a normal edit, not a special case.

export interface MastheadSaying {
  /** Stable key — not shown, just for React lists / future linking. */
  id: string;
  /** Community or language this saying comes from, shown in the popover. */
  community: string;
  /** The phrase itself, in its own language, as one string — used for the popover's aria-label. */
  quote: string;
  /**
   * The same phrase as `quote`, pre-broken into the lines MastheadSaying
   * renders — same move as "We All Do Better" / "when we all do better"
   * used to be, curated by hand rather than left to the browser's own
   * wrap point, which (at the size this renders — the old wordmark's own
   * text-2xl/font-black/uppercase) can land mid-word or badly unbalanced.
   * `lines.join(" ")` must equal `quote` — keep them in sync by hand;
   * there's no derivation between them worth the indirection for a list
   * this size.
   */
  lines: readonly string[];
  /** Short literal translation, when the source gave one as a standalone phrase. */
  translation?: string;
  /** The fuller explanation of what the saying means and carries — shown on tap/hover/focus. */
  meaning: string;
}

export const MASTHEAD_SAYINGS: readonly MastheadSaying[] = [
  {
    id: "dakota-mitakuye-oyasin",
    community: "Dakota / Lakota",
    quote: "Mitakuye Oyás'iŋ",
    lines: ["Mitakuye Oyás'iŋ"],
    translation: "All my relations / We are all related",
    meaning:
      "A foundational prayer and worldview acknowledging that everything in the universe — humans, animals, plants, rivers, and rocks — is interconnected. It instills a deep cultural responsibility to treat all living things with mutual respect and care.",
  },
  {
    id: "ojibwe-asemaa-akiing",
    community: "Ojibwe worldview",
    quote: "Asemaa / Akiing",
    lines: ["Asemaa / Akiing"],
    meaning:
      "Not a single slogan, but Ojibwe philosophy heavily emphasizes Anishinaabe stewardship and community balance — viewing humans not as owners of the land, but as an inseparable part of a living ecosystem that depends entirely on mutual harmony to survive.",
  },
  {
    id: "somali-ilko-wada-jir",
    community: "Somali proverb",
    quote: "Ilko wada jir bey wax ku gooyaan",
    lines: ["Ilko wada jir bey", "wax ku gooyaan"],
    translation: "Together the teeth can cut",
    meaning: "Used to express that unity is power, and that collective strength achieves what an individual cannot.",
  },
  {
    id: "somali-quraanyo-aruurtay",
    community: "Somali proverb",
    quote: "Quraanyo aruurtay bulac bay jiiddaa",
    lines: ["Quraanyo aruurtay", "bulac bay jiiddaa"],
    translation: "Together, ants can pull a lizard",
    meaning: "A vivid metaphor for how small, fragmented efforts combine into massive collective power when a community works as one.",
  },
  {
    id: "somali-calool-wada-jirto",
    community: "Somali proverb",
    quote: "Calool wada jirto waa lagu qoslaa",
    lines: ["Calool wada jirto", "waa lagu qoslaa"],
    translation: "Those with a shared/united stomach laugh together",
    meaning: "A sentiment speaking to mutual hospitality, shared resources, and the deep social bond of eating and living together as a community.",
  },
  {
    id: "hmong-ntoo-qaug",
    community: "Hmong proverb (paaj lug)",
    quote: "Ntoo qaug tes maab nrug",
    lines: ["Ntoo qaug tes", "maab nrug"],
    translation: "When a tree falls, the vines go with it",
    meaning:
      "Illustrates deep interdependence — how individuals, families, and communities are structurally tethered to one another, so that when one falls or struggles, others are impacted and must provide support.",
  },
  {
    id: "hmong-ib-tug-neeg",
    community: "Hmong",
    quote: "Ib tug neeg lub neej nyob ntawm pab pawg",
    lines: ["Ib tug neeg", "lub neej nyob", "ntawm pab pawg"],
    meaning:
      "A communal ethos reflecting that an individual's livelihood, safety, and survival are entirely dependent on the strength and cooperation of the collective group.",
  },
  {
    id: "panafrican-umuntu-ngumuntu",
    community: "Pan-African diaspora (Southern African origin — Ubuntu)",
    quote: "Umuntu ngumuntu ngabantu",
    lines: ["Umuntu ngumuntu", "ngabantu"],
    translation: "I am because we are",
    meaning:
      "Originating from Southern African traditions, this philosophy is widely invoked across African diaspora communities in Minnesota to emphasize that a person is human only through their recognition of, and connection to, other people.",
  },
] as const;

const HOUR_MS = 60 * 60 * 1000;

// Deterministic, not random: `floor(hoursSinceEpoch) % length` means every
// visitor sees the same saying in the same clock hour, it's reproducible
// without state, and it needs no tracking or per-visitor storage to work
// (AGENTS.md §0.7/§0.12 territory even though this isn't address data —
// same instinct: don't invent a reason to remember who saw what).
export function currentSayingIndex(now: number = Date.now()): number {
  return Math.floor(now / HOUR_MS) % MASTHEAD_SAYINGS.length;
}
