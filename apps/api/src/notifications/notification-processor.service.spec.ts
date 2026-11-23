import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailService } from './email.service.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationProcessorService } from './notification-processor.service.js';

describe('NotificationProcessorService', () => {
  let service: NotificationProcessorService;

  const notificationsMock = {
    claimPendingNotifications: vi.fn(),
    markAsSent: vi.fn(),
    markAsFailed: vi.fn(),
  };

  const emailMock = {
    sendMail: vi.fn(),
  };

  const processingStartedAt = new Date();

  beforeEach(() => {
    vi.clearAllMocks();

    service = new NotificationProcessorService(
      notificationsMock as unknown as NotificationsService,
      emailMock as unknown as EmailService,
    );
  });

  it('should do nothing when there are no pending notifications', async () => {
    notificationsMock.claimPendingNotifications.mockResolvedValue([]);

    await service.processPendingNotifications();

    expect(emailMock.sendMail).not.toHaveBeenCalled();
    expect(notificationsMock.markAsSent).not.toHaveBeenCalled();
  });

  it('should send an incident-opened email and mark it as SENT', async () => {
    notificationsMock.claimPendingNotifications.mockResolvedValue([
      {
        id: 'notification-1',
        type: 'INCIDENT_OPENED',
        recipient: 'user@example.com',
        payload: {
          monitorName: 'Production API',
          monitorUrl: 'https://api.example.com',
          incidentStartedAt: '2026-11-23T09:00:00.000Z',
        },
        attempts: 1,
        maxAttempts: 5,
        processingStartedAt,
      },
    ]);

    emailMock.sendMail.mockResolvedValue(undefined);
    notificationsMock.markAsSent.mockResolvedValue(undefined);

    await service.processPendingNotifications();

    expect(emailMock.sendMail).toHaveBeenCalledOnce();

    const emailArguments = emailMock.sendMail.mock.calls[0];

    expect(emailArguments[0]).toBe('user@example.com');
    expect(emailArguments[1]).toContain('Production API');
    expect(emailArguments[1]).toContain('DOWN');

    expect(notificationsMock.markAsSent).toHaveBeenCalledWith(
      'notification-1',
      1,
      processingStartedAt,
    );

    expect(notificationsMock.markAsFailed).not.toHaveBeenCalled();
  });

  it('should send an incident-resolved email and mark it as SENT', async () => {
    notificationsMock.claimPendingNotifications.mockResolvedValue([
      {
        id: 'notification-2',
        type: 'INCIDENT_RESOLVED',
        recipient: 'user@example.com',
        payload: {
          monitorName: 'Production API',
          monitorUrl: 'https://api.example.com',
          incidentResolvedAt: '2026-11-23T09:30:00.000Z',
        },
        attempts: 1,
        maxAttempts: 5,
        processingStartedAt,
      },
    ]);

    emailMock.sendMail.mockResolvedValue(undefined);
    notificationsMock.markAsSent.mockResolvedValue(undefined);

    await service.processPendingNotifications();

    expect(emailMock.sendMail).toHaveBeenCalledOnce();

    const emailArguments = emailMock.sendMail.mock.calls[0];

    expect(emailArguments[0]).toBe('user@example.com');
    expect(emailArguments[1]).toContain('Production API');
    expect(emailArguments[1]).toMatch(/resolved|recovered/i);

    expect(notificationsMock.markAsSent).toHaveBeenCalledWith(
      'notification-2',
      1,
      processingStartedAt,
    );
  });

  it('should record a failure when email delivery fails', async () => {
    const deliveryError = new Error('SMTP connection failed');

    notificationsMock.claimPendingNotifications.mockResolvedValue([
      {
        id: 'notification-3',
        type: 'INCIDENT_OPENED',
        recipient: 'user@example.com',
        payload: {
          monitorName: 'Production API',
          monitorUrl: 'https://api.example.com',
          incidentStartedAt: '2026-11-23T09:00:00.000Z',
        },
        attempts: 2,
        maxAttempts: 5,
        processingStartedAt,
      },
    ]);

    emailMock.sendMail.mockRejectedValue(deliveryError);
    notificationsMock.markAsFailed.mockResolvedValue(undefined);

    await service.processPendingNotifications();

    expect(notificationsMock.markAsFailed).toHaveBeenCalledWith(
      'notification-3',
      2,
      5,
      processingStartedAt,
      deliveryError,
    );

    expect(notificationsMock.markAsSent).not.toHaveBeenCalled();
  });

  it('should process five emails concurrently', async () => {
    const notifications = Array.from({ length: 5 }, (_, index) => ({
      id: `notification-${index + 1}`,
      type: 'INCIDENT_OPENED',
      recipient: `user${index + 1}@example.com`,
      payload: {
        monitorName: `API ${index + 1}`,
        monitorUrl: `https://api${index + 1}.example.com`,
        incidentStartedAt: '2026-11-23T09:00:00.000Z',
      },
      attempts: 1,
      maxAttempts: 5,
      processingStartedAt,
    }));

    notificationsMock.claimPendingNotifications.mockResolvedValue(
      notifications,
    );

    let activeSends = 0;
    let maximumConcurrentSends = 0;

    emailMock.sendMail.mockImplementation(async () => {
      activeSends++;

      maximumConcurrentSends = Math.max(maximumConcurrentSends, activeSends);

      await new Promise((resolve) => setTimeout(resolve, 10));

      activeSends--;
    });

    notificationsMock.markAsSent.mockResolvedValue(undefined);

    await service.processPendingNotifications();

    expect(emailMock.sendMail).toHaveBeenCalledTimes(5);
    expect(maximumConcurrentSends).toBe(5);
    expect(notificationsMock.markAsSent).toHaveBeenCalledTimes(5);
  });
});
