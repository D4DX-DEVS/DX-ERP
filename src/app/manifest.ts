import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "D4DX ERP",
    short_name: "D4DX ERP",
    description: "D4DX Innovations LLP internal ERP",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    lang: "en-IN",
    background_color: "#F4F6FB",
    theme_color: "#0A1450",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Logo inside the safe zone on white, for Android's round / squircle launcher masks.
      { src: "/brand/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
