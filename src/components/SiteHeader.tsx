// The site's identity bar — visually matched to mndatacenter.org's own
// navy/cyan header band (see globals.css's `.band` token overrides for
// the mechanism). Purely presentational: no controls live here. Map mode,
// filters, and search all stay where AGENTS.md Part 4 puts them — floating
// over the map itself, reachable without this bar — this is just the
// wordmark and the line saying what the site is for.
//
// "We All Do Better" / "when we all do better" — wealldobettermn.org,
// this site's domain, after Paul Wellstone's line about collective
// responsibility. Split across two lines rather than one long headline
// or a hover tooltip: a tooltip (the `title`-attribute trick
// mndatacenter.org uses for its own Dakota-name headline) never reaches
// anyone on a touch device — there's no hover state on a phone — and this
// is a civic site whose own accessibility principles (AGENTS.md §0.7)
// exist for exactly that visitor. Always-visible and screen-reader-native
// beats "reward the curious." MN itself is left implicit — carried by
// the map, the right-hand tagline, and the domain.
export default function SiteHeader() {
  return (
    <header className="band flex shrink-0 items-center justify-between gap-3 border-b border-hair bg-panel px-3.5 py-2.5 sm:px-4">
      <div className="flex min-w-0 flex-col justify-center">
        {/* text-2xl font-black uppercase tracking-tight leading-none — the
            exact class list mndatacenter.org's own masthead headline uses
            (its FilterHeader.astro, the h1 that crossfades "Minnesota"/"Mni
            Sóta Makoce"). `truncate`, not their `whitespace-nowrap`: their
            headline sits in a fixed-width sidebar; this one's in a flexible
            top bar next to the tagline, so it still needs a safety valve on
            a narrow viewport. */}
        <span className="truncate text-2xl font-black uppercase tracking-tight leading-none text-ink">We All Do Better</span>
        {/* The completion, not a repeat — lowercase and small so it reads
            as one phrase continuing (and finishing) the bold line above,
            not a second competing headline. `text-justify` +
            `text-align-last:justify` spread its word-spacing to fill
            exactly the headline's own width: the parent's flex-col
            default (align-items: stretch) already sizes this span's box
            to match the headline above it — nothing here sets a width
            directly, so it can't drift out of sync if the headline's
            text or size ever changes. */}
        <span className="block truncate text-[11px] uppercase tracking-[0.2em] text-ink-3 text-justify [text-align-last:justify]">when we all do better</span>
      </div>
      <p className="hidden truncate text-xs text-ink-3 sm:block">
        Who represents you, what they vote for, how to reach them.
      </p>
    </header>
  );
}
