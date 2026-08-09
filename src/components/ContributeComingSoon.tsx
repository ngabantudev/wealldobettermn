"use client";

// The actual content of /contribute today: an honest "not live yet"
// state, not a form that pretends to work (see contribute/page.tsx's own
// header comment for why this page exists before the pipeline behind it
// does). `city` is read from the URL client-side via useSearchParams —
// never geocoded, never sent anywhere, the same "read it in the browser,
// don't compute anything from it on the server" shape AGENTS.md §2.5
// already requires for address search, applied here to a public city
// name for consistency rather than because this specific value is
// sensitive.
import { useSearchParams } from "next/navigation";

export default function ContributeComingSoon() {
  const searchParams = useSearchParams();
  const cityName = searchParams.get("city");

  return (
    <>
      <h1 className="text-xl font-semibold text-ink">Add your city&apos;s officials</h1>
      <p className="mt-2 text-sm text-ink-3">
        {cityName
          ? `You followed a link to add officials data for ${cityName} — thank you. `
          : ""}
        This feature isn&apos;t live yet. We&apos;re building a way for residents to submit a
        city&apos;s official website and have its mayor and council members added automatically, with the result
        checked before it&apos;s trusted rather than published on faith. That work is in progress.
      </p>

      <h2 className="mt-8 text-base font-semibold text-ink">Help right now instead</h2>
      <p className="mt-2 text-sm text-ink-3">
        {cityName ? (
          <>
            Open an issue naming <span className="font-medium text-ink-2">{cityName}</span> and its official
            website on the{" "}
          </>
        ) : (
          "Open an issue naming the city and its official website on the "
        )}
        <a
          href="https://github.com/ngabantudev/wealldobettermn/issues"
          className="text-accent underline underline-offset-2"
        >
          issue tracker
        </a>
        , and it&apos;ll be added by hand in the meantime, the same way every city on the map today was.
      </p>
    </>
  );
}
