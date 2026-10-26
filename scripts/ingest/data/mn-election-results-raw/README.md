# MN election results — manual raw-file drop directory

This directory exists because `scripts/ingest/mn-election-results.mjs` **cannot
fetch its source data over the network.** `electionresults.sos.mn.gov` and
`sos.mn.gov` both sit behind a Radware bot-management challenge that blocks
automated requests outright — verified live, even with a polite, honest,
descriptive User-Agent. Per `AGENTS.md` §2.2, this project does not attempt to
solve or evade that challenge (no headless browser automation, no cookie
replay, no guessing). See `docs/outreach/mn-sos-election-results-bulk-access-request.md`
for the bulk/FTP access request drafted for a human to send as the legitimate
alternative — while that's pending, this manual drop-directory workflow is the
only path.

## How to add a file

1. Open `https://electionresults.sos.mn.gov/Select/MediaFiles/Index?ersElectionId=<id>`
   in a real browser (this passes the JS challenge fine — only *automated*
   requests are blocked) and download the semicolon-delimited "Downloadable
   Text Files" for the election you want. For the 2026 MN state primary,
   `<id>` is `200`.
2. Create (if it doesn't already exist) a subdirectory named after that
   `ersElectionId`, e.g. `scripts/ingest/data/mn-election-results-raw/200/`.
3. Drop the downloaded file(s) into that subdirectory, unmodified. Any
   filename is fine — the ingest script reads every file in the directory
   except `README.md` and `.gitkeep`.
4. Run `node scripts/ingest/mn-election-results.mjs` (see that script's own
   header comment for the `--certification-status` flag, which must be set
   by hand — this script cannot detect a county or state canvass on its own).

For v1, only statewide and district-level files are ingested, not
precinct-level files — precinct geometry is an explicit out-of-scope decision,
tracked as a `knownGaps` entry on the layer registry entry
(`ELECTION_RESULTS_LAYER` in `src/lib/layers.ts`), not a bug.

## Why not automate this

See `AGENTS.md` §2.2: "A source that cannot be fetched politely gets a
`knownGaps` entry and a manual workflow, not a workaround." This directory,
plus the outreach doc above, is that manual workflow and its documented
escalation path.

With no files present, the ingest script exits 0 and writes an honest empty
state to `public/election-results/index.json` (zero contests, `knownGaps`
explaining why) rather than skipping silently — per `AGENTS.md` §3.1.
