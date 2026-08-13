# Sources — civic-participation-turnout (city-level general elections, 2012-2024)

Per AGENTS.md §3.3 ("Citation Rules"): publisher, exact file URL, vintage, and retrieval
date for every real input actually used by `scripts/ingest/turnout.mjs`. All sources below
are Tier 1 per AGENTS.md's tiering (government primary records — the SOS's own certified
results and the Census Bureau's own special tabulation, both retrieved directly from each
agency's own infrastructure).

**Coverage: 2012, 2014, 2016, 2018, 2020, 2022, 2024 — all seven configured general
election years produced real, statewide-reconciled data.** No year was skipped. See
"What this dataset does not cover" below for the gaps that remain within each year that
was covered.

## 1. MN Secretary of State — precinct-level general election results

- **Publisher / originator:** Office of the Minnesota Secretary of State, Elections
  Division.
- **Distributed via:** Minnesota Geospatial Commons, as two dataset groups that together
  cover all seven years:

  | Years | Dataset | Landing page | File fetched |
  |---|---|---|---|
  | 2012, 2014, 2016, 2018, 2020 | "Minnesota General Election Results, 2012-2020" | <https://gisdata.mn.gov/dataset/bdry-electionresults-2012-2020> | <https://resources.gisdata.mn.gov/pub/gdrs/data/pub/us_mn_state_sos/bdry_electionresults_2012_2020/shp_bdry_electionresults_2012_2020.zip> |
  | 2022, 2024 | "Minnesota General Election Results, 2022-2030" | <https://gisdata.mn.gov/dataset/bdry-electionresults-2022-2030> | <https://resources.gisdata.mn.gov/pub/gdrs/data/pub/us_mn_state_sos/bdry_electionresults_2022_2030/shp_bdry_electionresults_2022_2030.zip> |

  Each is a zipped shapefile containing one `.dbf` attribute table per year
  (`general_election_results_by_precinct_<year>.dbf`); this pipeline reads only the
  attribute table and discards the geometry, since there is no map surface.
- **Retrieved:** 2026-08-12 (all years, same session).
- **Licence / use constraints:** No formal licence found; each dataset's own "Use
  Constraints" field states "Office of the Minnesota Secretary of State maintains this
  data as accurately as possible, but cannot assure 100% accuracy," directing definitive
  precinct-line questions to the local jurisdiction.
- **Fields used:** the precinct id (`VTDID` in every year except 2012, where the field is
  named `VTD`), `MCDNAME` (municipality), `MCDFIPS` (Census-standard place FIPS code — the
  join key), `COUNTYNAME`, `CTU_TYPE` (city / township / unorganized territory — this
  feature keeps `city` rows only), `MAILBALLOT`, `REG7AM`, `EDR`, `TOTVOTING`.
- **Format drift across years, confirmed by direct inspection of every year's real file:**
  - The precinct-id field is named `VTD` in 2012 only; `VTDID` in 2014 through 2024.
  - `REG7AM`, `EDR` (election-day registrations), and `TOTVOTING` are present with real,
    non-null values in every one of the seven years — this feature's own brief anticipated
    that older years might not break out election-day registration the same way, but that
    turned out not to be true for Minnesota's real data. No year ships a null
    `electionDayRegistrations`.
  - The DBF numeric-field type marker (fixed integer vs. floating-point, both stored as
    fixed-width ASCII text) and `MAILBALLOT`'s declared field width vary by year; neither
    affects parsing, since values are read by field name and `parseFloat`/trimmed
    regardless of the declared type or width.
  - `CTU_TYPE`'s `"city"` value is lowercase and consistent in every year (some years carry
    additional non-city values like `"town"`/`"unorganized"` not present in others; this
    doesn't affect the city filter).

### Why gisdata.mn.gov, not sos.mn.gov directly

sos.mn.gov (and its electionresults.sos.mn.gov subdomain) sits behind Radware Bot Manager,
which returns an HTTP 302 to a JavaScript validation challenge for any plain HTTP client —
confirmed 2026-08-12 against multiple sos.mn.gov paths, including direct `/media/*.xlsx`
asset URLs, from a cold `curl` and from Node's `fetch` with a descriptive `User-Agent`
identifying this project. AGENTS.md §2.2 is explicit that a source behind this kind of
protection gets a documented gap and an alternate route, not an attempt to solve the
challenge or spoof a browser ("no block evasion"). The Minnesota Geospatial Commons mirror
above is not a downgrade to a secondary source: each dataset's own metadata lists the
Office of the Minnesota Secretary of State as the originator, and the files are the same
State/County Canvassing Board-certified results, republished by the state's own open-data
infrastructure on a server with no bot-detection layer (confirmed live: a plain fetch
returns HTTP 200 for both dataset groups).

