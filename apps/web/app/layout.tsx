import type { Metadata, Viewport } from "next";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow/700.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "./globals.css";
import "./styles/controls.css";
import "./styles/sections.css";
import "./styles/tactic.css";
import "./styles/inbox.css";
import "./styles/market.css";
import "./styles/matchday.css";
import "./styles/history.css";
import "./styles/onboarding.css";
import "./styles/depth.css";
import { ToastProvider } from "@/components/ui";
import { DialogProvider } from "@/components/Dialog";
import { PwaRegister } from "@/components/Pwa";
import { ErrorReporter } from "@/components/ErrorReporter";
import { LangRuntime } from "@/components/LangRuntime";

export const metadata: Metadata = {
  title: "Football Legacy – Schreibe Fussball Geschichte",
  description: "Der Fussball-Manager im Browser: Kader, Taktik, Transfers und eine ganze Welt voller fiktiver Ligen.",
  applicationName: "Football Legacy",
  appleWebApp: { capable: true, title: "Football Legacy", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#11151c" },
    { media: "(prefers-color-scheme: light)", color: "#f1f3f7" },
  ],
};

// Theme vor dem ersten Rendern setzen, damit nichts flackert
const themeScript = `(function(){try{var t=localStorage.getItem('fl-theme')||'dark';var d=t==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):t;document.documentElement.dataset.theme=d;}catch(e){}})();`;
// Sprache aus dem Cookie; bei Englisch bleibt die Seite bis zur Übersetzung unsichtbar (höchstens 3 s)
const langScript = `(function(){var h=document.documentElement;if(/(?:^|;\\s*)fl-lang=en\\b/.test(document.cookie)){h.lang='en';h.classList.add('i18n-pending');setTimeout(function(){h.classList.remove('i18n-pending')},3000);}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: langScript }} />
      </head>
      <body>
        <ToastProvider><DialogProvider>{children}</DialogProvider></ToastProvider>
        <PwaRegister />
        <ErrorReporter />
        <LangRuntime />
      </body>
    </html>
  );
}
