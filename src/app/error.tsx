"use client";

import Link from "next/link";

// App Router route-segment error boundary. Catches a rendering/runtime
// exception anywhere below the root layout and shows an honest, on-brand
// message instead of Cloudflare's raw "Internal Server Error" text (or a
// blank white screen) — AGENTS.md §0.7 ("plain-language ... every
// technical field") and §3.1 ("an empty state is a known gap; fake data
// is a lie the user cannot detect") apply here too: an error page should
// say plainly that something broke, not pretend the page is fine or show
// fabricated content in place of what failed to load.
//
// This does not replace fixing the underlying cause. It exists for the
// next time something throws that we didn't catch in review — see
// next.config.ts and src/lib/stateLegislatureData.ts for the 2026-08-06
// incident this file was added alongside, where a module-scope disk read
// that only works during `next build` got bundled into the deployed
// Worker and threw on every request, site-wide, with no boundary to
// catch it.
//
// Deliberately does not log `error` anywhere (console, network, etc.):
// per AGENTS.md §0.12 / §2.5, nothing about a visitor's session — which
// includes exception details that could echo back query state — leaves
// the device. Cloudflare's own edge logs (see /privacy, now a real page
// rather than a dangling comment reference) already capture what a
// maintainer needs from the Worker side.

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-start justify-center gap-4 px-6 py-10">
      <p className="text-sm font-medium tracking-wide text-accent uppercase">Something went wrong</p>
      <h1 className="text-xl font-semibold text-ink-canvas">This page hit an error and couldn&apos;t load.</h1>
      <p className="text-sm text-ink-canvas/80">
        That&apos;s a bug on our end, not a sign that the data itself is wrong. Nothing you typed or searched was
        sent anywhere as part of this failure.
      </p>
      <div className="flex flex-wrap gap-3 pt-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-md border border-hair-strong px-4 py-2 text-sm font-medium text-ink-canvas hover:bg-accent-soft"
        >
          Back to the map
        </Link>
      </div>
      <Link href="/privacy" className="text-sm text-accent underline underline-offset-2">
        What this site sends and doesn&apos;t send
      </Link>
    </main>
  );
}
