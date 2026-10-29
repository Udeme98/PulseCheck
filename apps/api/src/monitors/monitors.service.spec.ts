import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  CheckStatus,
  MonitorHealthStatus,
  MonitorStatus,
} from '@prisma/client';
import { HttpCheckService } from './http-check.service.js';
import { MonitorsService } from './monitors.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal Monitor row shape used across all tests. */
function makeMonitor(overrides: Partial<ReturnType<typeof baseMonitor>> = {}) {
  return { ...baseMonitor(), ...overrides };
}

function baseMonitor() {
  return {
    id: 'monitor-1',
    name: 'Test Monitor',
    url: 'https://example.com',
    intervalSeconds: 300,
    status: MonitorStatus.ACTIVE,
    healthStatus: MonitorHealthStatus.UP,
    consecutiveFailures: 0,
    lastCheckedAt: null as Date | null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    userId: 'user-1',
  };
}

/** A saved CheckResult row returned by prisma.checkResult.create. */
function makeCheckResult(overrides: Record<string, unknown> = {}) {
  return {
    id: 'result-1',
    monitorId: 'monitor-1',
    status: CheckStatus.UP,
    statusCode: 200,
    responseTimeMs: 42,
    errorMessage: null,
    checkedAt: new Date('2026-01-02'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('MonitorsService.check()', () => {
  let service: MonitorsService;

  // Typed partial mocks — only the methods actually called by MonitorsService.
  const mockPrisma = {
    user: { findUnique: vi.fn() },
    monitor: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    checkResult: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    // Prisma batch transaction: receives an array of PrismaPromise values and
    // resolves them in order. We simulate this by awaiting each element.
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  const mockHttpCheck = {
    check: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonitorsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: HttpCheckService, useValue: mockHttpCheck },
      ],
    }).compile();

    service = module.get<MonitorsService>(MonitorsService);
  });

  // -------------------------------------------------------------------------
  // Scenario 1 – first consecutive failure: check is DOWN, failure count → 1,
  //              health remains UP (not yet at the 2-failure threshold).
  // -------------------------------------------------------------------------
  it('first failure: check result is DOWN, failure count becomes 1, health stays UP', async () => {
    const monitor = makeMonitor({
      healthStatus: MonitorHealthStatus.UP,
      consecutiveFailures: 0,
    });
    mockPrisma.monitor.findFirst.mockResolvedValue(monitor);
    mockHttpCheck.check.mockResolvedValue({
      url: monitor.url,
      status: 'DOWN',
      statusCode: 503,
      responseTimeMs: 80,
      errorMessage: 'Service Unavailable',
    });

    const savedResult = makeCheckResult({
      status: CheckStatus.DOWN,
      statusCode: 503,
      errorMessage: 'Service Unavailable',
    });
    mockPrisma.checkResult.create.mockResolvedValue(savedResult);
    mockPrisma.monitor.update.mockResolvedValue({});

    const result = await service.check('monitor-1', 'user-1');

    // The returned check result must reflect DOWN.
    expect(result.status).toBe(CheckStatus.DOWN);

    // Monitor update must persist failure count = 1 and health unchanged (UP).
    expect(mockPrisma.monitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          consecutiveFailures: 1,
          healthStatus: MonitorHealthStatus.UP,
        }),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Scenario 2 – second consecutive failure: failure count → 2, health → DOWN.
  // -------------------------------------------------------------------------
  it('second failure: failure count becomes 2, health transitions to DOWN', async () => {
    const monitor = makeMonitor({
      healthStatus: MonitorHealthStatus.UP,
      consecutiveFailures: 1,
    });
    mockPrisma.monitor.findFirst.mockResolvedValue(monitor);
    mockHttpCheck.check.mockResolvedValue({
      url: monitor.url,
      status: 'DOWN',
      statusCode: 503,
      responseTimeMs: 90,
      errorMessage: 'Service Unavailable',
    });

    const savedResult = makeCheckResult({ status: CheckStatus.DOWN });
    mockPrisma.checkResult.create.mockResolvedValue(savedResult);
    mockPrisma.monitor.update.mockResolvedValue({});

    await service.check('monitor-1', 'user-1');

    expect(mockPrisma.monitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          consecutiveFailures: 2,
          healthStatus: MonitorHealthStatus.DOWN,
        }),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Scenario 3 – further consecutive failures: health stays DOWN, count keeps
  //              incrementing.
  // -------------------------------------------------------------------------
  it('third failure: health remains DOWN and failure count increments to 3', async () => {
    const monitor = makeMonitor({
      healthStatus: MonitorHealthStatus.DOWN,
      consecutiveFailures: 2,
    });
    mockPrisma.monitor.findFirst.mockResolvedValue(monitor);
    mockHttpCheck.check.mockResolvedValue({
      url: monitor.url,
      status: 'DOWN',
      statusCode: null,
      responseTimeMs: 10001,
      errorMessage: 'Timeout',
    });

    const savedResult = makeCheckResult({ status: CheckStatus.DOWN });
    mockPrisma.checkResult.create.mockResolvedValue(savedResult);
    mockPrisma.monitor.update.mockResolvedValue({});

    await service.check('monitor-1', 'user-1');

    expect(mockPrisma.monitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          consecutiveFailures: 3,
          healthStatus: MonitorHealthStatus.DOWN,
        }),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Scenario 4 – recovery after failures: check is UP, health → UP, count → 0.
  // -------------------------------------------------------------------------
  it('recovery: health transitions to UP and failure count resets to 0', async () => {
    const monitor = makeMonitor({
      healthStatus: MonitorHealthStatus.DOWN,
      consecutiveFailures: 3,
    });
    mockPrisma.monitor.findFirst.mockResolvedValue(monitor);
    mockHttpCheck.check.mockResolvedValue({
      url: monitor.url,
      status: 'UP',
      statusCode: 200,
      responseTimeMs: 45,
      errorMessage: null,
    });

    const savedResult = makeCheckResult({ status: CheckStatus.UP });
    mockPrisma.checkResult.create.mockResolvedValue(savedResult);
    mockPrisma.monitor.update.mockResolvedValue({});

    const result = await service.check('monitor-1', 'user-1');

    expect(result.status).toBe(CheckStatus.UP);

    expect(mockPrisma.monitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          consecutiveFailures: 0,
          healthStatus: MonitorHealthStatus.UP,
        }),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Scenario 5 – first-ever failure (health is UNKNOWN): health stays UNKNOWN,
  //              failure count becomes 1.
  // -------------------------------------------------------------------------
  it('first-ever failure from UNKNOWN: health stays UNKNOWN, failure count becomes 1', async () => {
    const monitor = makeMonitor({
      healthStatus: MonitorHealthStatus.UNKNOWN,
      consecutiveFailures: 0,
    });
    mockPrisma.monitor.findFirst.mockResolvedValue(monitor);
    mockHttpCheck.check.mockResolvedValue({
      url: monitor.url,
      status: 'DOWN',
      statusCode: 500,
      responseTimeMs: 55,
      errorMessage: 'Internal Server Error',
    });

    const savedResult = makeCheckResult({ status: CheckStatus.DOWN });
    mockPrisma.checkResult.create.mockResolvedValue(savedResult);
    mockPrisma.monitor.update.mockResolvedValue({});

    await service.check('monitor-1', 'user-1');

    expect(mockPrisma.monitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          consecutiveFailures: 1,
          healthStatus: MonitorHealthStatus.UNKNOWN,
        }),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Scenario 6 – already healthy check passes: health stays UP, count stays 0.
  // -------------------------------------------------------------------------
  it('healthy check: health remains UP and failure count stays 0', async () => {
    const monitor = makeMonitor({
      healthStatus: MonitorHealthStatus.UP,
      consecutiveFailures: 0,
    });
    mockPrisma.monitor.findFirst.mockResolvedValue(monitor);
    mockHttpCheck.check.mockResolvedValue({
      url: monitor.url,
      status: 'UP',
      statusCode: 200,
      responseTimeMs: 30,
      errorMessage: null,
    });

    const savedResult = makeCheckResult({ status: CheckStatus.UP });
    mockPrisma.checkResult.create.mockResolvedValue(savedResult);
    mockPrisma.monitor.update.mockResolvedValue({});

    const result = await service.check('monitor-1', 'user-1');

    expect(result.status).toBe(CheckStatus.UP);

    expect(mockPrisma.monitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          consecutiveFailures: 0,
          healthStatus: MonitorHealthStatus.UP,
        }),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Guard: check() throws NotFoundException when monitor not found.
  // -------------------------------------------------------------------------
  it('throws NotFoundException when the monitor does not exist', async () => {
    mockPrisma.monitor.findFirst.mockResolvedValue(null);

    await expect(service.check('missing-id', 'user-1')).rejects.toThrow(
      NotFoundException,
    );

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Verify that both a CheckResult and a monitor update are always persisted
  // inside the same transaction.
  // -------------------------------------------------------------------------
  it('persists checkResult and monitor update together in a single transaction', async () => {
    const monitor = makeMonitor();
    mockPrisma.monitor.findFirst.mockResolvedValue(monitor);
    mockHttpCheck.check.mockResolvedValue({
      url: monitor.url,
      status: 'UP',
      statusCode: 200,
      responseTimeMs: 22,
      errorMessage: null,
    });

    const savedResult = makeCheckResult();
    mockPrisma.checkResult.create.mockResolvedValue(savedResult);
    mockPrisma.monitor.update.mockResolvedValue({});

    await service.check('monitor-1', 'user-1');

    // $transaction must be called exactly once.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

    // Both write operations must have been invoked.
    expect(mockPrisma.checkResult.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.monitor.update).toHaveBeenCalledTimes(1);
  });
});
