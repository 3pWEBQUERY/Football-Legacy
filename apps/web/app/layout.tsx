import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui";

export const metadata: Metadata = {
  title: "Football Legacy – Schreibe Fussball Geschichte",
  description: "Der Fussball-Manager im Browser: Kader, Taktik, Transfers und eine ganze Welt voller fiktiver Ligen.",
  applicationName: "Football Legacy",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a101d" },
    { media: "(prefers-color-scheme: light)", color: "#f3f6fb" },
  ],
};

// Theme vor dem ersten Rendern setzen, damit nichts flackert
const themeScript = `(function(){try{var t=localStorage.getItem('fl-theme')||'system';var d=t==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):t;document.documentElement.dataset.theme=d;}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