### Statewide reconciliation — every year, exact match required

`assertStatewideReconciliation()` in `scripts/ingest/turnout.mjs` sums `TOTVOTING` across
every precinct row (all `CTU_TYPE` values, not just `city`) for each year on every run and
requires an exact match against that year's own certified statewide ballots-cast figure.
The script **refuses to write output for any year that fails this check** — it does not
guess, average, or interpolate, and a failure for one year does not block any other
year from being written.

All seven figures below are drawn from a single Tier 1 SOS document — **"Minnesota
Election Statistics, 1950-2024," Table 2 ("Minnesota State General Election Statistics"),
Office of the Minnesota Secretary of State-Elections Division**
(<https://www.sos.mn.gov/media/gevnwetp/minnesota-election-statistics-1950-to-2024.pdf>,
retrieved 2026-08-12; unlike electionresults.sos.mn.gov, this asset path is not behind the
Radware bot challenge — confirmed by a plain fetch returning HTTP 200). The table states
"Other data from election results certified by State Canvassing Boards."

| Year | Certified statewide ballots cast (Table 2) | Sum of `TOTVOTING` across every precinct row in the real downloaded file | Match |
|---|---|---|---|
| 2012 | 2,950,780 | 2,950,780 | exact |
| 2014 | 1,992,566 | 1,992,566 | exact |
| 2016 | 2,968,281 | 2,968,281 | exact |
| 2018 | 2,611,365 | 2,611,365 | exact |
| 2020 | 3,292,997 | 3,292,997 | exact |
| 2022 | 2,525,873 | 2,525,873 | exact |
| 2024 | 3,272,414 | 3,272,414 | exact (confirmed by PR A) |

Every one of the seven configured years reconciled exactly on the real 2026-08-12 run —
no year needed to be skipped for a reconciliation failure.

## 2. US Census Bureau — Citizen Voting Age Population (CVAP) Special Tabulation

- **Publisher:** US Census Bureau.
- Each election year is joined against the closest available 5-year ACS CVAP special
  tabulation vintage — not necessarily the vintage whose end-year matches the election
  year, since CVAP is only published every two years on its own schedule:

  | Election year | CVAP vintage used | Dataset landing page | File fetched |
  |---|---|---|---|
  | 2012 | 2008-2012 ACS 5-year | <https://www.census.gov/data/datasets/2012/dec/rdo/2012-cvap.html> | <https://www2.census.gov/programs-surveys/decennial/rdo/datasets/2012/2012-cvap/CVAP_2008-2012_ACS_csv_files.zip> |
  | 2014 | 2010-2014 ACS 5-year | <https://www.census.gov/data/datasets/2014/dec/rdo/2014-cvap.html> | <https://www2.census.gov/programs-surveys/decennial/rdo/datasets/2014/2014-cvap/CVAP_2010-2014_ACS_csv_files.zip> |
  | 2016 | 2012-2016 ACS 5-year | <https://www.census.gov/data/datasets/2016/dec/rdo/2012-2016-CVAP.html> | <https://www2.census.gov/programs-surveys/decennial/rdo/datasets/2016/2016-cvap/CVAP_2012-2016_ACS_csv_files.zip> |
  | 2018 | 2014-2018 ACS 5-year | <https://www.census.gov/programs-surveys/decennial-census/about/voting-rights/cvap/2014-2018-CVAP.html> | <https://www2.census.gov/programs-surveys/decennial/rdo/datasets/2018/2018-cvap/CVAP_2014-2018_ACS_csv_files.zip> |
  | 2020 | 2016-2020 ACS 5-year | <https://www.census.gov/programs-surveys/decennial-census/about/voting-rights/cvap/2016-2020-CVAP.html> | <https://www2.census.gov/programs-surveys/decennial/rdo/datasets/2020/2020-cvap/CVAP_2016-2020_ACS_csv_files.zip> |
  | 2022 | 2018-2022 ACS 5-year | <https://www.census.gov/programs-surveys/decennial-census/about/voting-rights/cvap/2018-2022-CVAP.html> | <https://www2.census.gov/programs-surveys/decennial/rdo/datasets/2022/2022-cvap/CVAP_2018-2022_ACS_csv_files.zip> |
  | 2024 | 2019-2023 ACS 5-year | <https://www.census.gov/data/datasets/2023/dec/rdo/2019-2023-CVAP.html> | <https://www2.census.gov/programs-surveys/decennial/rdo/datasets/2023/2023-cvap/CVAP_2019-2023_ACS_csv_files.zip> |

  Every vintage's zip contains a `Place.csv` entry; this pipeline reads only that entry.
