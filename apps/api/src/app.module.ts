import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { MonitorsModule } from './monitors/monitors.module.js';

@Module({
  imports: [PrismaModule, MonitorsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
