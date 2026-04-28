import { defineConfig } from "astro/config";

import react from "@astrojs/react";

import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://flipagent.dev",
  output: "static",
  build: { format: "directory" },
  server: { port: 4321 },

  vite: {
    plugins: [tailwindcss()],
  },

  integrations: [react()],
});