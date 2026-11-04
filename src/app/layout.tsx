import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const DESCRIPTION = "Say what you think ETH or BTC will do, in one sentence. See the best payout across Polymarket, Hyperliquid and Derive, and bet from your own wallet.";

export const metadata: Metadata = {
  metadataBase: new URL("https://one-sentence-bet.netlify.app"),
  title: "One sentence: bet on crypto prices, get the best payout",
  description: DESCRIPTION,
  applicationName: "One sentence",
  openGraph: {
    type: "website",
    url: "/",
    siteName: "One sentence",
    title: "One sentence",
    description: DESCRIPTION,
  },
  twitter: { card: "summary", title: "One sentence", description: DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: "#0f1012",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" style={{ colorScheme: "dark" }}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
