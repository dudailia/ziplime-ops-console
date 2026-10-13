import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { Shell } from "@/components/shell/Shell";
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

export const metadata: Metadata = {
  title: { default: "ziplime Ops Console", template: "%s · ziplime Ops Console" },
  description:
    "Unofficial concept: a client portal and ops CRM on top of ziplime's Lime dry-run mode. Sample data.",
};

// Applies the saved theme before first paint, so dark mode doesn't flash.
const THEME_SCRIPT = `try{var t=localStorage.getItem("ziplime-ops-console:theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <StoreProvider>
          <Shell>{children}</Shell>
        </StoreProvider>
      </body>
    </html>
  );
}
