import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { MonitorsService } from './monitors.service.js';

@Injectable()
export class MonitorSchedulerService {
  private readonly logger = new Logger(MonitorSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly monitorsService: MonitorsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async checkDueMonitors(): Promise<void> {
    const now = new Date();

    const monitors = await this.prisma.monitor.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        userId: true,
        intervalSeconds: true,
        lastCheckedAt: true,
      },
    });

    for (const monitor of monitors) {
      const isDue =
        monitor.lastCheckedAt === null ||
        now.getTime() - monitor.lastCheckedAt.getTime() >=
          monitor.intervalSeconds * 1000;

      if (!isDue) {
        continue;
      }

      try {
        await this.monitorsService.check(monitor.id, monitor.userId);
        this.logger.log(`Health check completed for monitor ${monitor.id}`);
      } catch (error: unknown) {
        this.logger.error(
          `Health check failed for monitor ${monitor.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }
}
