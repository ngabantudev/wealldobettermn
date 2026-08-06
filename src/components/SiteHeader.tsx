// The site's identity bar — visually matched to mndatacenter.org's own
// navy/cyan header band (see globals.css's `.band` token overrides for
// the mechanism). Purely presentational: no controls live here. Map mode,
// filters, and search all stay where AGENTS.md Part 4 puts them — floating
// over the map itself, reachable without this bar — this is just the
// wordmark and one line saying what the site is for.
//
// "We All Do Better" — wealldobettermn.org, this site's domain, after
// Paul Wellstone's line about collective responsibility ("We all do
// better when we all do better"). MN is left implicit here — carried by
// the map itself, the tagline beside it, and the domain — rather than
// folded into the wordmark.
export default function SiteHeader() {
  return (
    <header className="band flex shrink-0 items-center justify-between gap-3 border-b border-hair bg-panel px-3.5 py-2.5 sm:px-4">
      {/* text-2xl font-black uppercase tracking-tight leading-none — the
          exact class list mndatacenter.org's own masthead headline uses
          (its FilterHeader.astro, the h1 that crossfades "Minnesota"/"Mni
          Sóta Makoce"). `truncate`, not their `whitespace-nowrap`: their
          headline sits in a fixed-width sidebar; this one's in a flexible
          top bar next to the tagline, so it still needs a safety valve on
          a narrow viewport. */}
      <div className="flex min-w-0 items-center">
        <span className="truncate text-2xl font-black uppercase tracking-tight leading-none text-ink">We All Do Better</span>
      </div>
      <p className="hidden truncate text-xs text-ink-3 sm:block">
        Who represents you, what they vote for, how to reach them.
      </p>
    </header>
  );
}
