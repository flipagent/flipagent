/**
 * Minimal FIFO semaphore. Bounds in-flight async work; excess callers
 * queue and dispatch in order as leases release. Used as the single
 * concurrency primitive for any external resource with a hard cap:
 *
 *   - Oxylabs Realtime API (per-account parallel-request limit)
 *   - LLM providers (per-tier rate-limit window)
 *
 * Plain Promise-based, no external deps. Each consumer constructs one
 * `Semaphore(limit)` at module scope and calls `run(task)` — the
 * semaphore guarantees at most `limit` tasks execute concurrently.
 */
export class Semaphore {
	private inFlight = 0;
	private readonly queue: Array<() => void> = [];

	constructor(private readonly limit: number) {}

	async run<T>(task: () => Promise<T>): Promise<T> {
		await this.acquire();
		try {
			return await task();
		} finally {
			this.release();
		}
	}

	/** Current count of running tasks. Useful for observability logs. */
	get active(): number {
		return this.inFlight;
	}

	/** Current count of waiting acquirers. Useful for observability logs. */
	get waiting(): number {
		return this.queue.length;
	}

	private acquire(): Promise<void> {
		if (this.inFlight < this.limit) {
			this.inFlight++;
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			this.queue.push(() => {
				this.inFlight++;
				resolve();
			});
		});
	}

	private release(): void {
		this.inFlight--;
		const next = this.queue.shift();
		if (next) next();
	}
}
