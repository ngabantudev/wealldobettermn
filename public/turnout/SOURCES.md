# Sources — civic-participation-turnout (2024 general election, city-level)

Per AGENTS.md §3.3 ("Citation Rules"): publisher, exact file URL, vintage, and retrieval
date for every real input actually used by `scripts/ingest/turnout.mjs`. Both sources
below are Tier 1 per AGENTS.md's tiering (government primary records; the SOS's own data,
mirrored on a different state file server — see the "Why gisdata.mn.gov, not sos.mn.gov"
note below).

## 1. MN Secretary of State — 2024 general election precinct results

- **Publisher / originator:** Office of the Minnesota Secretary of State, Elections
  Division (contact on file: Brad Neuhauser, GIS Specialist).
- **Distributed via:** Minnesota Geospatial Commons ("Minnesota General Election Results,
  2022-2030" dataset).
- **Dataset landing page:** <https://gisdata.mn.gov/dataset/bdry-electionresults-2022-2030>
- **Metadata page (stable, directly fetchable, no bot protection):**
  <https://resources.gisdata.mn.gov/pub/gdrs/data/pub/us_mn_state_sos/bdry_electionresults_2022_2030/metadata/metadata.html>
- **File actually fetched:**
  <https://resources.gisdata.mn.gov/pub/gdrs/data/pub/us_mn_state_sos/bdry_electionresults_2022_2030/shp_bdry_electionresults_2022_2030.zip>
  (a zipped shapefile; this pipeline reads only the attribute table —
  `general_election_results_by_precinct_2024.dbf` — and discards the geometry, since this
  PR has no map surface)
- **Vintage:** "Time Period of Content Date: 11/21/2024... Currentness Reference: Date the
  most recent election was canvassed by the State Canvassing Board." SOS's own separate
  "2024 Election Statistics" page states results are as of December 2, 2024, incorporating
  all recounts.
- **Retrieved:** 2026-08-12.
- **Licence / use constraints:** No formal licence found; the dataset's own "Use
  Constraints" field states "Office of the Minnesota Secretary of State maintains this
  data as accurately as possible, but cannot assure 100% accuracy," directing definitive
  precinct-line questions to the local jurisdiction. Treated as ordinary public record data
  consistent with the rest of this repo's MN state/local sourcing.
- **Fields used:** `VTDID` (precinct id), `PCTNAME`, `MCDNAME` (municipality — join target),
  `MCDFIPS` (Census-standard place FIPS code — the actual join key, see below), `COUNTYNAME`,
  `CTU_TYPE` (city / township / unorganized territory — this PR keeps `city` rows only),
  `MAILBALLOT`, `REG7AM`, `EDR`, `TOTVOTING`.

### Why gisdata.mn.gov, not sos.mn.gov directly

sos.mn.gov (and its electionresults.sos.mn.gov subdomain) sits behind Radware Bot Manager,
which returns an HTTP 302 to a JavaScript validation challenge for any plain HTTP client —
confirmed 2026-08-12 against multiple sos.mn.gov paths, including direct `/media/*.xlsx`
asset URLs, from a cold `curl` and from Node's `fetch` with a descriptive `User-Agent`
identifying this project. AGENTS.md §2.2 is explicit that a source behind this kind of
protection gets a documented gap and an alternate route, not an attempt to solve the
challenge or spoof a browser ("no block evasion"). The Minnesota Geospatial Commons mirror
above is not a downgrade to a secondary source: its own metadata lists the Office of the
Minnesota Secretary of State as the originator, and the file is the same State/County
Canvassing Board-certified results, republished by the state's own open-data
infrastructure on a server with no bot-detection layer (confirmed live: a plain fetch
returns HTTP 200).

### Statewide reconciliation

`assertStatewideReconciliation()` in `scripts/ingest/turnout.mjs` sums `TOTVOTING` across
every precinct row (all `CTU_TYPE` values, not just `city`) on every run and requires an
exact match against 3,272,414 — the SOS's own certified 2024 general-election statewide
ballots-cast figure, published separately at
<https://www.sos.mn.gov/elections-voting/election-results/2024/2024-general-election-results/2024-election-statistics/>.
Confirmed by direct inspection of the downloaded file on 2026-08-12. The script refuses to
write output if this ever fails to match exactly.

## 2. US Census Bureau — Citizen Voting Age Population (CVAP) Special Tabulation

- **Publisher:** US Census Bureau.
- **Dataset:** 2019-2023 ACS 5-Year CVAP Special Tabulation, Place geography.
- **Dataset landing page:** <https://www.census.gov/data/datasets/2023/dec/rdo/2019-2023-CVAP.html>
- **File actually fetched (bulk CSV, keyless — no api.census.gov registration needed, per
  AGENTS.md §0.8's "prefer bulk files over the keyed API"):**
  <https://www2.census.gov/programs-surveys/decennial/rdo/datasets/2023/2023-cvap/CVAP_2019-2023_ACS_csv_files.zip>
  (this pipeline reads only the `Place.csv` entry from the zip)
- **Vintage:** 2019-2023 ACS 5-year estimates (most recent CVAP special tabulation
  available at ingest time).
- **Retrieved:** 2026-08-12.
- **Licence:** US Government Work — public domain.
- **Fields used:** `geoname`, `geoid` (`1600000US27#####` — state 27 + 5-digit place FIPS,
  the join key), `lnnumber` (`"1"` = Total row only — race/ethnicity breakout rows are not
  used), `cvap_est`, `cvap_moe`.

### The join

`MCDFIPS` on the SOS precinct file is exactly the same 5-digit place FIPS code embedded in
a CVAP row's `geoid` — confirmed by direct inspection (St. Paul's `MCDFIPS` "58000" matches
CVAP `geoid` `1600000US2758000`; Minneapolis "43000" and Coon Rapids "13114" likewise).
Cities are grouped by `MCDFIPS`, not by name — Minnesota has two entirely different,
unrelated cities both named "St. Anthony" (Hennepin/Ramsey counties, FIPS 56680; a separate
city in Stearns County, FIPS 56698), confirmed live in the real 2024 data. Grouping by name
would have silently merged their precincts into one false combined record; grouping by
FIPS keeps them as two separate `cityId`s (`st-anthony`, `st-anthony-2`).

## Known gaps in this join (2024 city-level data)

- **Empire, MCDFIPS 19358:** no matching Census CVAP Place record found. `turnoutOfCVAP`
  ships `null` for this city rather than a guessed or interpolated figure. Possible cause:
  Empire's incorporation may not yet be reflected in the 2019-2023 ACS 5-year vintage, or
  there is a place-name/FIPS mismatch between SOS and Census that needs manual follow-up.
- All other 854 of the 855 real MN cities in the 2024 general election precinct data have a
  real, sourced `turnoutOfCVAP` figure with its own margin of error.

## What this dataset does not cover (see also `knownGaps` in `public/turnout/city/2024.json`)

- County-level aggregation — a follow-up PR.
- Any election year other than 2024 general — a follow-up PR.
- Townships and unorganized territory — excluded entirely from this city-level-only PR,
  not folded into any city's totals.
- CVAP is a modeled 5-year survey estimate with sampling error (see each city's
  `cvapMarginOfError`), never an exact citizen-population count.
