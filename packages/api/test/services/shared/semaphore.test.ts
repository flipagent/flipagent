/**
 * Semaphore correctness — bounded concurrency, FIFO dispatch, error
 * propagation, observability counters. The semaphore underpins both
 * Oxylabs (per-account cap) and the LLM provider wrap, so a regression
 * here would silently let either upstream get flooded.
 */

import { describe, expect, it } from "vitest";
import { Semaphore } from "../../../src/utils/semaphore.js";

describe("Semaphore", () => {
	it("caps in-flight tasks at limit", async () => {
		const sem = new Semaphore(2);
		let active = 0;
		let peak = 0;
		const task = async () => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((r) => setTimeout(r, 10));
			active--;
		};
		await Promise.all(Array.from({ length: 8 }, () => sem.run(task)));
		expect(peak).toBeLessThanOrEqual(2);
	});

	it("dispatches FIFO", async () => {
		const sem = new Semaphore(1);
		const order: number[] = [];
		const tasks = [0, 1, 2, 3, 4].map((i) =>
			sem.run(async () => {
				order.push(i);
				await new Promise((r) => setTimeout(r, 5));
			}),
		);
		await Promise.all(tasks);
		expect(order).toEqual([0, 1, 2, 3, 4]);
	});

	it("releases the slot when the task throws", async () => {
		const sem = new Semaphore(1);
		await expect(
			sem.run(async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		// Subsequent task must proceed; if release was skipped it would deadlock.
		const result = await sem.run(async () => "ok");
		expect(result).toBe("ok");
	});

	it("active and waiting reflect queue state", async () => {
		const sem = new Semaphore(1);
		const release = (() => {
			let r: () => void = () => {};
			const p = new Promise<void>((res) => {
				r = res;
			});
			return { p, r };
		})();

		const running = sem.run(async () => {
			await release.p;
		});
		// Yield so the running task acquires the slot.
		await Promise.resolve();
		expect(sem.active).toBe(1);
		expect(sem.waiting).toBe(0);

		const waiter = sem.run(async () => {});
		await Promise.resolve();
		expect(sem.waiting).toBe(1);

		release.r();
		await running;
		await waiter;
		expect(sem.active).toBe(0);
		expect(sem.waiting).toBe(0);
	});
});
