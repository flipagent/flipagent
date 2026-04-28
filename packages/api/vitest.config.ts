import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
		hookTimeout: 30_000,
		testTimeout: 15_000,
		// Each test file gets a fresh module graph so vi.mock() at the top of
		// a file deterministically intercepts ../src/proxy/scrape.js before
		// the routes load it.
		isolate: true,
		pool: "forks",
	},
});
