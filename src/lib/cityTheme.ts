// City identity — used only for genuinely geographic distinctions: the
// legend's per-city filter swatches, and the per-ward/per-district
// number-cycling fill palette below. Deliberately NOT blue/red or green:
// those are reserved for PARTY_COLORS, and reusing them here would make
// every nonpartisan city ward, mayor, or commissioner look like it's
// carrying a party signal it doesn't have.
export const CITY_ACCENT: Record<string, string> = {
  Minneapolis: "#0D9488", // teal
  "St. Paul": "#9333EA", // purple
  Bloomington: "#F97316", // orange
  Plymouth: "#EAB308", // yellow/gold
  Minnetonka: "#F43F5E", // rose
  "St. Louis Park": "#EC4899", // pink
  Richfield: "#65A30D", // olive/lime
  Blaine: "#78716C", // warm stone
  "Brooklyn Park": "#D97706", // brown/amber
  "Coon Rapids": "#475569", // cool slate
  // Added Aug 2026 alongside the Champlin/Crystal/Robbinsdale/Fridley/
  // Ramsey/Woodbury coverage expansion. The wheel was already dense at 10
  // cities, so these were picked computationally, not eyeballed: swept
  // hue/saturation/lightness candidates, simulated each against a linear
  // protanopia/deuteranopia approximation, and kept only combinations
  // whose minimum pairwise distance (normal vision + both simulations)
  // cleared a real threshold against every existing city AND every
  // reserved system color (PARTY_COLORS, CONTESTED_COLOR,
  // NEUTRAL_PARTY_COLOR, the mayor-ring gold in WardMap.tsx). One finding
  // worth recording: a saturated magenta/orchid tested here landed
  // suspiciously close to Blaine's warm-stone gray *under CVD simulation
  // only* (not in normal vision) — purple hues can collapse
  // unpredictably for red-green colorblindness, so it was dropped in
  // favor of the muted/gray-family route for most of these six. That
  // route itself follows this file's own existing precedent: Bloomington
  // and Blaine already sit at the *same* hue (25°) and are told apart
  // purely by saturation (95% vs 5%) — proof this codebase already
  // treats "same hue, different saturation" as sufficiently distinct,
  // not something invented for this batch.
  Champlin: "#228DB4", // cyan/teal-blue — the one new saturated hue
  Crystal: "#ABBE9D", // light olive-gray
  Robbinsdale: "#78A189", // sage-gray
  Fridley: "#433C53", // dark lavender-slate
  Ramsey: "#D2CEBC", // light khaki
  // Woodbury has no ward palette (see CITY_PALETTES's comment) — this is
  // its only color, used for the at-large city-boundary fill in
  // WardMap.tsx instead of a ward-cycled shade.
  Woodbury: "#78554A", // dark terracotta
};

// One hue family per city so adjoining areas land on visibly different
// shades of the *same* city's color, and different cities never read as
// the same color family as each other. Kept out of blue/red/green on
// purpose — see the note above. Minneapolis/St. Paul's palettes are
// longer (13/7 shades) since they were built ward-by-ward first; the
// newer cities' palettes are sized to their actual ward counts (3-4).
export const CITY_PALETTES: Record<string, string[]> = {
  Minneapolis: [
    "#5EEAD4", "#2DD4BF", "#99F6E4", "#6EE7B7", "#34D399",
    "#A7F3D0", "#67E8F9", "#22D3EE", "#A5F3FC", "#86EFAC",
    "#4ADE80", "#BBF7D0", "#5EEAD4",
  ],
  "St. Paul": ["#D8B4FE", "#F0ABFC", "#C084FC", "#E879F9", "#E9D5FF", "#F5D0FE", "#DDD6FE"],
  Bloomington: ["#FED7AA", "#FDBA74", "#FB923C", "#F97316"],
  Plymouth: ["#FEF08A", "#FDE047", "#FACC15", "#EAB308"],
  Minnetonka: ["#FECDD3", "#FDA4AF", "#FB7185", "#F43F5E"],
  "St. Louis Park": ["#FBCFE8", "#F9A8D4", "#F472B6", "#EC4899"],
  Richfield: ["#D9F99D", "#BEF264", "#A3E635"],
  Blaine: ["#E7E5E4", "#D6D3D1", "#A8A29E"],
  // Skips amber-400/500 — the latter is CONTESTED_COLOR, and adjacent fill
  // shades next to that pulsing outline color would blur the distinction.
  "Brooklyn Park": ["#FDE68A", "#FCD34D", "#D97706"],
  // Skips slate-500 — that's NEUTRAL_PARTY_COLOR, reserved for pin rings.
  "Coon Rapids": ["#F8FAFC", "#E2E8F0", "#CBD5E1", "#94A3B8", "#475569"],
  // Generated (not hand-picked) from each CITY_ACCENT entry above: same
  // hue/saturation, lightness stepped from accent+headroom down to the
  // accent itself (last entry, matching every palette above), headroom
  // capped so no shade washes out past L88 or crushes past L8 — see the
  // methodology note on CITY_ACCENT. Sized to each city's real ward count.
  Champlin: ["#47B4DC", "#31ABD8", "#269EC9", "#228DB4"],
  Crystal: ["#D2DCCB", "#C5D2BC", "#B8C8AC", "#ABBE9D"],
  Robbinsdale: ["#A5C0B0", "#96B6A3", "#87AB96", "#78A189"],
  Fridley: ["#675C7F", "#554C69", "#433C53"],
  Ramsey: ["#E7E4DA", "#E0DDD0", "#D9D5C6", "#D2CEBC"],
  // No Woodbury entry — it has no wards to cycle a palette across (see
  // CITY_ACCENT's comment); fillColorExpression's fallback below never
  // fires for it either, since Woodbury contributes zero features to
  // wards.geojson in the first place.
};

