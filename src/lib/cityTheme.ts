// City identity — used only for genuinely geographic distinctions: the
// legend's Minneapolis/St. Paul filter swatches, and the per-ward/
// per-district number-cycling fill palette below. Deliberately NOT
// blue/red or green: those are reserved for PARTY_COLORS, and reusing
// them here would make every nonpartisan city ward, mayor, or
// commissioner look like it's carrying a party signal it doesn't have.
export const CITY_ACCENT: Record<string, string> = {
  Minneapolis: "#0D9488", // teal
  "St. Paul": "#9333EA", // purple
};

// Two distinct hue families (teal/green/cyan for Minneapolis, purple/
// fuchsia for St. Paul) so the two sides read apart at a glance, cycled
// by ward/district number so adjoining areas land on visibly different
// shades. Kept out of blue/red/green on purpose — see the note above.
export const CITY_PALETTES: Record<string, string[]> = {
  Minneapolis: [
    "#5EEAD4", "#2DD4BF", "#99F6E4", "#6EE7B7", "#34D399",
    "#A7F3D0", "#67E8F9", "#22D3EE", "#A5F3FC", "#86EFAC",
    "#4ADE80", "#BBF7D0", "#5EEAD4",
  ],
  "St. Paul": ["#D8B4FE", "#F0ABFC", "#C084FC", "#E879F9", "#E9D5FF", "#F5D0FE", "#DDD6FE"],
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
