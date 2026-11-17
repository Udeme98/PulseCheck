import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MonitorsController } from './monitors.controller.js';
import { MonitorsService } from './monitors.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { HttpCheckService } from './http-check.service.js';
import { CheckCoordinatorService } from './check-coordinator.service.js';
import { MonitorSchedulerService } from './monitor-scheduler.service.js';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [MonitorsController],
  providers: [
    MonitorsService,
    HttpCheckService,
    CheckCoordinatorService,
    MonitorSchedulerService,
  ],
})
export class MonitorsModule {}
