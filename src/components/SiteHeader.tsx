// The site's identity bar — visually matched to mndatacenter.org's own
// navy/cyan header band (see globals.css's `.band` token overrides for
// the mechanism). Purely presentational: no controls live here. Map mode,
// filters, and search all stay where AGENTS.md Part 4 puts them — floating
// over the map itself, reachable without this bar — this is just the
// wordmark and one line saying what the site is for.
export default function SiteHeader() {
  return (
    <header className="band flex shrink-0 items-center justify-between gap-3 border-b border-hair bg-panel px-3.5 py-2.5 sm:px-4">
      <div className="flex min-w-0 items-center">
        <span className="truncate text-sm font-bold tracking-tight text-ink">MN Civic Watch</span>
      </div>
      <p className="hidden truncate text-xs text-ink-3 sm:block">
        Who represents you, what they vote for, how to reach them.
      </p>
    </header>
  );
}
