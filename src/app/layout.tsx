import type { Metadata, Viewport } from "next";
import { Doto, Inter, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import { Suspense, type ReactNode } from "react";
import { Shell } from "@/components/shell/Shell";
import { DatasetProvider } from "@/lib/data/DatasetProvider";
import { BUILD_MODE, serverDataset } from "@/lib/data/server";
import type { Dataset } from "@/lib/data/types";
import { StoreProvider } from "@/lib/store/StoreProvider";
import "./globals.css";

// Type roles: DESIGN.md. next/font self-hosts and preloads all four, and gives
// each a fallback face with matching metrics, so nothing shifts when they load.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"] });
const doto = Doto({ variable: "--font-doto", subsets: ["latin"], weight: "800" });

// General Sans (Fontshare, ITF Free Font License): scripts/fetch-fonts.mjs
// downloads it before every build, because the licence doesn't allow the files
// in a public repository. See src/app/fonts/LICENSE-GeneralSans.txt.
const generalSans = localFont({
  variable: "--font-general-sans",
  src: [
    { path: "./fonts/GeneralSans-Semibold.woff2", weight: "600" },
    { path: "./fonts/GeneralSans-Bold.woff2", weight: "700" },
  ],
  adjustFontFallback: "Arial",
});

const DESCRIPTION =
  "Unofficial concept: a client portal and ops CRM on top of ziplime's Lime dry-run mode (PR #39). Take the 3-minute tour. Sample data.";

// Absolute URLs for the Open Graph image: the Vercel URL when deployed, localhost otherwise.
const SITE = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "ziplime Ops Console", template: "%s | ziplime Ops Console" },
  description: DESCRIPTION,
  openGraph: { title: "ziplime Ops Console", description: DESCRIPTION, type: "website", siteName: "ziplime Ops Console" },
  twitter: { card: "summary_large_image", title: "ziplime Ops Console", description: DESCRIPTION },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: "#000000",
};

// Applies the saved theme before first paint, so it never flashes. Night is the
// default; "light" and "auto" are opt-in. The html element already says "dark",
// so without script (or without storage) the page is dark.
// Also marks the page as scripted, so count-ups can hide their first frame.
// Also queues keys pressed before React attaches its listener (on a 6x slower CPU the
// page paints up to 348 ms earlier). Shortcuts replays the queue once, then sets it to null.
const THEME_SCRIPT = `document.documentElement.classList.add("js");try{var t=localStorage.getItem("ziplime-ops-console:theme");if(t==="light"||t==="auto")document.documentElement.dataset.theme=t}catch(e){}window.__earlyKeys=[];addEventListener("keydown",function(e){var q=window.__earlyKeys,x=e.target;if(!q||q.length>7||e.metaKey||e.ctrlKey||e.altKey||(x&&(x.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(x.tagName))))return;q.push(e.key)});`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${inter.variable} ${jetbrainsMono.variable} ${doto.variable} ${generalSans.variable} antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        {BUILD_MODE === "database" ? (
          <Suspense fallback={<p className="p-6 text-[14px] text-ink-2">Loading the console…</p>}>
            <DatabaseApp>{children}</DatabaseApp>
          </Suspense>
        ) : (
          <App dataset={null}>{children}</App>
        )}
      </body>
    </html>
  );
}

function App({ dataset, children }: { dataset: Dataset | null; children: ReactNode }) {
  return (
    <DatasetProvider dataset={dataset}>
      <StoreProvider>
        <Shell>{children}</Shell>
      </StoreProvider>
    </DatasetProvider>
  );
}

// Database mode: wait for a request, read through the data source, then render.
async function DatabaseApp({ children }: { children: ReactNode }) {
  return <App dataset={await serverDataset()}>{children}</App>;
}
