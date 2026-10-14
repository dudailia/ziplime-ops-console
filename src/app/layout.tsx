import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { Suspense, type ReactNode } from "react";
import { Shell } from "@/components/shell/Shell";
import { DatasetProvider } from "@/lib/data/DatasetProvider";
import { BUILD_MODE, serverDataset } from "@/lib/data/server";
import type { Dataset } from "@/lib/data/types";
import { StoreProvider } from "@/lib/store/StoreProvider";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef0f2" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1215" },
  ],
};

// Applies the saved theme before first paint, so dark mode doesn't flash.
// Also marks the page as scripted, so count-ups can hide their first frame.
const THEME_SCRIPT = `document.documentElement.classList.add("js");try{var t=localStorage.getItem("ziplime-ops-console:theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable} antialiased`} suppressHydrationWarning>
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
