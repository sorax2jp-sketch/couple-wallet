import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      manifest: {
        name: "ふたりの立替",
        short_name: "ふたりの立替",
        lang: "ja",
        start_url: "/",
        display: "standalone",
        background_color: "#f7f8f6",
        theme_color: "#216b5b",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
        ],
      },
      workbox: {
        navigateFallback: "index.html",
        globPatterns: ["**/*.{js,css,html,png}"],
      },
    }),
  ],
  test: {
    exclude: [
      "**/node_modules/**",
      "**/lib/**",
      ...(process.env.FIRESTORE_EMULATOR_HOST ? [] : ["tests/rules.test.ts"]),
    ],
  },
});
