import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMonitorDto } from './dto/create-monitor.dto.js';
import { UpdateMonitorDto } from './dto/update-monitor.dto.js';
import { HttpCheckService } from './http-check.service.js';
import { CheckStatus } from '@prisma/client';

@Injectable()
export class MonitorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly httpCheckService: HttpCheckService,
  ) {}

  async create(dto: CreateMonitorDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.prisma.monitor.create({
      data: {
        name: dto.name,
        url: dto.url,
        intervalSeconds: dto.intervalSeconds ?? 300,
        userId: dto.userId,
      },
    });
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

  async update(id: string, userId: string, dto: UpdateMonitorDto) {
    await this.findOne(id, userId);

    return this.prisma.monitor.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, userId: string) {
    await this.findOne(id, userId);

    await this.prisma.monitor.delete({
      where: { id },
    });

    return { message: 'Monitor deleted successfully' };
  }

  async check(id: string, userId: string) {
    const monitor = await this.findOne(id, userId);

    // Run the actual HTTP health check.
    const result = await this.httpCheckService.check(monitor.url);

    const status = result.status === 'UP' ? CheckStatus.UP : CheckStatus.DOWN;

    const checkedAt = new Date();

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
          consecutiveFailures: result.status === 'DOWN' ? { increment: 1 } : 0,
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
