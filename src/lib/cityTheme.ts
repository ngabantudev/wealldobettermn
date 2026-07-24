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
