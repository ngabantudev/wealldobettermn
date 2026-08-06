# wealldobettermn

A map-first civic transparency platform for Minnesota local, county, and state politics.
It answers four questions, in this order:

1. **Who represents me?** — city, county, and state, from one address search.
2. **What do they vote for?** — roll calls, sponsorships, agenda items, attendance.
3. **Where does their money come from?** — campaign finance receipts, economic interest
   statements, lobbying disclosures.
4. **How do I contact them?** — official channels, next meeting, when comment opens.

Today the site maps Minneapolis and St. Paul city council wards: click a ward to see its
representative — photo, party, term start, and official contact info — plus a link to
that city's own meetings calendar. This is the first layer of a larger officials-and-
jurisdictions registry meant to extend to county and state offices, and to serve as the
canonical data layer for a family of sister Minnesota transparency projects.

The subject of this site is **public power**, not private residents — see `AGENTS.md`
for the full scope, privacy, and sourcing rules that govern what can and cannot be
published here.

Built with Next.js + TypeScript, MapLibre GL (OpenFreeMap "Liberty" style), and Tailwind
CSS, deployed to Cloudflare Workers via OpenNext.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Data

Ward boundaries and rep info come from each city's own open-data portal:

```bash
npm run data:wards
```

This re-fetches live from Minneapolis' and St. Paul's ArcGIS feature services and writes `public/wards.geojson`. Re-run it after an election or council reshuffle — Minneapolis' roster (`scripts/fetch-wards.mjs`) is currently maintained by hand since its ward layer doesn't carry rep names.

No hearing/meeting feed is connected yet — no combined per-city meetings API exists across all mapped cities. Rather than mock one, the ward modal links out to each city's own official meetings calendar (`CITY_MEETINGS_URL` in `src/components/WardModal.tsx`); a city missing from that table falls back to a plain "check your city's website" prompt. A real feed (Legistar/Granicus per city) is the eventual replacement — see `AGENTS.md` §3.2.

## Principles

The full set of guiding principles, ethical guardrails (privacy for people, transparency
for power), and architecture rules live in [`AGENTS.md`](./AGENTS.md) — read it before
contributing. Notably: no address ever leaves the device (§2.5), no private residents or
individual small donors are published (§1b), and no placeholder data ships as fact (§3.1).
