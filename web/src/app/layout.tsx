import type { Metadata } from "next";
import { Suspense } from "react";
import { Barlow, Barlow_Semi_Condensed } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/app-shell";

const barlow = Barlow({ variable: "--font-barlow", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const barlowSC = Barlow_Semi_Condensed({ variable: "--font-barlow-sc", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "UAV Log",
  description: "Find flights and events by meaning, then inspect them in synchronized telemetry.",
};

// Runs before paint so the saved theme never flashes.
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowSC.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>
          <Suspense fallback={<div className="h-14 border-b border-rule bg-panel" />}><AppShell>{children}</AppShell></Suspense>
        </Providers>
      </body>
    </html>
  );
}
