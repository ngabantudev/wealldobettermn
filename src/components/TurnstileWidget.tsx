"use client";

// Cloudflare Turnstile widget — the client half of the bot-check
// src/lib/turnstile.ts verifies server-side. AGENTS.md §2.6's own
// disclosed exception, already covered on /privacy. No new dependency:
// loaded directly via Cloudflare's own script rather than a wrapper
// package, matching AGENTS.md §0.8's dependency-light preference for
// something this small.
//
// NEXT_PUBLIC_TURNSTILE_SITE_KEY is a build-time public env var (inlined
// into the client bundle by Next.js — never a secret, this is the
// counterpart to the real secret in src/lib/turnstile.ts's
// TURNSTILE_SECRET_KEY, which never leaves the server). See
// .env.example for local dev setup — Cloudflare's own published testing
// site key works out of the box without registering a real Turnstile
// site.

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
        },
      ) => string;
    };
  }
}

interface TurnstileWidgetProps {
  onToken: (token: string | null) => void;
  /** Bump this after every submit attempt — Turnstile tokens are single-use, so the widget needs a fresh render for the next attempt. */
  resetKey: number;
}

export default function TurnstileWidget({ onToken, resetKey }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!scriptReady || !siteKey || !containerRef.current || !window.turnstile) return;
    // Clears any previous render before re-rendering on resetKey change —
    // Turnstile has no built-in "re-render in place" call, only render()
    // against a container.
    containerRef.current.innerHTML = "";
    window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      callback: (token) => onToken(token),
      "error-callback": () => onToken(null),
      "expired-callback": () => onToken(null),
    });
    // Deliberately re-runs only when the script becomes ready or the
    // parent asks for a fresh token — onToken is a fresh closure every
    // render and isn't meant to re-trigger a full widget re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptReady, resetKey]);

  if (!siteKey) {
    return (
      <p role="alert" className="text-xs text-vote-no">
        This form isn&apos;t configured for this environment (NEXT_PUBLIC_TURNSTILE_SITE_KEY missing) — submissions can&apos;t be verified here.
      </p>
    );
  }

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />
      <div ref={containerRef} />
    </>
  );
}
