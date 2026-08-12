import type { Metadata } from "next";

// Bio-link landing page (e.g. for a TikTok/Instagram profile link) pointing
// at We All Do Better and its sister civic-transparency sites — see
// AGENTS.md's "Role in the wider project" section. Static content route,
// same pattern as the other pages in this group (About, Privacy, ...).
//
// No webfonts: AGENTS.md §2.3 forbids third-party fonts outright, so this
// uses the site's existing system font stack (--font-sans / --font-mono,
// see globals.css) rather than the Google Fonts the original draft used.
// The bold display type is approximated with font-black + tight tracking
// instead of a loaded display face.

export const metadata: Metadata = {
  title: "Links — We All Do Better",
  description:
    "Free, public, open-source tools mapping how power actually moves in Minnesota.",
};

type Site = {
  name: string;
  domain: string;
  desc: string;
  url: string;
};

const sites: Site[] = [
  {
    name: "flock off, mn",
    domain: "flockoffmn.org",
    desc: "Mapping surveillance and enforcement systems across Minnesota — Flock cameras, ICE agreements, and who's behind them.",
    url: "https://flockoffmn.org/",
  },
  {
    name: "mn data center watch",
    domain: "mndatacenter.org",
    desc: "Tracking the data center buildout across the state — where they're going, who's building them, what it costs.",
    url: "https://mndatacenter.org/",
  },
  {
    name: "we all do better, mn",
    domain: "wealldobettermn.org",
    desc: "Who represents you, what they vote for, and where their money comes from — city, county, and state.",
    url: "https://wealldobettermn.org/",
  },
  // Add a new site by adding one object here — no other changes needed.
];

export default function LinksPage() {
  return (
    <main
      className="flex min-h-screen justify-center px-5 font-sans"
      style={{
        background: "linear-gradient(180deg, #0d2b30 0%, #123c42 55%, #1c545c 100%)",
      }}
    >
      <div className="w-full max-w-[480px] pt-14 pb-10 sm:pt-16">
        {/* Signature element: rising heat gauge. The dot at its base emits
            slow ripple rings — three copies of the same ring, staggered by
            animation-delay so one is always mid-fade as the next begins,
            rather than three re-triggering in lockstep. Kept to a plain
            <style> tag (not a Tailwind utility) since the keyframes need a
            named animation; respects prefers-reduced-motion per AGENTS.md
            §4 by dropping straight to the static dot with no rings. */}
        <style>{`
          @keyframes links-ripple {
            0% { transform: translate(-50%, -50%) scale(1); opacity: 0.5; }
            100% { transform: translate(-50%, -50%) scale(4.5); opacity: 0; }
          }
          .links-ripple {
            animation: links-ripple 3.6s cubic-bezier(0.2, 0.6, 0.4, 1) infinite;
          }
          @media (prefers-reduced-motion: reduce) {
            .links-ripple { animation: none; display: none; }
          }
        `}</style>
        <div className="relative mx-auto mb-7 h-14 w-[3px] rounded-full bg-gradient-to-b from-[#e8672a] via-[#c1440e] to-transparent sm:h-16">
          <span
            className="links-ripple absolute bottom-[0.5px] left-1/2 h-2.75 w-2.75 rounded-full border border-[#e8672a]"
            style={{ animationDelay: "0s" }}
          />
          <span
            className="links-ripple absolute bottom-[0.5px] left-1/2 h-2.75 w-2.75 rounded-full border border-[#e8672a]"
            style={{ animationDelay: "1.2s" }}
          />
          <span
            className="links-ripple absolute bottom-[0.5px] left-1/2 h-2.75 w-2.75 rounded-full border border-[#e8672a]"
            style={{ animationDelay: "2.4s" }}
          />
          <span
            className="absolute -bottom-[5px] left-1/2 h-[11px] w-[11px] -translate-x-1/2 animate-pulse rounded-full bg-[#e8672a]"
            style={{ boxShadow: "0 0 14px 3px rgba(232,103,42,0.55)" }}
          />
        </div>

        <header className="mb-9 text-center sm:mb-11">
          <div className="mb-3.5 font-mono text-[11px] tracking-[0.22em] text-[#b9c8c4] uppercase">
            Minnesota / Civic Tech
          </div>

          <h1 className="mb-4 text-[34px] leading-[0.98] font-black tracking-tight text-[#eef2ef] sm:text-[44px] md:text-[48px]">
            real frogs jump.
            <br />
            so should we.
          </h1>

          <p className="mb-5 font-mono text-[12px] tracking-[0.06em] text-[#e8672a] sm:text-[13px]">
            receipts, not rhetoric.
          </p>

          <p className="mx-auto max-w-[320px] text-[14px] leading-[1.55] text-[#b9c8c4]">
            Free, public, open-source tools mapping how power actually moves in this state.
          </p>

          <p className="mt-3.5 font-mono text-[11px] tracking-[0.05em] text-[#eef2ef]/40">
            human-led. AI-assisted. no black boxes.
          </p>
        </header>

        <div className="flex flex-col gap-3.5">
          {sites.map((site) => (
            <a
              key={site.domain}
              href={site.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-[10px] border border-[#eef2ef]/[0.14] bg-[#eef2ef]/[0.04] px-5 pt-5 pb-[18px] transition-all hover:-translate-y-px hover:border-[#e8672a]/55 hover:bg-[#eef2ef]/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8672a] active:scale-[0.99]"
            >
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="text-[19px] font-semibold tracking-tight text-[#eef2ef] sm:text-[22px]">
                  {site.name}
                </span>
                <span className="shrink-0 text-[15px] text-[#e8672a]">&#8599;</span>
              </div>
              <p className="mb-2.5 text-[13.5px] leading-[1.5] text-[#b9c8c4]">{site.desc}</p>
              <div className="font-mono text-[11px] tracking-[0.04em] break-words text-[#eef2ef]/45">
                {site.domain}
              </div>
            </a>
          ))}
        </div>

        <p className="mt-5 text-center font-mono text-[11px] tracking-[0.08em] text-[#eef2ef]/35 uppercase">
          + more being added
        </p>
      </div>
    </main>
  );
}
