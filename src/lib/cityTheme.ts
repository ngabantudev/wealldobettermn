export const CITY_ACCENT: Record<string, string> = {
  Minneapolis: "#0EA5E9",
  "St. Paul": "#F43F5E",
};

export const CITY_ACCENT_SOFT: Record<string, string> = {
  Minneapolis: "#E0F2FE",
  "St. Paul": "#FFE4E6",
};

export function accentFor(city: string): string {
  return CITY_ACCENT[city] ?? "#71717a";
}

export function accentSoftFor(city: string): string {
  return CITY_ACCENT_SOFT[city] ?? "#f4f4f5";
}

// A color distinct from both city palettes, shared by the map's pulsing
// outline (WardMap) and the modal's contested-seat badge (WardModal), so
// "this race is contested" reads as one consistent visual language.
export const CONTESTED_COLOR = "#F59E0B";
export const CONTESTED_COLOR_SOFT = "#FEF3C7";

// State legislature districts are colored by party rather than by city
// (see the note on RepProperties) — shared by the map's fill expression
// (WardMap) and the party-unity bar (WardModal) so both agree on which
// color means which party. Not every party a candidate could list (MN
// currently only seats these two), hence the neutral fallback.
export const PARTY_COLORS: Record<string, string> = {
  "Democratic-Farmer-Labor": "#2563EB",
  Republican: "#DC2626",
};
export const DEFAULT_PARTY_COLOR = "#9CA3AF";

export function partyColor(party: string): string {
  return PARTY_COLORS[party] ?? DEFAULT_PARTY_COLOR;
}
