import { Injectable, Logger } from '@nestjs/common';
import { Prisma, NotificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

const BATCH_SIZE = 5;

const RETRY_DELAYS_MINUTES = [1, 5, 15, 30];

export interface ClaimedNotification {
  id: string;
  type: string;
  recipient: string;
  payload: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
  processingStartedAt: Date;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Claim up to 5 notifications that are ready for delivery.
   *
   * FOR UPDATE SKIP LOCKED prevents concurrent processors from claiming
   * the same notification.
   *
   * The claim transaction commits before email delivery begins.
   */
  async claimPendingNotifications(): Promise<ClaimedNotification[]> {
    return this.prisma.$transaction(async (tx) => {
      // Notifications that exhausted their attempts while processing
      // are permanently failed instead of being reclaimed.
      await tx.$executeRaw`
        UPDATE "Notification"
        SET
          "status" = 'FAILED'::"NotificationStatus",
          "processingStartedAt" = NULL,
          "lastError" = COALESCE(
            "lastError",
            'Processing lease expired after maximum attempts'
          ),
          "updatedAt" = NOW()
        WHERE
          "status" = 'PROCESSING'::"NotificationStatus"
          AND "processingStartedAt" <= NOW() - INTERVAL '10 minutes'
          AND "attempts" >= "maxAttempts"
      `;

      const notifications = await tx.$queryRaw<ClaimedNotification[]>`
        WITH candidates AS (
          SELECT "id"
          FROM "Notification"
          WHERE
            "attempts" < "maxAttempts"
            AND (
              (
                "status" = 'PENDING'::"NotificationStatus"
                AND "nextAttemptAt" <= NOW()
              )
              OR
              (
                "status" = 'PROCESSING'::"NotificationStatus"
                AND "processingStartedAt" <= NOW() - INTERVAL '10 minutes'
              )
            )
          ORDER BY "nextAttemptAt" ASC, "createdAt" ASC
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "Notification" AS n
        SET
          "status" = 'PROCESSING'::"NotificationStatus",
          "attempts" = n."attempts" + 1,
          "processingStartedAt" = NOW(),
          "updatedAt" = NOW()
        FROM candidates
        WHERE n."id" = candidates."id"
        RETURNING
          n."id",
          n."type"::text AS "type",
          n."recipient",
          n."payload",
          n."attempts",
          n."maxAttempts",
          n."processingStartedAt"
      `;

      return notifications;
    });
  }

  /**
   * Mark a notification as successfully delivered.
   *
   * The processing timestamp acts as a lease identifier.
   * An older worker cannot overwrite a newer worker's result.
   */
  async markAsSent(
    id: string,
    attempts: number,
    processingStartedAt: Date,
  ): Promise<void> {
    const result = await this.prisma.notification.updateMany({
      where: {
        id,
        status: NotificationStatus.PROCESSING,
        attempts,
        processingStartedAt,
      },
      data: {
        status: NotificationStatus.SENT,
        sentAt: new Date(),
        processingStartedAt: null,
        lastError: null,
      },
    });

    if (result.count === 0) {
      this.logger.warn(
        `Notification ${id} was not marked SENT because its processing lease changed.`,
      );
    }
  }

  /**
   * Record a failed delivery and schedule the next attempt.
   */
  async markAsFailed(
    id: string,
    attempts: number,
    maxAttempts: number,
    processingStartedAt: Date,
    error: unknown,
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    const truncatedError = errorMessage.slice(0, 4000);

    if (attempts >= maxAttempts) {
      await this.prisma.notification.updateMany({
        where: {
          id,
          status: NotificationStatus.PROCESSING,
          attempts,
          processingStartedAt,
        },
        data: {
          status: NotificationStatus.FAILED,
          processingStartedAt: null,
          lastError: truncatedError,
        },
      });

      return;
    }

    const delayMinutes = RETRY_DELAYS_MINUTES[attempts - 1];

    if (delayMinutes === undefined) {
      throw new Error(`No retry delay configured for attempt ${attempts}`);
    }

    await this.prisma.notification.updateMany({
      where: {
        id,
        status: NotificationStatus.PROCESSING,
        attempts,
        processingStartedAt,
      },
      data: {
        status: NotificationStatus.PENDING,
        processingStartedAt: null,
        nextAttemptAt: new Date(Date.now() + delayMinutes * 60_000),
        lastError: truncatedError,
      },
    });
  }
}
