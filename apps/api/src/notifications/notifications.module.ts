import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { EmailService } from './email.service.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationProcessorService } from './notification-processor.service.js';

@Module({
  imports: [PrismaModule],
  providers: [EmailService, NotificationsService, NotificationProcessorService],
})
export class NotificationsModule {}
