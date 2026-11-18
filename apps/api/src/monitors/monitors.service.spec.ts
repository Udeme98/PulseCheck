import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  CheckStatus,
  MonitorHealthStatus,
  MonitorStatus,
} from '@prisma/client';
import { HttpCheckService } from './http-check.service.js';
import { MonitorsService } from './monitors.service.js';
import { CheckCoordinatorService } from './check-coordinator.service.js';
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
    nextCheckAt: null as Date | null,
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
      updateManyAndReturn: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    checkResult: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    incident: {
      createMany: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    // The callback form of $transaction (used by executeCheck and update)
    // calls the supplied function with a tx object that exposes the same
    // operations.
    $transaction: vi.fn(
      async (
        cbOrOps: ((tx: unknown) => Promise<unknown>) | Promise<unknown>[],
      ) => {
        if (typeof cbOrOps === 'function') {
          // Callback-form: build a minimal tx object and invoke the callback.
          const tx = {
            monitor: {
              updateManyAndReturn: mockPrisma.monitor.updateManyAndReturn,
            },
            checkResult: { create: mockPrisma.checkResult.create },
            incident: {
              createMany: mockPrisma.incident.createMany,
              updateMany: mockPrisma.incident.updateMany,
            },
            $executeRaw: mockPrisma.$executeRaw,
            $queryRaw: mockPrisma.$queryRaw,
          };
          return cbOrOps(tx);
        }
        // Array-form (not currently used, kept for safety).
        return Promise.all(cbOrOps);
      },
    ),
    // Tracks $executeRaw calls issued inside the callback transaction.
    $executeRaw: vi.fn().mockResolvedValue(1),
    // Used by the interval-change path of update() inside a transaction.
    $queryRaw: vi.fn(),
  };

  /**
   * Reconstructs the SQL and bound values from a $executeRaw tagged-template
   * call. When the service calls:
   *   tx.$executeRaw`UPDATE ... SET x = ${val}`
   * the mock receives:
   *   args[0] = TemplateStringsArray  (the SQL fragments)
   *   args[1..n] = the interpolated values
   * This helper joins the fragments with '?' placeholders and returns the
   * values in order, matching what Prisma would send to the driver.
   */
  function getExecuteRawCall() {
    const [strings, ...values] = mockPrisma.$executeRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];

    return {
      sql: strings.join('?'),
      values,
    };
  }

  const mockHttpCheck = {
    check: vi.fn(),
  };

  // Real coordinator — we test with the actual implementation so dedup
  // behaviour is verified end-to-end through the service.
  let coordinator: CheckCoordinatorService;

  beforeEach(async () => {
    vi.clearAllMocks();

    coordinator = new CheckCoordinatorService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonitorsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: HttpCheckService, useValue: mockHttpCheck },
        { provide: CheckCoordinatorService, useValue: coordinator },
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

      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('sets nextCheckAt to now on creation so the monitor is immediately due', async () => {
      const before = Date.now();
      mockPrisma.monitor.create.mockResolvedValue(makeMonitor());

      await service.create(
        { name: 'Test', url: 'https://example.com' },
        'user-1',
      );

      const after = Date.now();

      const callData = mockPrisma.monitor.create.mock.calls[0][0].data as {
        nextCheckAt: Date;
      };
      const nextCheckAtMs = callData.nextCheckAt.getTime();
      expect(nextCheckAtMs).toBeGreaterThanOrEqual(before);
      expect(nextCheckAtMs).toBeLessThanOrEqual(after);
    });

    it('throws UnauthorizedException (not 500) when the user account no longer exists (P2003)', async () => {
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
  // update() — interval change recalculates nextCheckAt
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
      mockPrisma.monitor.updateManyAndReturn.mockResolvedValue([]);

      await expect(
        service.update('missing', 'user-1', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.monitor.findFirst).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the monitor belongs to a different user (cross-user)', async () => {
      mockPrisma.monitor.updateManyAndReturn.mockResolvedValue([]);

      await expect(
        service.update('monitor-1', 'user-B', { name: 'Hijacked' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('passes userId as part of the WHERE clause, not just the monitor id', async () => {
      mockPrisma.monitor.updateManyAndReturn.mockResolvedValue([makeMonitor()]);

      await service.update('monitor-1', 'user-1', { name: 'OK' });

      expect(mockPrisma.monitor.updateManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'monitor-1', userId: 'user-1' }),
        }),
      );
    });

    it('recalculates nextCheckAt from lastCheckedAt when intervalSeconds changes', async () => {
      const lastCheckedAt = new Date('2026-11-16T10:00:00Z');
      mockPrisma.$queryRaw.mockResolvedValue([{ lastCheckedAt }]);
      mockPrisma.monitor.updateManyAndReturn.mockResolvedValue([makeMonitor()]);

      await service.update('monitor-1', 'user-1', { intervalSeconds: 600 });

      const expectedNextCheckAt = new Date(
        lastCheckedAt.getTime() + 600 * 1000,
      );

      expect(mockPrisma.monitor.updateManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            nextCheckAt: expectedNextCheckAt,
          }),
        }),
      );
    });

    it('recalculates nextCheckAt from now when intervalSeconds changes and monitor has never been checked', async () => {
      const before = Date.now();
      mockPrisma.$queryRaw.mockResolvedValue([{ lastCheckedAt: null }]);
      mockPrisma.monitor.updateManyAndReturn.mockResolvedValue([makeMonitor()]);

      await service.update('monitor-1', 'user-1', { intervalSeconds: 600 });

      const after = Date.now();

      const callData = mockPrisma.monitor.updateManyAndReturn.mock.calls[0][0]
        .data as { nextCheckAt: Date };
      const nextCheckAtMs = callData.nextCheckAt.getTime();

      // nextCheckAt should be ~600s from now
      expect(nextCheckAtMs).toBeGreaterThanOrEqual(before + 600 * 1000);
      expect(nextCheckAtMs).toBeLessThanOrEqual(after + 600 * 1000);
    });

    it('does not include nextCheckAt in the update when intervalSeconds is not changing', async () => {
      mockPrisma.monitor.updateManyAndReturn.mockResolvedValue([makeMonitor()]);

      await service.update('monitor-1', 'user-1', {
        name: 'No interval change',
      });

      // Neither the lock query nor findFirst should be called — no interval
      // recalculation needed.
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
      expect(mockPrisma.monitor.findFirst).not.toHaveBeenCalled();

      const callData = mockPrisma.monitor.updateManyAndReturn.mock.calls[0][0]
        .data as Record<string, unknown>;
      expect(callData).not.toHaveProperty('nextCheckAt');
    });

    it('throws NotFoundException when interval changes but monitor is not found in pre-check', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]); // empty rows → not found

      await expect(
        service.update('monitor-1', 'user-1', { intervalSeconds: 600 }),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.monitor.updateManyAndReturn).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // check() — health status state machine
  // -------------------------------------------------------------------------
  describe('check()', () => {
    // -----------------------------------------------------------------------
    // Scenario 1 – first consecutive failure
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

      const result = await service.check('monitor-1', 'user-1');

      expect(result.status).toBe(CheckStatus.DOWN);

      // The monitor update is now done via $executeRaw inside the transaction.
      // Verify the bound values carry the correct state-machine output.
      expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
      const { values } = getExecuteRawCall();
      // values order: checkedAt, consecutiveFailures, healthStatus, checkedAt, id
      expect(values[1]).toBe(1); // consecutiveFailures
      expect(values[2]).toBe(MonitorHealthStatus.UP); // healthStatus unchanged
      expect(mockPrisma.incident.createMany).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Scenario 2 – second consecutive failure
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

      await service.check('monitor-1', 'user-1');

      expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
      const { values } = getExecuteRawCall();
      expect(values[1]).toBe(2); // consecutiveFailures
      expect(values[2]).toBe(MonitorHealthStatus.DOWN); // healthStatus flips
      expect(mockPrisma.incident.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            monitorId: 'monitor-1',
            startedAt: expect.any(Date),
          }),
        ],
        skipDuplicates: true,
      });
    });

    // -----------------------------------------------------------------------
    // Scenario 3 – further consecutive failures
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

      await service.check('monitor-1', 'user-1');

      expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
      const { values } = getExecuteRawCall();
      expect(values[1]).toBe(3); // consecutiveFailures
      expect(values[2]).toBe(MonitorHealthStatus.DOWN); // health stays DOWN
      expect(mockPrisma.incident.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            monitorId: 'monitor-1',
            startedAt: expect.any(Date),
          }),
        ],
        skipDuplicates: true,
      });
    });

    // -----------------------------------------------------------------------
    // Scenario 4 – recovery after failures
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

      const result = await service.check('monitor-1', 'user-1');

      expect(result.status).toBe(CheckStatus.UP);

      expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
      const { values } = getExecuteRawCall();
      expect(values[1]).toBe(0); // consecutiveFailures reset
      expect(values[2]).toBe(MonitorHealthStatus.UP); // health → UP
      expect(mockPrisma.incident.updateMany).toHaveBeenCalledWith({
        where: { monitorId: 'monitor-1', resolvedAt: null },
        data: { resolvedAt: expect.any(Date) },
      });
    });

    // -----------------------------------------------------------------------
    // Scenario 5 – first-ever failure (health is UNKNOWN)
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

      await service.check('monitor-1', 'user-1');

      expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
      const { values } = getExecuteRawCall();
      expect(values[1]).toBe(1); // consecutiveFailures
      expect(values[2]).toBe(MonitorHealthStatus.UNKNOWN); // health stays UNKNOWN
      expect(mockPrisma.incident.createMany).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Scenario 6 – already healthy check passes
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

      const result = await service.check('monitor-1', 'user-1');

      expect(result.status).toBe(CheckStatus.UP);

      expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
      const { values } = getExecuteRawCall();
      expect(values[1]).toBe(0); // consecutiveFailures
      expect(values[2]).toBe(MonitorHealthStatus.UP); // health stays UP
      expect(mockPrisma.incident.updateMany).toHaveBeenCalledWith({
        where: { monitorId: 'monitor-1', resolvedAt: null },
        data: { resolvedAt: expect.any(Date) },
      });
    });

    it('succeeds when an UP check has no open incident to resolve', async () => {
      const monitor = makeMonitor();
      mockPrisma.monitor.findFirst.mockResolvedValue(monitor);
      mockHttpCheck.check.mockResolvedValue({
        url: monitor.url,
        status: 'UP',
        statusCode: 200,
        responseTimeMs: 20,
        errorMessage: null,
      });
      mockPrisma.checkResult.create.mockResolvedValue(makeCheckResult());
      mockPrisma.incident.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.check('monitor-1', 'user-1')).resolves.toMatchObject(
        { status: CheckStatus.UP },
      );

      expect(mockPrisma.incident.updateMany).toHaveBeenCalledOnce();
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
    // nextCheckAt is advanced after every check (success and failure).
    // The value is computed by the DB using the current intervalSeconds column,
    // so we verify that $executeRaw is called (not monitor.update) and that
    // the SQL expression references the column directly — not a bound value.
    // -----------------------------------------------------------------------
    it('uses $executeRaw (not monitor.update) to advance nextCheckAt after a successful check', async () => {
      const monitor = makeMonitor({ intervalSeconds: 300 });
      mockPrisma.monitor.findFirst.mockResolvedValue(monitor);
      mockHttpCheck.check.mockResolvedValue({
        url: monitor.url,
        status: 'UP',
        statusCode: 200,
        responseTimeMs: 22,
        errorMessage: null,
      });
      mockPrisma.checkResult.create.mockResolvedValue(makeCheckResult());

      await service.check('monitor-1', 'user-1');

      // The new code uses $executeRaw; monitor.update must NOT be called.
      expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
      // The SQL expression must reference the intervalSeconds column directly
      // (not pass the interval as a bound parameter).
      const { sql } = getExecuteRawCall();
      expect(sql).toMatch(/"intervalSeconds"/);
      expect(sql).toMatch(/INTERVAL/);
    });

    it('uses $executeRaw to advance nextCheckAt after a failed check', async () => {
      const monitor = makeMonitor({
        intervalSeconds: 300,
        consecutiveFailures: 0,
      });
      mockPrisma.monitor.findFirst.mockResolvedValue(monitor);
      mockHttpCheck.check.mockResolvedValue({
        url: monitor.url,
        status: 'DOWN',
        statusCode: 500,
        responseTimeMs: 10000,
        errorMessage: 'Server Error',
      });
      mockPrisma.checkResult.create.mockResolvedValue(
        makeCheckResult({ status: CheckStatus.DOWN }),
      );

      await service.check('monitor-1', 'user-1');

      expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
      const { sql } = getExecuteRawCall();
      expect(sql).toMatch(/"intervalSeconds"/);
      expect(sql).toMatch(/INTERVAL/);
    });

    // -----------------------------------------------------------------------
    // Interval-race regression: an interval update during an in-flight check
    // must not cause the stale interval to overwrite the new nextCheckAt.
    //
    // The fix: nextCheckAt is computed by the DB from the row's current
    // intervalSeconds column inside the transaction, not from the value
    // captured at dispatch time. The parameter intervalSeconds is no longer
    // passed to executeCheck at all.
    //
    // We verify this by confirming that executeCheck does NOT accept an
    // intervalSeconds parameter — if the wrong interval could be passed, it
    // would appear in the $executeRaw bound values as a numeric literal.
    // Instead, the SQL must use the column expression "intervalSeconds" * INTERVAL.
    // -----------------------------------------------------------------------
    it('interval-race regression: nextCheckAt is derived from the DB column, not a captured parameter', async () => {
      // Arrange: monitor was created with 300s interval.
      const monitor = makeMonitor({ intervalSeconds: 300 });
      mockPrisma.monitor.findFirst.mockResolvedValue(monitor);
      mockHttpCheck.check.mockResolvedValue({
        url: monitor.url,
        status: 'UP',
        statusCode: 200,
        responseTimeMs: 10,
        errorMessage: null,
      });
      mockPrisma.checkResult.create.mockResolvedValue(makeCheckResult());

      // Act: run the check. Imagine the PATCH changing intervalSeconds to
      // 600s arrives and commits while the HTTP request is in flight.
      // Because executeCheck no longer receives intervalSeconds as a parameter,
      // there is no stale captured value that could be used. The DB expression
      // always reads the committed value at transaction time.
      await service.check('monitor-1', 'user-1');

      // Assert: the SQL expression references the column, not a bound numeric.
      const { sql, values } = getExecuteRawCall();

      // The column-expression form must be in the SQL.
      expect(sql).toMatch(/"intervalSeconds" \* INTERVAL/);

      // No value in the bound parameters should be a plain integer representing
      // an interval duration (300 or 600). The only numeric bound value is
      // consecutiveFailures (0 for a successful UP check).
      const numericValues = values.filter((v) => typeof v === 'number');
      expect(numericValues).toEqual([0]); // only consecutiveFailures
    });

    // -----------------------------------------------------------------------
    // Verify that both a CheckResult and a monitor update are always persisted
    // inside the same transaction.
    // -----------------------------------------------------------------------
    it('persists checkResult and $executeRaw monitor update together in a single transaction', async () => {
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

      await service.check('monitor-1', 'user-1');

      // $transaction must be called exactly once.
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      // Both write operations must have been invoked.
      expect(mockPrisma.checkResult.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('persists incident creation in the same transaction as the check and monitor update', async () => {
      const monitor = makeMonitor({ consecutiveFailures: 1 });
      mockPrisma.monitor.findFirst.mockResolvedValue(monitor);
      mockHttpCheck.check.mockResolvedValue({
        url: monitor.url,
        status: 'DOWN',
        statusCode: 503,
        responseTimeMs: 30,
        errorMessage: 'Service Unavailable',
      });
      mockPrisma.checkResult.create.mockResolvedValue(
        makeCheckResult({ status: CheckStatus.DOWN }),
      );

      await service.check('monitor-1', 'user-1');

      expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
      expect(mockPrisma.checkResult.create).toHaveBeenCalledOnce();
      expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
      expect(mockPrisma.incident.createMany).toHaveBeenCalledOnce();
    });

    // -----------------------------------------------------------------------
    // Deduplication: two simultaneous check() calls for the same monitor
    // produce only one HTTP request.
    // -----------------------------------------------------------------------
    it('two simultaneous check() calls for the same monitor produce only one HTTP request', async () => {
      const monitor = makeMonitor();

      // Both ownership checks will succeed.
      mockPrisma.monitor.findFirst.mockResolvedValue(monitor);

      // The HTTP check is slow so both callers arrive before it finishes.
      let resolveHttp!: (v: unknown) => void;
      const httpPromise = new Promise((res) => {
        resolveHttp = res;
      });
      mockHttpCheck.check.mockReturnValue(httpPromise);

      const checkResult = makeCheckResult();
      mockPrisma.checkResult.create.mockResolvedValue(checkResult);

      // Start both calls concurrently before resolving the HTTP mock.
      const p1 = service.check('monitor-1', 'user-1');
      const p2 = service.check('monitor-1', 'user-1');

      // Resolve the HTTP promise.
      resolveHttp({
        url: monitor.url,
        status: 'UP',
        statusCode: 200,
        responseTimeMs: 10,
        errorMessage: null,
      });

      await Promise.all([p1, p2]);

      // The HTTP check must have been called only once.
      expect(mockHttpCheck.check).toHaveBeenCalledTimes(1);
      // The DB write must have happened only once.
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('ownership check still runs for every caller even when deduplicated', async () => {
      const monitor = makeMonitor();
      mockPrisma.monitor.findFirst.mockResolvedValue(monitor);

      let resolveHttp!: (v: unknown) => void;
      const httpPromise = new Promise((res) => {
        resolveHttp = res;
      });
      mockHttpCheck.check.mockReturnValue(httpPromise);

      mockPrisma.checkResult.create.mockResolvedValue(makeCheckResult());

      const p1 = service.check('monitor-1', 'user-1');
      const p2 = service.check('monitor-1', 'user-1');

      resolveHttp({
        url: monitor.url,
        status: 'UP',
        statusCode: 200,
        responseTimeMs: 5,
        errorMessage: null,
      });

      await Promise.all([p1, p2]);

      // Two ownership checks (one per caller) plus one shared execution reload.
      expect(mockPrisma.monitor.findFirst).toHaveBeenCalledTimes(3);
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
  // Cross-user access prevention
  // -------------------------------------------------------------------------
  describe('cross-user access prevention', () => {
    it("getCheckHistory() prevents user B from reading user A's history", async () => {
      mockPrisma.monitor.findFirst.mockResolvedValue(null);

      await expect(
        service.getCheckHistory('monitor-1', 'user-B'),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.checkResult.findMany).not.toHaveBeenCalled();
    });

    it("getIncidents() prevents user B from reading user A's incidents", async () => {
      mockPrisma.monitor.findFirst.mockResolvedValue(null);

      await expect(service.getIncidents('monitor-1', 'user-B')).rejects.toThrow(
        NotFoundException,
      );

      expect(mockPrisma.incident.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getIncidents()', () => {
    it('returns monitor incidents in descending startedAt order', async () => {
      mockPrisma.monitor.findFirst.mockResolvedValue(makeMonitor());
      mockPrisma.incident.findMany.mockResolvedValue([]);

      await service.getIncidents('monitor-1', 'user-1');

      expect(mockPrisma.incident.findMany).toHaveBeenCalledWith({
        where: { monitorId: 'monitor-1' },
        orderBy: { startedAt: 'desc' },
      });
    });
  });
});
