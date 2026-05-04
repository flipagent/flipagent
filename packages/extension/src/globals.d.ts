/**
 * Compile-time string constants injected by esbuild's `define` (see
 * build.mjs). Production build (`npm run build`) bakes the
 * `flipagent.dev` hosts; dev build (`npm run build:dev`) bakes
 * `localhost`. Runtime `loadConfig().baseUrl` still wins when set.
 */
declare const __FLIPAGENT_API_BASE__: string;
declare const __FLIPAGENT_DASHBOARD_BASE__: string;
declare const __FLIPAGENT_BUILD_ENV__: "dev" | "prod";
