import { defineConfig } from "astro/config";

import react from "@astrojs/react";

import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://flipagent.dev",
  output: "static",
  build: { format: "directory" },
  server: { port: 4321, allowedHosts: ["dev.flipagent.dev"] },

  vite: {
    plugins: [tailwindcss()],
    server: { allowedHosts: ["dev.flipagent.dev"] },
    // Pre-bundle the heavy deps at server boot so the first request
    // through `dev.flipagent.dev` (Cloudflare Tunnel, ~100s timeout)
    // doesn't trigger lazy optimisation mid-request and 504. Without
    // this, the first hit on a page that imports e.g. react-markdown +
    // remark-gfm has to wait for esbuild to chunk them, which is slower
    // than the tunnel will tolerate. Listed deps are the ones we've
    // historically seen 504 on — extend if a future page picks up
    // another heavy import.
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "motion/react",
        "react-markdown",
        "remark-gfm",
        "sonner",
        "@radix-ui/react-dialog",
        "@radix-ui/react-select",
        "@radix-ui/react-switch",
        "@radix-ui/react-tooltip",
      ],
    },
  },

  integrations: [react()],
});
