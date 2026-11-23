import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from './notifications.service.js';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const prismaMock = {
    $transaction: vi.fn(),
    notification: {
      updateMany: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    service = new NotificationsService(prismaMock as unknown as PrismaService);
  });

  describe('claimPendingNotifications', () => {
    it('should claim pending notifications in a transaction', async () => {
      const claimedNotifications = [
        {
          id: 'notification-1',
          type: 'INCIDENT_OPENED',
          recipient: 'user@example.com',
          payload: {},
          attempts: 1,
          maxAttempts: 5,
          processingStartedAt: new Date(),
        },
      ];

      const transactionMock = {
        $executeRaw: vi.fn(),
        $queryRaw: vi.fn().mockResolvedValue(claimedNotifications),
      };

      prismaMock.$transaction.mockImplementation(
        async (callback: (tx: typeof transactionMock) => Promise<unknown>) =>
          callback(transactionMock),
      );

      const result = await service.claimPendingNotifications();

      expect(prismaMock.$transaction).toHaveBeenCalledOnce();
      expect(transactionMock.$executeRaw).toHaveBeenCalledOnce();
      expect(transactionMock.$queryRaw).toHaveBeenCalledOnce();
      expect(result).toEqual(claimedNotifications);
    });
  });

  describe('markAsSent', () => {
    it('should mark a notification as SENT', async () => {
      const processingStartedAt = new Date();

      prismaMock.notification.updateMany.mockResolvedValue({ count: 1 });

      await service.markAsSent('notification-1', 1, processingStartedAt);

      expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'notification-1',
          status: NotificationStatus.PROCESSING,
          attempts: 1,
          processingStartedAt,
        },
        data: {
          status: NotificationStatus.SENT,
          sentAt: expect.any(Date),
          processingStartedAt: null,
          lastError: null,
        },
      });
    });
  });

  describe('markAsFailed', () => {
    it('should schedule the first retry after one minute', async () => {
      const processingStartedAt = new Date();

      prismaMock.notification.updateMany.mockResolvedValue({ count: 1 });

      const beforeCall = Date.now();

      await service.markAsFailed(
        'notification-1',
        1,
        5,
        processingStartedAt,
        new Error('SMTP connection failed'),
      );

      const updateData = prismaMock.notification.updateMany.mock.calls[0][0];

      expect(updateData.where).toEqual({
        id: 'notification-1',
        status: NotificationStatus.PROCESSING,
        attempts: 1,
        processingStartedAt,
      });

      expect(updateData.data.status).toBe(NotificationStatus.PENDING);
      expect(updateData.data.processingStartedAt).toBeNull();
      expect(updateData.data.lastError).toBe('SMTP connection failed');

      const retryTime = updateData.data.nextAttemptAt.getTime();

      expect(retryTime).toBeGreaterThanOrEqual(beforeCall + 60_000);
      expect(retryTime).toBeLessThanOrEqual(Date.now() + 60_000);
    });

    it('should mark a notification as FAILED after its final attempt', async () => {
      const processingStartedAt = new Date();

      prismaMock.notification.updateMany.mockResolvedValue({ count: 1 });

      await service.markAsFailed(
        'notification-1',
        5,
        5,
        processingStartedAt,
        new Error('SMTP delivery failed'),
      );

      expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'notification-1',
          status: NotificationStatus.PROCESSING,
          attempts: 5,
          processingStartedAt,
        },
        data: {
          status: NotificationStatus.FAILED,
          processingStartedAt: null,
          lastError: 'SMTP delivery failed',
        },
      });
    });
  });
});