- **Retrieved:** 2026-08-12 (all vintages, same session).
- **Licence:** US Government Work — public domain, every vintage.
- **Fields used:** `geoname`, `geoid` (join key), `lnnumber` (`"1"` = Total row only —
  race/ethnicity breakout rows are not used), `cvap_est`, `cvap_moe`.
- **Format drift across vintages, confirmed by downloading and inspecting all seven real
  files:**
  - Column headers are **UPPERCASE** (`GEONAME`, `GEOID`, ...) in the 2008-2012 through
    2012-2016 vintages, and **lowercase** (`geoname`, `geoid`, ...) from the 2014-2018
    vintage onward. `parseCvapPlaceRows()` looks up columns case-insensitively, so this
    needs no per-year branch.
  - The geoid's place-level prefix is the 7-character `"16000US"` through the 2014-2018
    vintage, and the 9-character `"1600000US"` from the 2016-2020 vintage onward — but the
    trailing 7 digits (2-digit state FIPS + 5-digit place FIPS) are identical in both
    families (confirmed: St. Paul's geoid ends `...2758000` in every vintage checked,
    oldest to newest). The parser matches on that trailing 7-digit suffix rather than a
    hardcoded prefix, so this also needs no per-year branch.

## The join

`MCDFIPS` on the SOS precinct file is the same 5-digit place FIPS code embedded in a CVAP
row's `geoid` — confirmed by direct inspection in both the oldest (2008-2012) and newest
(2019-2023) CVAP vintages: St. Paul's `MCDFIPS` "58000" matches CVAP geoid state 27 +
"58000" in both. Cities are grouped by `MCDFIPS`, not by name — Minnesota has two entirely
different, unrelated cities both named "St. Anthony" (Hennepin/Ramsey counties, FIPS
56680; a separate city in Stearns County, FIPS 56698), confirmed live in the real data.
Grouping by name would silently merge their precincts into one false combined record;
grouping by FIPS keeps them as two separate `cityId`s (`st-anthony`, `st-anthony-2`) in
every year both cities appear.

**Each year's join is resolved entirely independently, against that year's own
SOS-published MCDFIPS/MCDNAME data.** No attempt is made to force one year's city
boundaries onto another year's — a city that was annexed, split, incorporated, or renamed
between two covered elections may appear under a different FIPS code, a different name, or
not appear at all in one year's file. This is by design, not a gap to fix: forcing today's
boundaries onto a decade-old precinct file would be exactly the kind of guess AGENTS.md
§3.1 and §3.3 rule out.

## Known gaps in the join, per year (real 2026-08-12 run)

- **2012:** all 853 real cities in the file have a `turnoutOfCVAP` figure, except
  **Funkley** — its CVAP row was found but the 2008-2012 vintage's `cvap_est` for Funkley
  is 0 (Funkley is one of Minnesota's smallest incorporated cities), so `turnoutOfCVAP`
  ships `null` rather than a divide-by-zero or a guessed figure.
- **2014, 2018, 2020:** all 853 real cities in each file have a real, non-null
  `turnoutOfCVAP`. No gap.
- **2016:** all 853 real cities have a `turnoutOfCVAP`, except **Johnson** — same
  zero-`cvap_est` case as Funkley above (this vintage), not a missing match.
- **2022:** all 855 real cities have a `turnoutOfCVAP`, except **Fort Snelling Unorg**
  (MCDFIPS 21965) — no matching Census CVAP Place record was found at all for this
  MCDFIPS in the 2018-2022 vintage. `turnoutOfCVAP` ships `null`.
- **2024 (PR A):** all 855 real cities have a `turnoutOfCVAP`, except **Empire** (MCDFIPS
  19358) — no matching Census CVAP Place record found in the 2019-2023 vintage.

In every case above, the raw `ballotsCast`/`registeredAt7am`/`electionDayRegistrations`
counts are still published in full — only the derived `turnoutOfCVAP` percentage is
`null`, per AGENTS.md §3.3's "never fabricate or infer... leave it null."

## What this dataset does not cover (see also `knownGaps` in each year's own
`public/turnout/city/<year>.json`)

- County-level aggregation — a follow-up.
- Any election type other than the November general election — primaries, special
  elections, and off-year municipal elections are a follow-up.
- Townships and unorganized territory — excluded entirely, not folded into any city's
  totals, for every covered year.
- CVAP is always a modeled 5-year survey estimate with its own margin of error (see each
  city's `cvapMarginOfError`), never an exact citizen-population count, and the vintage
  used is not necessarily concurrent with the election year (see the per-election-year
  table above).
- Each year's city/precinct join is resolved only against that year's own SOS data — see
  "The join" above.

## Years attempted and not skipped

All seven configured years (2012, 2014, 2016, 2018, 2020, 2022, 2024) were located,
parsed, statewide-reconciled, and written on the real 2026-08-12 run. No year was skipped.
