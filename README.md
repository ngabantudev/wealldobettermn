# wealldobettermn

A map of Minnesota city council wards. Click a ward to see its representative — photo, party, term start, contact info — plus a link to that city's own official meetings calendar.

Built with Next.js + TypeScript, MapLibre GL (OpenFreeMap "Liberty" style), and Tailwind CSS.

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
