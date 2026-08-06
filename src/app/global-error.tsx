"use client";

// Last-resort boundary: catches an exception thrown by the root layout
// itself, which src/app/error.tsx can't — Next requires global-error.tsx
// to render its own <html>/<body> because the layout that would normally
// provide them is what failed. Kept deliberately dependency-free (no
// import of globals.css, no design tokens, no other component) and
// styled inline: if the root layout is what broke, nothing downstream of
// it — including the stylesheet it might otherwise have wired up — can
// be assumed to still work. See src/app/error.tsx for the normal,
// styled boundary that handles everything below the layout, which is
// the one a visitor will actually see in the overwhelming majority of
// failures.
//
// Same rule as error.tsx: `error` is never logged anywhere client-side —
// AGENTS.md §0.12 / §2.5, nothing about a visitor's session leaves the
// device.

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          gap: "1rem",
          padding: "2.5rem 1.5rem",
          maxWidth: "32rem",
          marginInline: "auto",
          fontFamily: "system-ui, sans-serif",
          color: "#1b1b1b",
          background: "#f0f0f0",
        }}
      >
        <p style={{ fontSize: "0.875rem", fontWeight: 600, letterSpacing: "0.02em", color: "#0062b2" }}>
          SOMETHING WENT WRONG
        </p>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
          The site hit an error and couldn&apos;t load.
        </h1>
        <p style={{ fontSize: "0.875rem", color: "#333333", lineHeight: 1.5 }}>
          That&apos;s a bug on our end, not a sign that any civic data is wrong. Nothing you typed or searched was
          sent anywhere as part of this failure.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: "0.5rem",
            borderRadius: "0.375rem",
            background: "#0062b2",
            color: "#ffffff",
            border: "none",
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
