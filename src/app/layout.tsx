import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MN Civic Map",
  description: "Minnesota public issue layers: wards, reps, and how to reach them.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      {/* text-ink-canvas, not text-ink: the body sits on --canvas (the map
          backdrop), a different surface from the panels --ink is measured
          against — see globals.css's token notes. */}
      <body className="h-full bg-canvas text-ink-canvas">{children}</body>
    </html>
  );
}
