import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deep Field — Vertical Minesweeper",
  description: "A three-layer tactical minesweeper.",
  openGraph: {
    title: "Deep Field — Vertical Minesweeper",
    description: "A three-layer tactical minesweeper.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
