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
      <body className="h-full bg-canvas text-ink">{children}</body>
    </html>
  );
}
