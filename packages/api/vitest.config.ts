import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
		hookTimeout: 30_000,
		testTimeout: 15_000,
		// Each test file gets a fresh module graph so vi.mock() at the top
		// of a file deterministically intercepts modules (e.g. the eBay
		// scrape dispatcher in services/ebay/scrape/) before the routes
		// load them.
		isolate: true,
		pool: "forks",
		// Serialize test files. They share the local Postgres instance,
		// so per-file `afterAll` TRUNCATEs (routes.test.ts, etc.) raced
		// with rows in flight from neighbouring files when multiple
		// workers ran concurrently — flaky 422/expense-count assertions
		// in CI without any actual code defect. Tests are fast enough
		// (~3s total) that the parallelism win isn't worth the noise.
		fileParallelism: false,
	},
});