// A color distinct from every city and party hue, shared by the map's
// pulsing outline (WardMap) and the modal's contested-seat badge
// (WardModal), so "this race is contested" reads as one consistent
// visual language no matter what else is on screen.
export const CONTESTED_COLOR = "#F59E0B";
export const CONTESTED_COLOR_SOFT = "#FEF3C7";

// Party identity — this is the one place blue/red/green carry political
// meaning in this app. Used for anything that identifies a specific
// office-holder (pin rings, modal badges): a nonpartisan official (every
// city/county role — see the note on RepProperties.role in types.ts)
// falls through to the neutral color, a real partisan affiliation gets
// its party's color. Green is included for completeness even though no
// current officeholder carries it; DSA and similar are endorsements, not
// a ballot-line party, and don't belong in this map — see CandidateInfo.
export const PARTY_COLORS: Record<string, string> = {
  "Democratic-Farmer-Labor": "#2563EB",
  Democratic: "#2563EB",
  Republican: "#DC2626",
  Green: "#16A34A",
  "Green Party": "#16A34A",
};
export const PARTY_COLOR_SOFT: Record<string, string> = {
  "Democratic-Farmer-Labor": "#DBEAFE",
  Democratic: "#DBEAFE",
  Republican: "#FEE2E2",
  Green: "#DCFCE7",
  "Green Party": "#DCFCE7",
};
export const NEUTRAL_PARTY_COLOR = "#64748B";
export const NEUTRAL_PARTY_COLOR_SOFT = "#F1F5F9";

export function partyColor(party: string): string {
  return PARTY_COLORS[party] ?? NEUTRAL_PARTY_COLOR;
}

export function partyColorSoft(party: string): string {
  return PARTY_COLOR_SOFT[party] ?? NEUTRAL_PARTY_COLOR_SOFT;
}

// mn.gov's own header treatment (mn.gov/portal/css/core.css:
// .header_formatting{background:#003865;border-bottom:1px solid #9bcbeb}),
// matched exactly rather than approximated — same navy the mn.gov masthead
// itself uses. A fixed brand color, not a themed one — same reasoning as
// CONTESTED_COLOR above: it should read the same in light and dark mode.
// White text on this navy is a clean ~12.7:1 contrast — mn.gov's own
// white-on-#003865 header text holds up fine here too. Shared by
// WardModal's City/County/State tablist and WardMap's left-sidebar Level/
// Chamber tabs, so the two sidebars read as one consistent tab language
// rather than two independently-tuned looks (mn.gov also pairs this navy
// with a light-blue #9bcbeb hairline, but that only clears WCAG's
// non-text-contrast minimum against the navy itself — the active tab's
// fill — so it isn't reused as a general-purpose border color; both
// tablists use the app's own themed border-hair-strong instead).
export const TIER_HEADER_BG = "#003865";
export const TIER_HEADER_TEXT = "#FFFFFF";

// The panel-level title bar color (WardModal's "Representatives for this
// location" bar, and WardMap's matching left-sidebar "Map filters" bar),
// in mn.gov's own accent green rather than its header navy — deliberately
// a different color from the City/County/State tabs so the one panel
// title reads as a distinct level from the tabs under it, not a fourth
// tab. Same live-sourced value as the tier headers' original green
// (mn.gov/portal/css/core.css's .btn-success/.label-success).
//
// Text color was picked by contrast ratio, not eyeballed: plain white
// against this green is only ~2.3:1 (WCAG AA needs 4.5:1 for text this
// size), plain black clears it at ~9.19:1 but reads flat/harsh against a
// saturated brand color. This near-black, faintly green-tinted value
// clears WCAG AAA (7:1, the stricter of the two standards) at ~7.9:1 while
// still visually belonging to the same green rather than looking like an
// unrelated black label dropped on top of it — the same "tint your dark
// text toward the background hue instead of using pure black" move most
// professional design systems make for text on a saturated color.
export const PANEL_HEADER_BG = "#78BE21";
export const PANEL_HEADER_TEXT = "#0B1A08";
