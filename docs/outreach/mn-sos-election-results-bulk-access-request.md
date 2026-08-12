# Draft outreach — MN Secretary of State, election results bulk/FTP access

**Status:** Draft for a human to review, personalize, and send. Not sent by any
automated process. See AGENTS.md §2.2 ("a source that cannot be fetched
politely gets a knownGaps entry and a manual workflow, not a workaround") and
§0.8 (any upstream API is assumed to die — this is why we're asking for the
same sanctioned channel a known, going press partner already uses, rather
than working around the block).

## Why this exists

`electionresults.sos.mn.gov` and `sos.mn.gov` both sit behind a Radware bot-
management challenge that blocks automated requests outright, including a
`curl` fetch carrying a descriptive, honest User-Agent (`wealldobettermn-ETL/
1.0`, contact email, stated civic-data purpose) — verified live 2026-08-12.
`robots.txt` itself returns the same challenge, so this project cannot even
confirm crawl permissions programmatically. Following the challenge (solving
it with a headless browser, replaying session cookies from a manual visit,
etc.) would be block evasion, which this project's own rules forbid
regardless of how sympathetic the use case is.

The Star Tribune's open-source `striblab/mn-elections-api` project
(https://github.com/striblab/mn-elections-api, MIT-licensed) pulls MN
election results via **FTP**, using `SOS_FTP_USER`/`SOS_FTP_PASS`
credentials — meaning the Secretary of State already runs a sanctioned bulk-
data channel for press/data partners, separate from the public,
bot-walled website. That's the legitimate path here.

## Suggested request (personalize before sending)

> Subject: Bulk/FTP access to election results data — nonpartisan civic
> transparency project
>
> Hello,
>
> I maintain [wealldobettermn](https://github.com/steveyang-dev/
> wealldobettermn), a nonpartisan, ad-free, non-commercial civic
> transparency site covering Minnesota local, county, and state government —
> officeholders, votes, and (per this request) election results, all
> sourced to primary government records with citations.
>
> I'd like to request bulk/FTP access to Minnesota election results data —
> the same kind of arrangement referenced in the Star Tribune's open-source
> `mn-elections-api` project, which credits an SOS-provided FTP feed. Our
> public-facing website (electionresults.sos.mn.gov) currently returns a
> bot-management challenge to any automated request, including ones
> carrying an honest, descriptive User-Agent, so we're not able to use the
> public site for scheduled data pulls without violating our own project's
> "no block evasion" policy — hence this direct request.
>
> Could you let me know:
> 1. Whether bulk/FTP access is available to non-press civic data projects,
>    and if so, what the process is to request credentials.
> 2. What licensing/terms of use, if any, apply to redistributing this
>    data (I did not find a published terms-of-use page for
>    electionresults.sos.mn.gov).
> 3. Whether this covers the semicolon-delimited "Downloadable Text Files"
>    format referenced at `/Select/MediaFiles/Index?ersElectionId=<id>` for
>    each election.
>
> Happy to provide more detail about the project. Thank you for your time.
>
> [Your name]
> [Contact email]
> [Project URL]

## Where to send it

- General data practices contact: https://www.sos.mn.gov/about-the-office/
  rulemaking-data-practice/data-practice-requests/
- Elections division phone: Metro 651-215-1440 / Greater MN 1-877-600-VOTE
  (8683) — listed on sos.mn.gov's elections pages.

## What happens while this is pending

Per AGENTS.md §3.1/§3.3, this is tracked as a `knownGaps` entry in the
election-results registry entry (see `src/lib/layers.ts`) rather than worked
around. The ingest script (`scripts/ingest/mn-election-results.mjs`) is built
against the confirmed file format and reads from a local drop directory
(`scripts/ingest/data/mn-election-results-raw/`) so it's ready to run the
moment either (a) FTP credentials arrive, or (b) someone manually downloads
the public semicolon-delimited files in a browser (which passes the JS
challenge fine — only automation is blocked) and drops them in that
directory by hand.
