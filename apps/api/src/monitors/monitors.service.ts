
import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMonitorDto } from './dto/create-monitor.dto.js';
import { UpdateMonitorDto } from './dto/update-monitor.dto.js';

@Injectable()
export class MonitorsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async update(
    id: string,
    userId: string,
    dto: UpdateMonitorDto,
  ) {
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
}
