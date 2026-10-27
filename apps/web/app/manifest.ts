import type { MetadataRoute } from "next";

/** Web-App-Manifest: Football Legacy lässt sich als App installieren. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Football Legacy",
    short_name: "Football Legacy",
    description: "Der Fussball-Manager im Browser: Kader, Taktik, Transfers und eine ganze Welt voller fiktiver Ligen.",
    id: "/",
    start_url: "/careers",
    scope: "/",
    display: "standalone",
    orientation: "any",
    lang: "de",
    background_color: "#11151c",
    theme_color: "#11151c",
    categories: ["games", "sports"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Meine Karrieren", url: "/careers", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Online-Ligen", url: "/online", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
