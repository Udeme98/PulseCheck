import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(_isPublic: boolean): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({}),
    }),
    // Other ExecutionContext methods not needed for these tests.
  } as unknown as ExecutionContext;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JwtAuthGuard, Reflector],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('returns true immediately for routes marked @Public()', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const context = makeContext(true);

    const result = guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('delegates to passport JWT strategy for non-public routes', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const context = makeContext(false);

    // canActivate calls super.canActivate — we verify it does NOT short-circuit.
    // We mock super.canActivate to return true to isolate this check.
    const superActivate = vi
      .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
      .mockReturnValue(false);

    const result = guard.canActivate(context);

    expect(superActivate).toHaveBeenCalledWith(context);
    expect(result).toBe(false);
  });

  it('reads the IS_PUBLIC_KEY metadata key', () => {
    const spy = vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const context = makeContext(false);

    // Stub super so we don't need a real passport context.
    vi.spyOn(
      Object.getPrototypeOf(JwtAuthGuard.prototype),
      'canActivate',
    ).mockReturnValue(true);

    void guard.canActivate(context);

    expect(spy).toHaveBeenCalledWith(
      IS_PUBLIC_KEY,
      expect.arrayContaining([expect.anything(), expect.anything()]),
    );
  });
});
