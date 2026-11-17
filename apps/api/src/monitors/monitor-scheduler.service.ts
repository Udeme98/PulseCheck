import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { MonitorsService } from './monitors.service.js';

/**
 * Runs scheduled health checks for all active monitors that are due.
 *
 * Overlap prevention:
 *   `waitForCompletion: true` is passed to @Cron. This is a first-class
 *   option in @nestjs/schedule 12 (backed by the `cron` package). When set,
 *   the cron library will not fire a new tick until the current async handler
 *   has fully resolved, so scheduler-tick overlap is impossible at the
 *   single-process level.
 *
 * Bounded concurrency:
 *   Due monitors are processed in parallel batches. The batch size defaults
 *   to 10 and is configurable via MONITOR_CHECK_CONCURRENCY (positive integer).
 *   Monitors are sliced into groups of that size; each group runs under
 *   Promise.allSettled before the next group starts. This caps simultaneous
 *   outbound HTTP requests and in-flight DB transactions without an unbounded
 *   Promise.all over the entire population.
 *
 * Deduplication:
 *   Each check is dispatched through CheckCoordinatorService. If a manual
 *   trigger for the same monitor is already in flight, the coordinator returns
 *   the existing promise instead of issuing a second HTTP request.
 *
 * Failure isolation:
 *   Promise.allSettled absorbs per-monitor errors. One failure does not
 *   prevent the remaining monitors in the batch from being checked.
 */
@Injectable()
export class MonitorSchedulerService {
  private readonly logger = new Logger(MonitorSchedulerService.name);
  private readonly concurrency: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly monitorsService: MonitorsService,
    configService: ConfigService,
  ) {
    const raw = configService.get<string>('MONITOR_CHECK_CONCURRENCY');
    const parsed = raw !== undefined ? parseInt(raw, 10) : NaN;
    this.concurrency = Number.isInteger(parsed) && parsed > 0 ? parsed : 10;
  }

  @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
  async checkDueMonitors(): Promise<void> {
    const now = new Date();

    // Fetch only ACTIVE monitors whose nextCheckAt is in the past.
    // The composite index on (status, nextCheckAt) keeps this query efficient.
    // NULL nextCheckAt rows are excluded by the lte filter; the migration
    // backfills all pre-existing rows so NULL only arises in edge cases.
    const monitors = await this.prisma.monitor.findMany({
      where: {
        status: 'ACTIVE',
        nextCheckAt: { lte: now },
      },
      select: {
        id: true,
        userId: true,
        url: true,
      },
    });

    if (monitors.length === 0) {
      return;
    }

    this.logger.log(
      `Scheduler tick: ${monitors.length} monitor(s) due, concurrency cap ${this.concurrency}`,
    );

    // Process in bounded batches so at most `concurrency` checks run at once.
    for (let i = 0; i < monitors.length; i += this.concurrency) {
      const batch = monitors.slice(i, i + this.concurrency);

      await Promise.allSettled(batch.map((monitor) => this.runCheck(monitor)));
    }
  }

  private async runCheck(monitor: {
    id: string;
    userId: string;
    url: string;
  }): Promise<void> {
    try {
      // Dispatch through the coordinator so a concurrent manual check for
      // this monitor is deduplicated rather than doubling the HTTP request.
      await this.monitorsService.checkIfDue(monitor.id);

      this.logger.log(
        `Health check completed: monitor=${monitor.id} url=${monitor.url}`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Health check failed: monitor=${monitor.id} url=${monitor.url} userId=${monitor.userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
