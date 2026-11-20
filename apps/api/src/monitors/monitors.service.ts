import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMonitorDto } from './dto/create-monitor.dto.js';
import { UpdateMonitorDto } from './dto/update-monitor.dto.js';
import { HttpCheckService } from './http-check.service.js';
import { CheckCoordinatorService } from './check-coordinator.service.js';
import { CheckStatus, MonitorHealthStatus } from '@prisma/client';

@Injectable()
export class MonitorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly httpCheckService: HttpCheckService,
    private readonly checkCoordinator: CheckCoordinatorService,
  ) {}

  /**
   * Create a monitor owned by the authenticated user.
   * userId is always derived from the verified JWT — never from the request body.
   *
   * nextCheckAt is set to now() so the scheduler picks it up on the first tick.
   *
   * Throws UnauthorizedException if the userId foreign key no longer exists
   * (i.e. the account was deleted while the JWT was still valid).
   */
  async create(dto: CreateMonitorDto, userId: string) {
    try {
      return await this.prisma.monitor.create({
        data: {
          name: dto.name,
          url: dto.url,
          intervalSeconds: dto.intervalSeconds ?? 300,
          nextCheckAt: new Date(),
          userId,
        },
      });
    } catch (err) {
      // P2003 = foreign key constraint violation.
      // The userId in the JWT no longer exists in the User table.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new UnauthorizedException(
          'Your account no longer exists. Please register again.',
        );
      }
      throw err;
    }
  }

  async findAll(userId: string) {
    return this.prisma.monitor.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const monitor = await this.prisma.monitor.findFirst({
      where: { id, userId },
    });

    if (!monitor) {
      throw new NotFoundException('Monitor not found');
    }

    return monitor;
  }

  /**
   * Update a monitor atomically.
   *
   * Uses updateManyAndReturn with { id, userId } so the ownership check and the
   * mutation happen in a single database round-trip with no TOCTOU window.
   *
   * When intervalSeconds changes, the row is locked with FOR UPDATE before
   * reading lastCheckedAt so a concurrent executeCheck cannot read a stale
   * nextCheckAt value between the SELECT and the UPDATE.
   */
  async update(id: string, userId: string, dto: UpdateMonitorDto) {
    const updateData: Prisma.MonitorUpdateManyMutationInput = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.url !== undefined && { url: dto.url }),
      ...(dto.intervalSeconds !== undefined && {
        intervalSeconds: dto.intervalSeconds,
      }),
      ...(dto.status !== undefined && { status: dto.status }),
    };

    // Interval changes require a row lock so lastCheckedAt cannot become
    // stale between reading it and updating nextCheckAt.
    if (dto.intervalSeconds !== undefined) {
      return this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ lastCheckedAt: Date | null }>>`
          SELECT "lastCheckedAt"
          FROM "Monitor"
          WHERE "id" = ${id} AND "userId" = ${userId}
          FOR UPDATE
        `;

        const current = rows[0];

        if (!current) {
          throw new NotFoundException('Monitor not found');
        }

        const base = current.lastCheckedAt ?? new Date();
        const nextCheckAt = new Date(
          base.getTime() + dto.intervalSeconds! * 1000,
        );

        const [updated] = await tx.monitor.updateManyAndReturn({
          where: { id, userId },
          data: {
            ...updateData,
            nextCheckAt,
          },
        });

        if (!updated) {
          throw new NotFoundException('Monitor not found');
        }

        return updated;
      });
    }

    // Updates that do not change the interval need no scheduling lock.
    const [updated] = await this.prisma.monitor.updateManyAndReturn({
      where: { id, userId },
      data: updateData,
    });

    if (!updated) {
      throw new NotFoundException('Monitor not found');
    }

    return updated;
  }

  /**
   * Delete a monitor atomically.
   *
   * Uses deleteMany with { id, userId } so ownership is verified in the same
   * operation as the deletion — no TOCTOU window between findOne and delete.
   */
  async remove(id: string, userId: string) {
    const { count } = await this.prisma.monitor.deleteMany({
      where: { id, userId },
    });

    if (count === 0) {
      throw new NotFoundException('Monitor not found');
    }

    return { message: 'Monitor deleted successfully' };
  }

  /**
   * Run a health check for the given monitor.
   *
   * Ownership is verified first (findOne throws NotFoundException for a wrong
   * userId). Then the check is dispatched through the CheckCoordinatorService,
   * which deduplicates concurrent requests for the same monitor: if a check is
   * already in flight, the caller receives the existing promise rather than
   * triggering a second HTTP request.
   *
   * The deduplication happens *after* ownership is verified, so a request
   * from a user who does not own the monitor still fails at findOne.
   */
  async check(id: string, userId: string) {
    // Verify ownership before entering the coordinator.
    await this.findOne(id, userId);

    return this.checkCoordinator.run(id, async () => {
      // Reload inside the coordinator so we use the latest database state.
      const monitor = await this.findOne(id, userId);

      return this.executeCheck(
        monitor.id,
        monitor.url,
        monitor.consecutiveFailures,
        monitor.healthStatus,
      );
    });
  }

  /**
   * Run a scheduled check only if the monitor is still active and due.
   * The database state is reloaded inside the coordinator to avoid
   * executing checks using stale scheduler snapshots.
   */
  async checkIfDue(id: string) {
    return this.checkCoordinator.run(id, async () => {
      const monitor = await this.prisma.monitor.findFirst({
        where: {
          id,
          status: 'ACTIVE',
          nextCheckAt: { lte: new Date() },
        },
        select: {
          id: true,
          url: true,
          consecutiveFailures: true,
          healthStatus: true,
        },
      });

      // It may have been checked, paused, or deleted since the scheduler
      // initially fetched the due-monitor list.
      if (!monitor) {
        return null;
      }

      return this.executeCheck(
        monitor.id,
        monitor.url,
        monitor.consecutiveFailures,
        monitor.healthStatus,
      );
    });
  }

  /**
   * Execute the actual HTTP check and persist the result.
   * Called at most once per concurrent window for a given monitor ID.
   * This method does NOT perform ownership checks — the caller must do that
   * before reaching here.
   *
   * nextCheckAt is computed atomically inside the write transaction using the
   * monitor's current database intervalSeconds value rather than the value
   * captured at dispatch time. This eliminates the interval-update race:
   * if a concurrent PATCH changes intervalSeconds while the HTTP request is
   * in flight, the transaction reads the committed value from the row and
   * computes the correct next-check time regardless of which transaction
   * commits first.
   *
   *   Ordering A — interval PATCH commits before this transaction:
   *     The UPDATE here reads the new intervalSeconds and sets
   *     nextCheckAt = checkedAt + newInterval. Correct.
   *
   *   Ordering B — this transaction commits before the interval PATCH:
   *     The UPDATE here reads the old intervalSeconds. The PATCH then
   *     overwrites nextCheckAt with lastCheckedAt + newInterval. Correct.
   *
   * The callback form of $transaction is required so that $executeRaw
   * (which carries the column-expression for nextCheckAt) and
   * checkResult.create can share the same atomic unit.
   */
  async executeCheck(
    id: string,
    url: string,
    currentConsecutiveFailures: number,
    currentHealthStatus: MonitorHealthStatus,
  ) {
    // Run the actual HTTP health check.
    const result = await this.httpCheckService.check(url);

    const status = result.status === 'UP' ? CheckStatus.UP : CheckStatus.DOWN;

    const checkedAt = new Date();

    // Calculate the next failure count and overall health status.
    const consecutiveFailures =
      result.status === 'DOWN' ? currentConsecutiveFailures + 1 : 0;

    const healthStatus =
      result.status === 'UP'
        ? MonitorHealthStatus.UP
        : consecutiveFailures >= 2
          ? MonitorHealthStatus.DOWN
          : currentHealthStatus;

    // Persist the check result and update the monitor atomically.
    // nextCheckAt is derived from the row's current intervalSeconds column
    // so a concurrent interval change cannot be overwritten by a stale
    // parameter value captured before the HTTP request started.
    const savedResult = await this.prisma.$transaction(async (tx) => {
      const checkResult = await tx.checkResult.create({
        data: {
          monitorId: id,
          status,
          statusCode: result.statusCode,
          responseTimeMs: result.responseTimeMs,
          errorMessage: result.errorMessage,
          checkedAt,
        },
      });

      await tx.$executeRaw`
        UPDATE "Monitor"
        SET
          "lastCheckedAt"       = ${checkedAt},
          "consecutiveFailures" = ${consecutiveFailures},
          "healthStatus"        = ${healthStatus}::"MonitorHealthStatus",
          "nextCheckAt"         = ${checkedAt} + ("intervalSeconds" * INTERVAL '1 second'),
          "updatedAt"           = NOW()
        WHERE id = ${id}
      `;

      if (status === CheckStatus.DOWN && consecutiveFailures >= 2) {
        const { count } = await tx.incident.createMany({
          data: [{ monitorId: id, startedAt: checkedAt }],
          skipDuplicates: true,
        });

        // Only create a notification when a new incident was actually opened.
        if (count === 1) {
          const incident = await tx.incident.findFirst({
            where: { monitorId: id, startedAt: checkedAt },
            select: { id: true },
          });

          if (!incident) {
            throw new Error('Newly created incident could not be found');
          }

          const monitor = await tx.monitor.findUnique({
            where: { id },
            select: {
              name: true,
              url: true,
              user: {
                select: { email: true },
              },
            },
          });

          if (!monitor) {
            throw new Error('Monitor not found while creating notification');
          }

          await tx.notification.create({
            data: {
              type: 'INCIDENT_OPENED',
              recipient: monitor.user.email,
              payload: {
                monitorName: monitor.name,
                monitorUrl: monitor.url,
                incidentStartedAt: checkedAt.toISOString(),
              },
              incidentId: incident.id,
              deduplicationKey: `${incident.id}:INCIDENT_OPENED`,
            },
          });
        }
      } else if (status === CheckStatus.UP) {
        const openIncident = await tx.incident.findFirst({
          where: { monitorId: id, resolvedAt: null },
          select: { id: true },
        });

        if (openIncident) {
          const { count } = await tx.incident.updateMany({
            where: {
              id: openIncident.id,
              resolvedAt: null,
            },
            data: { resolvedAt: checkedAt },
          });

          // Only notify if this transaction actually resolved the incident.
          if (count === 1) {
            const monitor = await tx.monitor.findUnique({
              where: { id },
              select: {
                name: true,
                url: true,
                user: {
                  select: { email: true },
                },
              },
            });

            if (!monitor) {
              throw new Error('Monitor not found while creating notification');
            }

            await tx.notification.create({
              data: {
                type: 'INCIDENT_RESOLVED',
                recipient: monitor.user.email,
                payload: {
                  monitorName: monitor.name,
                  monitorUrl: monitor.url,
                  incidentResolvedAt: checkedAt.toISOString(),
                },
                incidentId: openIncident.id,
                deduplicationKey: `${openIncident.id}:INCIDENT_RESOLVED`,
              },
            });
          }
        }
      }

      return checkResult;
    });

    return {
      url,
      ...savedResult,
    };
  }

  async getCheckHistory(id: string, userId: string) {
    // Verify the monitor exists and belongs to this user.
    await this.findOne(id, userId);

    return this.prisma.checkResult.findMany({
      where: { monitorId: id },
      orderBy: { checkedAt: 'desc' },
      take: 50,
    });
  }

  async getIncidents(id: string, userId: string) {
    await this.findOne(id, userId);

    return this.prisma.incident.findMany({
      where: { monitorId: id },
      orderBy: { startedAt: 'desc' },
    });
  }
}
