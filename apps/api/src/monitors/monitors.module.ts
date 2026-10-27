import { Module } from '@nestjs/common';
import { MonitorsController } from './monitors.controller.js';
import { MonitorsService } from './monitors.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { HttpCheckService } from './http-check.service.js';
import { MonitorSchedulerService } from './monitor-scheduler.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [MonitorsController],
  providers: [MonitorsService, HttpCheckService, MonitorSchedulerService],
})
export class MonitorsModule {}
