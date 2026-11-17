/**
 * Unit tests for CheckCoordinatorService.
 *
 * Tests verify:
 *   - Concurrent requests for the same monitor deduplicate to one execution.
 *   - Concurrent requests for different monitors are independent.
 *   - In-flight entries are cleaned up after success.
 *   - In-flight entries are cleaned up after failure.
 *   - A new check can be started after the previous one completes.
 */

import { CheckCoordinatorService } from './check-coordinator.service.js';

describe('CheckCoordinatorService', () => {
  let coordinator: CheckCoordinatorService;

  beforeEach(() => {
    coordinator = new CheckCoordinatorService();
  });

  // -------------------------------------------------------------------------
  // Basic deduplication
  // -------------------------------------------------------------------------

  describe('deduplication', () => {
    it('calls the work factory only once for two simultaneous requests on the same monitor', async () => {
      const work = vi.fn().mockResolvedValue('result');

      const [r1, r2] = await Promise.all([
        coordinator.run('monitor-1', work),
        coordinator.run('monitor-1', work),
      ]);

      expect(work).toHaveBeenCalledTimes(1);
      expect(r1).toBe('result');
      expect(r2).toBe('result');
    });

    it('both callers receive the same resolved value', async () => {
      const sentinel = { status: 'UP' };
      const work = vi.fn().mockResolvedValue(sentinel);

      const [r1, r2] = await Promise.all([
        coordinator.run('monitor-1', work),
        coordinator.run('monitor-1', work),
      ]);

      expect(r1).toBe(sentinel);
      expect(r2).toBe(sentinel);
    });

    it('three simultaneous requests on the same monitor call work once', async () => {
      const work = vi.fn().mockResolvedValue(42);

      const results = await Promise.all([
        coordinator.run('monitor-1', work),
        coordinator.run('monitor-1', work),
        coordinator.run('monitor-1', work),
      ]);

      expect(work).toHaveBeenCalledTimes(1);
      expect(results).toEqual([42, 42, 42]);
    });
  });

  // -------------------------------------------------------------------------
  // Independence between different monitors
  // -------------------------------------------------------------------------

  describe('independent monitors', () => {
    it('runs separate work functions for different monitor IDs', async () => {
      const workA = vi.fn().mockResolvedValue('A');
      const workB = vi.fn().mockResolvedValue('B');

      const [a, b] = await Promise.all([
        coordinator.run('monitor-A', workA),
        coordinator.run('monitor-B', workB),
      ]);

      expect(workA).toHaveBeenCalledTimes(1);
      expect(workB).toHaveBeenCalledTimes(1);
      expect(a).toBe('A');
      expect(b).toBe('B');
    });

    it('a failure on one monitor does not affect another monitor', async () => {
      const failingWork = vi.fn().mockRejectedValue(new Error('check failed'));
      const successWork = vi.fn().mockResolvedValue('ok');

      const [result1, result2] = await Promise.allSettled([
        coordinator.run('monitor-fail', failingWork),
        coordinator.run('monitor-ok', successWork),
      ]);

      expect(result1.status).toBe('rejected');
      expect(result2.status).toBe('fulfilled');
      if (result2.status === 'fulfilled') {
        expect(result2.value).toBe('ok');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Cleanup after success
  // -------------------------------------------------------------------------

  describe('cleanup after success', () => {
    it('isInFlight returns false after the check resolves', async () => {
      const work = vi.fn().mockResolvedValue('done');

      await coordinator.run('monitor-1', work);

      expect(coordinator.isInFlight('monitor-1')).toBe(false);
    });

    it('size returns 0 after all checks complete', async () => {
      const work = vi.fn().mockResolvedValue('done');

      await Promise.all([
        coordinator.run('monitor-A', work),
        coordinator.run('monitor-B', work),
      ]);

      expect(coordinator.size).toBe(0);
    });

    it('a new check can be started for the same monitor after completion', async () => {
      const work = vi.fn().mockResolvedValue('result');

      await coordinator.run('monitor-1', work);
      await coordinator.run('monitor-1', work);

      // Two sequential checks → work should be called twice.
      expect(work).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // Cleanup after failure
  // -------------------------------------------------------------------------

  describe('cleanup after failure', () => {
    it('removes the in-flight entry even when the work promise rejects', async () => {
      const error = new Error('HTTP timeout');
      const work = vi.fn().mockRejectedValue(error);

      await expect(coordinator.run('monitor-1', work)).rejects.toThrow(error);

      expect(coordinator.isInFlight('monitor-1')).toBe(false);
    });

    it('size returns 0 after a failed check', async () => {
      const work = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(coordinator.run('monitor-1', work)).rejects.toThrow();

      expect(coordinator.size).toBe(0);
    });

    it('a new check can be started for the same monitor after a failure', async () => {
      const failWork = vi.fn().mockRejectedValue(new Error('first fails'));
      const okWork = vi.fn().mockResolvedValue('recovered');

      await expect(coordinator.run('monitor-1', failWork)).rejects.toThrow();
      const result = await coordinator.run('monitor-1', okWork);

      expect(result).toBe('recovered');
      expect(okWork).toHaveBeenCalledTimes(1);
    });

    it('both callers receive the rejection when the shared check fails', async () => {
      const error = new Error('timeout');
      let resolve!: () => void;

      // Create a promise that we control so both callers subscribe before it
      // settles.
      const slow = new Promise<string>((_, reject) => {
        resolve = () => reject(error);
      });

      const work = vi.fn().mockReturnValue(slow);

      const p1 = coordinator.run('monitor-1', work);
      const p2 = coordinator.run('monitor-1', work);

      resolve();

      const [r1, r2] = await Promise.allSettled([p1, p2]);

      expect(r1.status).toBe('rejected');
      expect(r2.status).toBe('rejected');
      expect(work).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // In-flight visibility
  // -------------------------------------------------------------------------

  describe('isInFlight / size visibility', () => {
    it('isInFlight returns true while the check is running', async () => {
      let resolveWork!: (v: string) => void;
      const slow = new Promise<string>((res) => {
        resolveWork = res;
      });
      const work = vi.fn().mockReturnValue(slow);

      const promise = coordinator.run('monitor-1', work);
      expect(coordinator.isInFlight('monitor-1')).toBe(true);

      resolveWork('done');
      await promise;

      expect(coordinator.isInFlight('monitor-1')).toBe(false);
    });

    it('size reflects the number of unique monitors currently in flight', async () => {
      let resolveA!: (v: string) => void;
      let resolveB!: (v: string) => void;

      const slowA = new Promise<string>((res) => {
        resolveA = res;
      });
      const slowB = new Promise<string>((res) => {
        resolveB = res;
      });

      const pA = coordinator.run('monitor-A', () => slowA);
      const pB = coordinator.run('monitor-B', () => slowB);

      expect(coordinator.size).toBe(2);

      resolveA('a');
      await pA;
      expect(coordinator.size).toBe(1);

      resolveB('b');
      await pB;
      expect(coordinator.size).toBe(0);
    });
  });
});
