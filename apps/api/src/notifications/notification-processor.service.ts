import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { EmailService } from './email.service.js';
import { NotificationsService } from './notifications.service.js';
import {
  incidentOpenedTemplate,
  incidentResolvedTemplate,
} from './notification-templates.js';

@Injectable()
export class NotificationProcessorService {
  private readonly logger = new Logger(NotificationProcessorService.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Process pending notifications every 10 seconds.
   *
   * waitForCompletion prevents overlapping executions
   * within the same application instance.
   */
  @Cron(CronExpression.EVERY_10_SECONDS, {
    waitForCompletion: true,
  })
  async processPendingNotifications(): Promise<void> {
    const notifications =
      await this.notificationsService.claimPendingNotifications();

    if (notifications.length === 0) {
      return;
    }

    this.logger.log(`Processing ${notifications.length} notification(s).`);

    await Promise.all(
      notifications.map(async (notification) => {
        try {
          const template = this.buildTemplate(
            notification.type,
            notification.payload,
          );

          await this.emailService.sendMail(
            notification.recipient,
            template.subject,
            template.html,
            template.text,
          );

          await this.notificationsService.markAsSent(
            notification.id,
            notification.attempts,
            notification.processingStartedAt,
          );

          this.logger.log(`Notification ${notification.id} sent successfully.`);
        } catch (error) {
          this.logger.error(
            `Failed to process notification ${notification.id}.`,
            error instanceof Error ? error.stack : String(error),
          );

          try {
            await this.notificationsService.markAsFailed(
              notification.id,
              notification.attempts,
              notification.maxAttempts,
              notification.processingStartedAt,
              error,
            );
          } catch (updateError) {
            this.logger.error(
              `Could not update failed notification ${notification.id}.`,
              updateError instanceof Error
                ? updateError.stack
                : String(updateError),
            );
          }
        }
      }),
    );
  }

  private buildTemplate(
    type: string,
    payload: Prisma.JsonValue,
  ): { subject: string; html: string; text: string } {
    const data = this.readPayload(payload);

    switch (type) {
      case 'INCIDENT_OPENED': {
        const eventTime = data.incidentStartedAt;

        if (!eventTime || Number.isNaN(Date.parse(eventTime))) {
          throw new Error('Invalid or missing incident start time.');
        }

        return incidentOpenedTemplate({
          monitorName: data.monitorName,
          monitorUrl: data.monitorUrl,
          eventTime,
        });
      }

      case 'INCIDENT_RESOLVED': {
        const eventTime = data.incidentResolvedAt;

        if (!eventTime || Number.isNaN(Date.parse(eventTime))) {
          throw new Error('Invalid or missing incident resolution time.');
        }

        return incidentResolvedTemplate({
          monitorName: data.monitorName,
          monitorUrl: data.monitorUrl,
          eventTime,
        });
      }

      default:
        throw new Error(`Unsupported notification type: ${type}`);
    }
  }

  private readPayload(payload: Prisma.JsonValue): Record<string, string> {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload)
    ) {
      throw new Error('Notification payload must be a JSON object.');
    }

    const requiredFields = [
      'monitorName',
      'monitorUrl',
      'incidentStartedAt',
      'incidentResolvedAt',
    ];

    const data: Record<string, string> = {};

    for (const field of requiredFields) {
      const value = payload[field];

      if (value !== undefined && typeof value !== 'string') {
        throw new Error(`Invalid notification payload field: ${field}`);
      }

      if (typeof value === 'string') {
        data[field] = value;
      }
    }

    if (!data.monitorName || !data.monitorUrl) {
      throw new Error('Notification payload is missing monitor details.');
    }

    return data;
  }
}
