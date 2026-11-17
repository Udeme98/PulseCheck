import { Injectable } from '@nestjs/common';

/**
 * Coordinates concurrent monitor checks across all call sites (scheduler and
 * manual HTTP triggers).
 *
 * When two callers request a check for the same monitor ID concurrently, the
 * second caller receives the same Promise that is already in flight rather
 * than issuing a redundant HTTP request. This prevents:
 *   - Duplicate HTTP outbound requests to the target.
 *   - Concurrent read-modify-write races on `consecutiveFailures`.
 *   - Duplicate CheckResult rows for the same interval.
 *
 * Checks for different monitors are fully independent and proceed in parallel.
 *
 * The in-flight entry is always removed in a `finally` block, so a failed
 * check does not permanently block future checks for that monitor.
 *
 * Authorization and ownership validation must be performed by the caller
 * *before* calling `run`. The coordinator is intentionally unaware of users:
 * it keys solely on monitor ID. The deduplication promise is shared between
 * any callers that hold the same monitor ID, but `MonitorsService.check` still
 * enforces `userId` ownership before the coordinator is reached.
 */
@Injectable()
export class CheckCoordinatorService {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  /**
   * Runs `work` for `monitorId`, or returns the existing in-flight promise if
   * a check for that monitor is already running.
   *
   * @param monitorId - The monitor's unique identifier used as the dedup key.
   * @param work      - A factory that creates the check promise. Called at
   *                    most once per concurrent window.
   */
  run<T>(monitorId: string, work: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(monitorId);
    if (existing !== undefined) {
      return existing as Promise<T>;
    }

    const promise = work().finally(() => {
      this.inFlight.delete(monitorId);
    });

    this.inFlight.set(monitorId, promise);
    return promise;
  }

  /**
   * Returns true when a check is currently in flight for the given monitor.
   * Intended for testing and observability only.
   */
  isInFlight(monitorId: string): boolean {
    return this.inFlight.has(monitorId);
  }

  /**
   * Returns the number of currently in-flight checks.
   * Intended for testing and observability only.
   */
  get size(): number {
    return this.inFlight.size;
  }
}
