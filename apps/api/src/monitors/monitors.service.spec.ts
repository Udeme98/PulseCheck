import { NotFoundException, UnauthorizedException } from '@nestjs/common';
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
    healthStatus: MonitorHealthStatus.UP as MonitorHealthStatus,
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

describe('MonitorsService', () => {
  let service: MonitorsService;

  // Typed partial mocks — only the methods actually called by MonitorsService.
  const mockPrisma = {
    user: { findUnique: vi.fn() },
    monitor: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateManyAndReturn: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
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
  // create
  // -------------------------------------------------------------------------
  describe('create()', () => {
    it('creates a monitor using the server-supplied userId, not a client field', async () => {
      const monitor = makeMonitor();
      mockPrisma.monitor.create.mockResolvedValue(monitor);

      const dto = { name: 'My Monitor', url: 'https://example.com' };
      const result = await service.create(dto, 'user-1');

      expect(mockPrisma.monitor.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'user-1' }),
      });
      expect(result).toEqual(monitor);
    });

    it('does not look up user from DB (userId comes from JWT, not body)', async () => {
      mockPrisma.monitor.create.mockResolvedValue(makeMonitor());

      await service.create(
        { name: 'Test', url: 'https://example.com' },
        'user-1',
      );

      // The old implementation queried user table; the new one should not.
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException (not 500) when the user account no longer exists (P2003)', async () => {
      // Simulate Prisma FK constraint violation: the userId in the JWT no
      // longer exists in the User table because the account was deleted.
      const { Prisma } = await import('@prisma/client');
      const fkError = new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint failed on the field: `Monitor_userId_fkey`',
        { code: 'P2003', clientVersion: '0.0.0' },
      );
      mockPrisma.monitor.create.mockRejectedValue(fkError);

      await expect(
        service.create(
          { name: 'Test', url: 'https://example.com' },
          'deleted-user',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rethrows unrelated Prisma errors from create without masking them', async () => {
      const { Prisma } = await import('@prisma/client');
      const unrelatedError = new Prisma.PrismaClientKnownRequestError(
        'Some other database error',
        { code: 'P2025', clientVersion: '0.0.0' },
      );
      mockPrisma.monitor.create.mockRejectedValue(unrelatedError);

      await expect(
        service.create({ name: 'Test', url: 'https://example.com' }, 'user-1'),
      ).rejects.toThrow(unrelatedError);
    });
  });

  // -------------------------------------------------------------------------
  // findOne — ownership enforcement
  // -------------------------------------------------------------------------
  describe('findOne()', () => {
    it('returns monitor when it belongs to the requesting user', async () => {
      const monitor = makeMonitor();
      mockPrisma.monitor.findFirst.mockResolvedValue(monitor);

      const result = await service.findOne('monitor-1', 'user-1');
      expect(result).toEqual(monitor);
    });

    it('throws NotFoundException when monitor belongs to a different user', async () => {
      // Prisma returns null when the where clause filters out the row.
      mockPrisma.monitor.findFirst.mockResolvedValue(null);

      await expect(service.findOne('monitor-1', 'other-user')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException for non-existent monitor', async () => {
      mockPrisma.monitor.findFirst.mockResolvedValue(null);

      await expect(service.findOne('nonexistent', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // check() — health status state machine
  // -------------------------------------------------------------------------
  describe('check()', () => {
    // -----------------------------------------------------------------------
    // Scenario 1 – first consecutive failure: check is DOWN, failure count → 1,
    //              health remains UP (not yet at the 2-failure threshold).
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // Scenario 2 – second consecutive failure: failure count → 2, health → DOWN.
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // Scenario 3 – further consecutive failures: health stays DOWN, count keeps
    //              incrementing.
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // Scenario 4 – recovery after failures: check is UP, health → UP, count → 0.
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // Scenario 5 – first-ever failure (health is UNKNOWN): health stays UNKNOWN,
    //              failure count becomes 1.
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // Scenario 6 – already healthy check passes: health stays UP, count stays 0.
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // Guard: check() throws NotFoundException when monitor not found.
    // -----------------------------------------------------------------------
    it('throws NotFoundException when the monitor does not exist', async () => {
      mockPrisma.monitor.findFirst.mockResolvedValue(null);

      await expect(service.check('missing-id', 'user-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Verify that both a CheckResult and a monitor update are always persisted
    // inside the same transaction.
    // -----------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // update() — atomic ownership + mutation
  // -------------------------------------------------------------------------
  describe('update()', () => {
    it('returns the updated monitor when the owner updates it', async () => {
      const updated = makeMonitor({ name: 'Renamed' });
      mockPrisma.monitor.updateManyAndReturn.mockResolvedValue([updated]);

      const result = await service.update('monitor-1', 'user-1', {
        name: 'Renamed',
      });

      expect(mockPrisma.monitor.updateManyAndReturn).toHaveBeenCalledWith({
        where: { id: 'monitor-1', userId: 'user-1' },
        data: { name: 'Renamed' },
      });
      expect(result).toEqual(updated);
    });

    it('throws NotFoundException when the monitor does not exist', async () => {
      // updateManyAndReturn returns empty array when WHERE matches nothing.
      mockPrisma.monitor.updateManyAndReturn.mockResolvedValue([]);

      await expect(
        service.update('missing', 'user-1', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);

      // No separate findFirst should be called — the check is atomic.
      expect(mockPrisma.monitor.findFirst).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the monitor belongs to a different user (cross-user)', async () => {
      // Prisma returns empty array because userId does not match.
      mockPrisma.monitor.updateManyAndReturn.mockResolvedValue([]);

      await expect(
        service.update('monitor-1', 'user-B', { name: 'Hijacked' }),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.monitor.findFirst).not.toHaveBeenCalled();

      // The attempted operation must be scoped to user-B, not an unrestricted
      // update by id alone. This proves the WHERE clause was applied.
      expect(mockPrisma.monitor.updateManyAndReturn).toHaveBeenCalledWith({
        where: { id: 'monitor-1', userId: 'user-B' },
        data: { name: 'Hijacked' },
      });
    });

    it('passes userId as part of the WHERE clause, not just the monitor id', async () => {
      mockPrisma.monitor.updateManyAndReturn.mockResolvedValue([makeMonitor()]);

      await service.update('monitor-1', 'user-1', { name: 'OK' });

      // The where must include BOTH id and userId to be atomic.
      expect(mockPrisma.monitor.updateManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'monitor-1', userId: 'user-1' }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // remove() — atomic ownership + deletion
  // -------------------------------------------------------------------------
  describe('remove()', () => {
    it('returns success message when the owner deletes it', async () => {
      mockPrisma.monitor.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.remove('monitor-1', 'user-1');

      expect(mockPrisma.monitor.deleteMany).toHaveBeenCalledWith({
        where: { id: 'monitor-1', userId: 'user-1' },
      });
      expect(result).toEqual({ message: 'Monitor deleted successfully' });
    });

    it('throws NotFoundException when the monitor does not exist', async () => {
      // deleteMany returns count 0 when WHERE matches nothing.
      mockPrisma.monitor.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.remove('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(mockPrisma.monitor.findFirst).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the monitor belongs to a different user (cross-user)', async () => {
      mockPrisma.monitor.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.remove('monitor-1', 'user-B')).rejects.toThrow(
        NotFoundException,
      );

      expect(mockPrisma.monitor.findFirst).not.toHaveBeenCalled();

      // The attempted deletion must be scoped to user-B, not an unrestricted
      // delete by id alone. This proves the WHERE clause was applied.
      expect(mockPrisma.monitor.deleteMany).toHaveBeenCalledWith({
        where: { id: 'monitor-1', userId: 'user-B' },
      });
    });

    it('passes userId as part of the WHERE clause, not just the monitor id', async () => {
      mockPrisma.monitor.deleteMany.mockResolvedValue({ count: 1 });

      await service.remove('monitor-1', 'user-1');

      expect(mockPrisma.monitor.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'monitor-1', userId: 'user-1' }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Cross-user access prevention (getCheckHistory, not covered above)
  // -------------------------------------------------------------------------
  describe('cross-user access prevention', () => {
    it("getCheckHistory() prevents user B from reading user A's history", async () => {
      mockPrisma.monitor.findFirst.mockResolvedValue(null);

      await expect(
        service.getCheckHistory('monitor-1', 'user-B'),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.checkResult.findMany).not.toHaveBeenCalled();
    });
  });
});
