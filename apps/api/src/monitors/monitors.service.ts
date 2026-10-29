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
import { CheckStatus, MonitorHealthStatus } from '@prisma/client';

@Injectable()
export class MonitorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly httpCheckService: HttpCheckService,
  ) {}

  /**
   * Create a monitor owned by the authenticated user.
   * userId is always derived from the verified JWT — never from the request body.
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
   * Returns the updated Monitor record (same shape as before).
   */
  async update(id: string, userId: string, dto: UpdateMonitorDto) {
    const [updated] = await this.prisma.monitor.updateManyAndReturn({
      where: { id, userId },
      data: dto,
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

  async check(id: string, userId: string) {
    const monitor = await this.findOne(id, userId);

    // Run the actual HTTP health check.
    const result = await this.httpCheckService.check(monitor.url);

    const status = result.status === 'UP' ? CheckStatus.UP : CheckStatus.DOWN;

    const checkedAt = new Date();

    // Calculate the next failure count and overall health status.
    const consecutiveFailures =
      result.status === 'DOWN' ? monitor.consecutiveFailures + 1 : 0;

    const healthStatus =
      result.status === 'UP'
        ? MonitorHealthStatus.UP
        : consecutiveFailures >= 2
          ? MonitorHealthStatus.DOWN
          : monitor.healthStatus;

    // Save the result and update the monitor together.
    const [savedResult] = await this.prisma.$transaction([
      this.prisma.checkResult.create({
        data: {
          monitorId: id,
          status,
          statusCode: result.statusCode,
          responseTimeMs: result.responseTimeMs,
          errorMessage: result.errorMessage,
          checkedAt,
        },
      }),

      this.prisma.monitor.update({
        where: { id },
        data: {
          lastCheckedAt: checkedAt,
          consecutiveFailures,
          healthStatus,
        },
      }),
    ]);

    return {
      url: monitor.url,
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
}
