// General app chrome (topbar, sidebar, buttons, borders) — extracted from
// mn.gov/portal's own computed styles, not eyeballed: header/nav background
// rgb(0,56,101), body-text link blue rgb(0,98,178), accent green
// rgb(120,190,33) (logo, icons, section-heading underlines), muted button
// background rgb(239,239,239). Deliberately separate from cityTheme.ts —
// these are structural/navigational colors, not the app's semantic ones
// (PARTY_COLORS, CITY_ACCENT, CONTESTED_COLOR), and must never be used on
// anything that identifies a specific office-holder, city, or contested
// race — that would blur the very distinctions cityTheme.ts exists to keep
// separate. Scope this to chrome only: backgrounds, borders, toggle
// buttons, checkboxes — never a pin ring, a party badge, or a district fill.
export const MN_NAVY = "#003865";
export const MN_BLUE = "#0062B2";
export const MN_GREEN = "#78BE21";
export const MN_GRAY = "#EFEFEF";
