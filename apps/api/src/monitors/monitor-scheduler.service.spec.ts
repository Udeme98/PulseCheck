/**
 * Unit tests for MonitorSchedulerService.
 *
 * Tests verify:
 *   - Only due monitors are processed.
 *   - Concurrency cap is enforced.
 *   - One failure does not stop other monitors.
 *   - Deduplication is delegated to MonitorsService.checkIfDue().
 *   - Sequential scheduler ticks complete safely.
 */

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { MonitorHealthStatus, MonitorStatus } from '@prisma/client';
import { CheckCoordinatorService } from './check-coordinator.service.js';
import { MonitorSchedulerService } from './monitor-scheduler.service.js';
import { MonitorsService } from './monitors.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMonitorRow(
  overrides: Partial<{
    id: string;
    userId: string;
    url: string;
    intervalSeconds: number;
    consecutiveFailures: number;
    healthStatus: MonitorHealthStatus;
    status: MonitorStatus;
    nextCheckAt: Date | null;
  }> = {},
) {
  return {
    id: 'monitor-1',
    userId: 'user-1',
    url: 'https://example.com',
    intervalSeconds: 300,
    consecutiveFailures: 0,
    healthStatus: MonitorHealthStatus.UP,
    status: MonitorStatus.ACTIVE,
    nextCheckAt: new Date(Date.now() - 1000),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('MonitorSchedulerService', () => {
  let scheduler: MonitorSchedulerService;
  let coordinator: CheckCoordinatorService;

  const mockPrisma = {
    monitor: {
      findMany: vi.fn(),
    },
  };

  const mockMonitorsService = {
    checkIfDue: vi.fn(),
  };

  function buildModule(concurrency?: string) {
    const configValues: Record<string, string> = {};

    if (concurrency !== undefined) {
      configValues['MONITOR_CHECK_CONCURRENCY'] = concurrency;
    }

    return Test.createTestingModule({
      providers: [
        MonitorSchedulerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MonitorsService, useValue: mockMonitorsService },
        { provide: CheckCoordinatorService, useValue: coordinator },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => configValues[key],
          },
        },
      ],
    }).compile();
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    coordinator = new CheckCoordinatorService();

    mockMonitorsService.checkIfDue.mockResolvedValue(undefined);

    const module: TestingModule = await buildModule();
    scheduler = module.get<MonitorSchedulerService>(MonitorSchedulerService);
  });

  // -------------------------------------------------------------------------
  // Due-monitor filtering
  // -------------------------------------------------------------------------

  describe('due-monitor filtering', () => {
    it('calls checkIfDue for every monitor returned by the due query', async () => {
      const m1 = makeMonitorRow({ id: 'monitor-1' });
      const m2 = makeMonitorRow({ id: 'monitor-2' });

      mockPrisma.monitor.findMany.mockResolvedValue([m1, m2]);

      await scheduler.checkDueMonitors();

      expect(mockMonitorsService.checkIfDue).toHaveBeenCalledTimes(2);
      expect(mockMonitorsService.checkIfDue).toHaveBeenNthCalledWith(
        1,
        'monitor-1',
      );
      expect(mockMonitorsService.checkIfDue).toHaveBeenNthCalledWith(
        2,
        'monitor-2',
      );
    });

    it('does nothing when no monitors are due', async () => {
      mockPrisma.monitor.findMany.mockResolvedValue([]);

      await scheduler.checkDueMonitors();

      expect(mockMonitorsService.checkIfDue).not.toHaveBeenCalled();
    });

    it('passes only the monitor ID to checkIfDue', async () => {
      const monitor = makeMonitorRow({
        id: 'monitor-42',
        url: 'https://target.example.com',
        intervalSeconds: 600,
        consecutiveFailures: 1,
        healthStatus: MonitorHealthStatus.DOWN,
      });

      mockPrisma.monitor.findMany.mockResolvedValue([monitor]);

      await scheduler.checkDueMonitors();

      expect(mockMonitorsService.checkIfDue).toHaveBeenCalledWith('monitor-42');
    });

    it('queries only ACTIVE monitors with nextCheckAt <= now', async () => {
      mockPrisma.monitor.findMany.mockResolvedValue([]);

      await scheduler.checkDueMonitors();

      const whereClause = mockPrisma.monitor.findMany.mock.calls[0][0]
        .where as {
        status: string;
        nextCheckAt: { lte: Date };
      };

      expect(whereClause.status).toBe('ACTIVE');
      expect(whereClause.nextCheckAt).toHaveProperty('lte');
      expect(whereClause.nextCheckAt.lte).toBeInstanceOf(Date);
    });
  });

  // -------------------------------------------------------------------------
  // Concurrency cap
  // -------------------------------------------------------------------------

  describe('concurrency cap', () => {
    it('defaults to 10 when MONITOR_CHECK_CONCURRENCY is not set', async () => {
      const module = await buildModule();
      const sched = module.get<MonitorSchedulerService>(
        MonitorSchedulerService,
      );

      const monitors = Array.from({ length: 11 }, (_, i) =>
        makeMonitorRow({ id: `monitor-${i}` }),
      );

      mockPrisma.monitor.findMany.mockResolvedValue(monitors);

      let peak = 0;
      let running = 0;

      mockMonitorsService.checkIfDue.mockImplementation(async () => {
        running += 1;
        peak = Math.max(peak, running);

        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        running -= 1;
      });

      await sched.checkDueMonitors();

      expect(peak).toBeLessThanOrEqual(10);
      expect(mockMonitorsService.checkIfDue).toHaveBeenCalledTimes(11);
    });

    it('respects a custom MONITOR_CHECK_CONCURRENCY of 3', async () => {
      const module = await buildModule('3');
      const sched = module.get<MonitorSchedulerService>(
        MonitorSchedulerService,
      );

      const monitors = Array.from({ length: 9 }, (_, i) =>
        makeMonitorRow({ id: `monitor-${i}` }),
      );

      mockPrisma.monitor.findMany.mockResolvedValue(monitors);

      let peak = 0;
      let running = 0;

      mockMonitorsService.checkIfDue.mockImplementation(async () => {
        running += 1;
        peak = Math.max(peak, running);

        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        running -= 1;
      });

      await sched.checkDueMonitors();

      expect(peak).toBeLessThanOrEqual(3);
      expect(peak).toBe(3);
      expect(mockMonitorsService.checkIfDue).toHaveBeenCalledTimes(9);
    });

    it('falls back to 10 when MONITOR_CHECK_CONCURRENCY is non-numeric', async () => {
      const module = await buildModule('banana');
      const sched = module.get<MonitorSchedulerService>(
        MonitorSchedulerService,
      );

      const monitors = Array.from({ length: 11 }, (_, i) =>
        makeMonitorRow({ id: `monitor-${i}` }),
      );

      mockPrisma.monitor.findMany.mockResolvedValue(monitors);

      let peak = 0;
      let running = 0;

      mockMonitorsService.checkIfDue.mockImplementation(async () => {
        running += 1;
        peak = Math.max(peak, running);

        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        running -= 1;
      });

      await sched.checkDueMonitors();

      expect(peak).toBeLessThanOrEqual(10);
    });

    it('falls back to 10 when MONITOR_CHECK_CONCURRENCY is zero', async () => {
      const module = await buildModule('0');
      const sched = module.get<MonitorSchedulerService>(
        MonitorSchedulerService,
      );

      const monitors = Array.from({ length: 11 }, (_, i) =>
        makeMonitorRow({ id: `monitor-${i}` }),
      );

      mockPrisma.monitor.findMany.mockResolvedValue(monitors);

      let peak = 0;
      let running = 0;

      mockMonitorsService.checkIfDue.mockImplementation(async () => {
        running += 1;
        peak = Math.max(peak, running);

        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        running -= 1;
      });

      await sched.checkDueMonitors();

      expect(peak).toBeLessThanOrEqual(10);
    });
  });

  // -------------------------------------------------------------------------
  // Failure isolation
  // -------------------------------------------------------------------------

  describe('failure isolation', () => {
    it('continues processing remaining monitors after one fails', async () => {
      const monitors = [
        makeMonitorRow({ id: 'fail-monitor' }),
        makeMonitorRow({ id: 'ok-monitor' }),
      ];

      mockPrisma.monitor.findMany.mockResolvedValue(monitors);

      mockMonitorsService.checkIfDue
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce(undefined);

      await scheduler.checkDueMonitors();

      expect(mockMonitorsService.checkIfDue).toHaveBeenCalledTimes(2);
      expect(mockMonitorsService.checkIfDue).toHaveBeenNthCalledWith(
        1,
        'fail-monitor',
      );
      expect(mockMonitorsService.checkIfDue).toHaveBeenNthCalledWith(
        2,
        'ok-monitor',
      );
    });

    it('processes all monitors when every check fails', async () => {
      const monitors = Array.from({ length: 5 }, (_, i) =>
        makeMonitorRow({ id: `monitor-${i}` }),
      );

      mockPrisma.monitor.findMany.mockResolvedValue(monitors);
      mockMonitorsService.checkIfDue.mockRejectedValue(new Error('fail'));

      await expect(scheduler.checkDueMonitors()).resolves.not.toThrow();

      expect(mockMonitorsService.checkIfDue).toHaveBeenCalledTimes(5);
    });
  });

  // -------------------------------------------------------------------------
  // Deduplication via MonitorsService and CheckCoordinatorService
  // -------------------------------------------------------------------------

  describe('deduplication', () => {
    it('does not duplicate a check already in flight', async () => {
      const monitor = makeMonitorRow({ id: 'monitor-1' });

      mockPrisma.monitor.findMany.mockResolvedValue([monitor]);

      let resolveWork!: (value: unknown) => void;

      const sharedWork = new Promise((resolve) => {
        resolveWork = resolve;
      });

      let workCalls = 0;

      const inFlightPromise = coordinator.run('monitor-1', () => {
        workCalls += 1;
        return sharedWork;
      });

      mockMonitorsService.checkIfDue.mockImplementation((id: string) =>
        coordinator.run(id, async () => {
          workCalls += 1;
        }),
      );

      const tickPromise = scheduler.checkDueMonitors();

      // Allow the scheduler to reach checkIfDue before resolving the
      // already-running check.
      await Promise.resolve();
      await Promise.resolve();

      resolveWork({});

      await Promise.all([tickPromise, inFlightPromise]);

      expect(mockMonitorsService.checkIfDue).toHaveBeenCalledWith('monitor-1');
      expect(workCalls).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // waitForCompletion configuration
  // -------------------------------------------------------------------------

  describe('overlap prevention configuration', () => {
    it('does not throw when called twice sequentially', async () => {
      mockPrisma.monitor.findMany.mockResolvedValue([]);

      await scheduler.checkDueMonitors();
      await scheduler.checkDueMonitors();
    });
  });
});
