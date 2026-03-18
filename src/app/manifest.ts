import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pohotovosti",
    short_name: "Pohotovosti",
    description: "On-call scheduling system with PostgreSQL-backed records and mobile-friendly workflows.",
    start_url: "/",
    display: "standalone",
    background_color: "#f0f5f6",
    theme_color: "#0d6b73",
    orientation: "portrait",
    lang: "sk",
    icons: [
      {
        src: "/icons/192",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
