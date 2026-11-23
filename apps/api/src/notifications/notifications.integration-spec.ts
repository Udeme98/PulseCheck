import {
  PrismaClient,
  NotificationStatus,
  NotificationType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NotificationsService } from './notifications.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL must be set to run integration tests.');
}

const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');

if (databaseName !== 'pulsecheck_test') {
  throw new Error(
    `Integration tests must use pulsecheck_test, not "${databaseName}".`,
  );
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl,
    },
  },
});

const notificationsService = new NotificationsService(
  prisma as unknown as PrismaService,
);

async function createNotification(
  overrides: {
    status?: NotificationStatus;
    attempts?: number;
    maxAttempts?: number;
    processingStartedAt?: Date | null;
  } = {},
) {
  return prisma.notification.create({
    data: {
      type: NotificationType.INCIDENT_OPENED,
      recipient: 'integration-test@example.com',
      payload: {
        monitorName: 'Integration test monitor',
        monitorUrl: 'https://example.com',
      },
      deduplicationKey: randomUUID(),
      ...overrides,
    },
  });
}

describe('NotificationsService integration', () => {
  beforeEach(async () => {
    await prisma.notification.deleteMany();
  });

  afterAll(async () => {
    await prisma.notification.deleteMany();
    await prisma.$disconnect();
  });

  it('claims pending notifications and increments attempts', async () => {
    const notification = await createNotification();

    const claimed = await notificationsService.claimPendingNotifications();

    expect(claimed).toHaveLength(1);
    expect(claimed[0].id).toBe(notification.id);
    expect(claimed[0].attempts).toBe(1);

    const saved = await prisma.notification.findUniqueOrThrow({
      where: { id: notification.id },
    });

    expect(saved.status).toBe(NotificationStatus.PROCESSING);
    expect(saved.attempts).toBe(1);
    expect(saved.processingStartedAt).toBeInstanceOf(Date);
  });

  it('reclaims stale processing notifications', async () => {
    const staleTime = new Date(Date.now() - 11 * 60 * 1000);

    const notification = await createNotification({
      status: NotificationStatus.PROCESSING,
      attempts: 1,
      processingStartedAt: staleTime,
    });

    const claimed = await notificationsService.claimPendingNotifications();

    expect(claimed).toHaveLength(1);
    expect(claimed[0].id).toBe(notification.id);
    expect(claimed[0].attempts).toBe(2);
  });

  it('marks stale notifications as FAILED when attempts are exhausted', async () => {
    const staleTime = new Date(Date.now() - 11 * 60 * 1000);

    const notification = await createNotification({
      status: NotificationStatus.PROCESSING,
      attempts: 5,
      maxAttempts: 5,
      processingStartedAt: staleTime,
    });

    const claimed = await notificationsService.claimPendingNotifications();

    expect(claimed).toHaveLength(0);

    const saved = await prisma.notification.findUniqueOrThrow({
      where: { id: notification.id },
    });

    expect(saved.status).toBe(NotificationStatus.FAILED);
    expect(saved.processingStartedAt).toBeNull();
  });

  it('skips notifications locked by another database transaction', async () => {
    const lockedNotification = await createNotification();
    const availableNotification = await createNotification();

    let releaseLock!: () => void;
    let signalLockAcquired!: () => void;

    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const lockAcquired = new Promise<void>((resolve) => {
      signalLockAcquired = resolve;
    });

    const lockingTransaction = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "Notification"
          WHERE "id" = ${lockedNotification.id}
          FOR UPDATE
        `;

        signalLockAcquired();
        await lockReleased;
      },
      { timeout: 10000 },
    );

    try {
      await lockAcquired;

      const claimed = await notificationsService.claimPendingNotifications();

      expect(claimed).toHaveLength(1);
      expect(claimed[0].id).toBe(availableNotification.id);
      expect(claimed.some((item) => item.id === lockedNotification.id)).toBe(
        false,
      );
    } finally {
      releaseLock();
      await lockingTransaction;
    }
  });

  it('rolls back incident and notification changes when the transaction fails', async () => {
    const user = await prisma.user.create({
      data: {
        email: `integration-${randomUUID()}@example.com`,
        passwordHash: 'integration-test-hash',
        monitors: {
          create: {
            name: 'Rollback test monitor',
            url: 'https://example.com',
            nextCheckAt: new Date(),
          },
        },
      },
      include: {
        monitors: true,
      },
    });

    const monitor = user.monitors[0];
    const deduplicationKey = randomUUID();

    try {
      await expect(
        prisma.$transaction(async (tx) => {
          const incident = await tx.incident.create({
            data: {
              monitorId: monitor.id,
            },
          });

          await tx.notification.create({
            data: {
              type: NotificationType.INCIDENT_OPENED,
              recipient: user.email,
              payload: {
                monitorName: monitor.name,
                monitorUrl: monitor.url,
              },
              incidentId: incident.id,
              deduplicationKey,
            },
          });

          await tx.monitor.update({
            where: { id: monitor.id },
            data: {
              consecutiveFailures: 2,
              healthStatus: 'DOWN',
            },
          });

          throw new Error('Simulated transaction failure');
        }),
      ).rejects.toThrow('Simulated transaction failure');

      const [incidentCount, notificationCount, savedMonitor] =
        await Promise.all([
          prisma.incident.count({
            where: { monitorId: monitor.id },
          }),
          prisma.notification.count({
            where: { deduplicationKey },
          }),
          prisma.monitor.findUniqueOrThrow({
            where: { id: monitor.id },
          }),
        ]);

      expect(incidentCount).toBe(0);
      expect(notificationCount).toBe(0);
      expect(savedMonitor.consecutiveFailures).toBe(0);
      expect(savedMonitor.healthStatus).toBe('UNKNOWN');
    } finally {
      await prisma.user.delete({
        where: { id: user.id },
      });
    }
  });
});
