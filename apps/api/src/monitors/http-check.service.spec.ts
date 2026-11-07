/**
 * Unit tests for HttpCheckService.
 *
 * Strategy:
 *   - URL validation (protocol, credentials, port) exercises the real in-process
 *     validator without any network I/O.
 *   - guardedFetch is module-mocked so every test controls the exact response or
 *     thrown error without making real network calls or bypassing production
 *     security logic (the mock stands in for guardedFetch itself; the validator
 *     that wraps it still runs).
 *   - GuardedFetchError instances are constructed via the real exported class so
 *     isGuardedFetchError() recognises them correctly.
 */

import { GuardedFetchError, GuardedFetchErrorCode } from 'guarded-fetch';
import { HttpCheckService } from './http-check.service.js';

// ---------------------------------------------------------------------------
// Module mock — replaces the guardedFetch implementation for all tests.
// ---------------------------------------------------------------------------

vi.mock('guarded-fetch', async (importActual) => {
  // Keep all real exports (GuardedFetchError class, error codes, type guards…)
  // but replace guardedFetch with a vi.fn() stub.
  const actual = await importActual<typeof import('guarded-fetch')>();
  return {
    ...actual,
    guardedFetch: vi.fn(),
  };
});

// After the mock is registered we can import the mocked function.
import { guardedFetch } from 'guarded-fetch';
const mockGuardedFetch = vi.mocked(guardedFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock Response with a cancellable body. */
function makeResponse(
  status: number,
  opts: { cancelSpy?: ReturnType<typeof vi.fn> } = {},
): Response {
  const cancelSpy = opts.cancelSpy ?? vi.fn().mockResolvedValue(undefined);
  const body = { cancel: cancelSpy } as unknown as ReadableStream;
  return {
    status,
    ok: status >= 200 && status < 300,
    body,
    headers: new Headers(),
  } as unknown as Response;
}

/** Construct a real GuardedFetchError so isGuardedFetchError() recognises it. */
function makeGuardedError(
  code: GuardedFetchErrorCode,
  message = 'The URL could not be fetched: either it is not reachable or the request was rejected by policy.',
): GuardedFetchError {
  return new GuardedFetchError(code, message);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('HttpCheckService', () => {
  let service: HttpCheckService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new HttpCheckService();
  });

  // -------------------------------------------------------------------------
  // Valid public URLs — should reach guardedFetch and return UP
  // -------------------------------------------------------------------------

  describe('valid public URLs', () => {
    it('returns UP for a 200 response on a public HTTP URL', async () => {
      mockGuardedFetch.mockResolvedValue(makeResponse(200));

      const result = await service.check('http://example.com');

      expect(result.status).toBe('UP');
      expect(result.statusCode).toBe(200);
      expect(result.errorMessage).toBeNull();
      expect(mockGuardedFetch).toHaveBeenCalledOnce();
    });

    it('returns UP for a 200 response on a public HTTPS URL', async () => {
      mockGuardedFetch.mockResolvedValue(makeResponse(200));

      const result = await service.check('https://example.com');

      expect(result.status).toBe('UP');
      expect(result.statusCode).toBe(200);
      expect(result.errorMessage).toBeNull();
    });

    it('returns UP for status codes below 500', async () => {
      for (const statusCode of [200, 201, 301, 302, 404, 499]) {
        mockGuardedFetch.mockResolvedValue(makeResponse(statusCode));
        const result = await service.check('https://example.com');
        expect(result.status).toBe('UP');
        expect(result.statusCode).toBe(statusCode);
      }
    });

    it('returns DOWN for status codes 500 and above', async () => {
      for (const statusCode of [500, 502, 503]) {
        mockGuardedFetch.mockResolvedValue(makeResponse(statusCode));
        const result = await service.check('https://example.com');
        expect(result.status).toBe('DOWN');
        expect(result.statusCode).toBe(statusCode);
        expect(result.errorMessage).toBeNull();
      }
    });

    it('passes the parsed URL, correct method and options to guardedFetch', async () => {
      mockGuardedFetch.mockResolvedValue(makeResponse(200));

      await service.check('https://example.com');

      expect(mockGuardedFetch).toHaveBeenCalledWith(
        expect.objectContaining({ href: 'https://example.com/' }),
        expect.objectContaining({
          method: 'GET',
          timeoutMs: 10_000,
          followRedirects: false,
          opaqueErrors: true,
        }),
      );
    });

    it('includes a non-negative responseTimeMs', async () => {
      mockGuardedFetch.mockResolvedValue(makeResponse(200));

      const result = await service.check('https://example.com');

      expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('echoes back the original URL string', async () => {
      mockGuardedFetch.mockResolvedValue(makeResponse(200));

      const result = await service.check('https://example.com');

      expect(result.url).toBe('https://example.com');
    });
  });

  // -------------------------------------------------------------------------
  // Response body cancellation
  // -------------------------------------------------------------------------

  describe('response body cancellation', () => {
    it('cancels the response body after receiving the status code', async () => {
      const cancelSpy = vi.fn().mockResolvedValue(undefined);
      mockGuardedFetch.mockResolvedValue(makeResponse(200, { cancelSpy }));

      await service.check('https://example.com');

      expect(cancelSpy).toHaveBeenCalledOnce();
    });

    it('still returns UP when body.cancel() resolves', async () => {
      const cancelSpy = vi.fn().mockResolvedValue(undefined);
      mockGuardedFetch.mockResolvedValue(makeResponse(204, { cancelSpy }));

      const result = await service.check('https://example.com');

      expect(result.status).toBe('UP');
      expect(cancelSpy).toHaveBeenCalledOnce();
    });

    it('returns UP for a 200 response even when body.cancel() rejects', async () => {
      const cancelSpy = vi
        .fn()
        .mockRejectedValue(new Error('stream already closed'));
      mockGuardedFetch.mockResolvedValue(makeResponse(200, { cancelSpy }));

      const result = await service.check('https://example.com');

      expect(result.status).toBe('UP');
      expect(result.statusCode).toBe(200);
      expect(result.errorMessage).toBeNull();
    });

    it('returns DOWN with statusCode 500 even when body.cancel() rejects', async () => {
      const cancelSpy = vi
        .fn()
        .mockRejectedValue(new Error('stream already closed'));
      mockGuardedFetch.mockResolvedValue(makeResponse(500, { cancelSpy }));

      const result = await service.check('https://example.com');

      expect(result.status).toBe('DOWN');
      expect(result.statusCode).toBe(500);
      expect(result.errorMessage).toBeNull();
    });

    it('handles a response with body: null without throwing', async () => {
      const response = {
        status: 200,
        ok: true,
        body: null,
        headers: new Headers(),
      } as unknown as Response;
      mockGuardedFetch.mockResolvedValue(response);

      const result = await service.check('https://example.com');

      expect(result.status).toBe('UP');
      expect(result.statusCode).toBe(200);
      expect(result.errorMessage).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Unsupported protocols — blocked by the in-process validator before guardedFetch
  // -------------------------------------------------------------------------

  describe('unsupported protocols', () => {
    it.each([
      'ftp://example.com',
      'file:///etc/passwd',
      'gopher://example.com',
    ])('returns DOWN for %s without calling guardedFetch', async (url) => {
      const result = await service.check(url);

      expect(result.status).toBe('DOWN');
      expect(result.statusCode).toBeNull();
      expect(result.errorMessage).toBeTruthy();
      expect(mockGuardedFetch).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // URLs containing credentials — blocked by the in-process validator
  // -------------------------------------------------------------------------

  describe('URLs with credentials', () => {
    it('returns DOWN for a URL containing a username', async () => {
      const result = await service.check('https://user@example.com');

      expect(result.status).toBe('DOWN');
      expect(result.statusCode).toBeNull();
      expect(result.errorMessage).toMatch(/credentials/i);
      expect(mockGuardedFetch).not.toHaveBeenCalled();
    });

    it('returns DOWN for a URL containing a password', async () => {
      const result = await service.check('https://user:pass@example.com');

      expect(result.status).toBe('DOWN');
      expect(result.statusCode).toBeNull();
      expect(result.errorMessage).toMatch(/credentials/i);
      expect(mockGuardedFetch).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Non-standard and mismatched ports — blocked by the in-process validator
  // -------------------------------------------------------------------------

  describe('non-standard and mismatched ports', () => {
    it('returns DOWN for HTTP on port 8080', async () => {
      const result = await service.check('http://example.com:8080');

      expect(result.status).toBe('DOWN');
      expect(result.statusCode).toBeNull();
      expect(result.errorMessage).toMatch(/port/i);
      expect(mockGuardedFetch).not.toHaveBeenCalled();
    });

    it('returns DOWN for HTTPS on port 8443', async () => {
      const result = await service.check('https://example.com:8443');

      expect(result.status).toBe('DOWN');
      expect(result.statusCode).toBeNull();
      expect(result.errorMessage).toMatch(/port/i);
      expect(mockGuardedFetch).not.toHaveBeenCalled();
    });

    it('returns DOWN for HTTP on the HTTPS standard port (443)', async () => {
      const result = await service.check('http://example.com:443');

      expect(result.status).toBe('DOWN');
      expect(result.statusCode).toBeNull();
      expect(result.errorMessage).toMatch(/port/i);
      expect(mockGuardedFetch).not.toHaveBeenCalled();
    });

    it('returns DOWN for HTTPS on the HTTP standard port (80)', async () => {
      const result = await service.check('https://example.com:80');

      expect(result.status).toBe('DOWN');
      expect(result.statusCode).toBeNull();
      expect(result.errorMessage).toMatch(/port/i);
      expect(mockGuardedFetch).not.toHaveBeenCalled();
    });

    it('allows HTTP on the standard port 80 (explicit)', async () => {
      mockGuardedFetch.mockResolvedValue(makeResponse(200));

      const result = await service.check('http://example.com:80');

      expect(result.status).toBe('UP');
      expect(mockGuardedFetch).toHaveBeenCalledOnce();
    });

    it('allows HTTPS on the standard port 443 (explicit)', async () => {
      mockGuardedFetch.mockResolvedValue(makeResponse(200));

      const result = await service.check('https://example.com:443');

      expect(result.status).toBe('UP');
      expect(mockGuardedFetch).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // Localhost and loopback addresses — guardedFetch throws hostname_unsafe
  // -------------------------------------------------------------------------

  describe('localhost and loopback addresses', () => {
    it.each([
      'http://localhost',
      'http://127.0.0.1',
      'http://[::1]',
      'http://localhost.local',
    ])(
      'returns DOWN for %s (guardedFetch throws hostname_unsafe)',
      async (url) => {
        mockGuardedFetch.mockRejectedValue(
          makeGuardedError(GuardedFetchErrorCode.HOSTNAME_UNSAFE),
        );

        const result = await service.check(url);

        expect(result.status).toBe('DOWN');
        expect(result.statusCode).toBeNull();
        expect(result.errorMessage).toBeTruthy();
      },
    );
  });

  // -------------------------------------------------------------------------
  // Private IPv4 and IPv6 addresses — guardedFetch throws hostname_unsafe
  // -------------------------------------------------------------------------

  describe('private IP addresses', () => {
    it.each([
      'http://10.0.0.1',
      'http://172.16.0.1',
      'http://192.168.1.1',
      'http://[fc00::1]',
      'http://[fe80::1]',
    ])(
      'returns DOWN for %s (guardedFetch throws hostname_unsafe)',
      async (url) => {
        mockGuardedFetch.mockRejectedValue(
          makeGuardedError(GuardedFetchErrorCode.HOSTNAME_UNSAFE),
        );

        const result = await service.check(url);

        expect(result.status).toBe('DOWN');
        expect(result.statusCode).toBeNull();
        expect(result.errorMessage).toBeTruthy();
      },
    );
  });

  // -------------------------------------------------------------------------
  // DNS resolving to unsafe addresses (simulated via guardedFetch throwing)
  // -------------------------------------------------------------------------

  describe('DNS resolution to unsafe addresses', () => {
    it('returns DOWN when DNS resolves to a private address (single A record)', async () => {
      mockGuardedFetch.mockRejectedValue(
        makeGuardedError(GuardedFetchErrorCode.HOSTNAME_UNSAFE),
      );

      const result = await service.check('https://internal.example.com');

      expect(result.status).toBe('DOWN');
      expect(result.errorMessage).toBeTruthy();
    });

    it('returns DOWN when any DNS record is unsafe (mixed public/private records)', async () => {
      // guardedFetch rejects if any resolved A/AAAA record is private.
      mockGuardedFetch.mockRejectedValue(
        makeGuardedError(GuardedFetchErrorCode.HOSTNAME_UNSAFE),
      );

      const result = await service.check('https://split-horizon.example.com');

      expect(result.status).toBe('DOWN');
      expect(result.errorMessage).toBeTruthy();
    });

    it('returns DOWN on DNS rebinding (connect-time IP rejected)', async () => {
      // Simulates the connect-time guard firing after a TTL=0 DNS swap.
      mockGuardedFetch.mockRejectedValue(
        makeGuardedError(GuardedFetchErrorCode.HOSTNAME_UNSAFE),
      );

      const result = await service.check('https://rebinding.example.com');

      expect(result.status).toBe('DOWN');
      expect(result.errorMessage).toBeTruthy();
    });

    it('returns DOWN when DNS resolution itself fails', async () => {
      mockGuardedFetch.mockRejectedValue(
        makeGuardedError(GuardedFetchErrorCode.NETWORK_ERROR),
      );

      const result = await service.check('https://nonexistent.invalid');

      expect(result.status).toBe('DOWN');
      expect(result.errorMessage).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Request timeouts
  // -------------------------------------------------------------------------

  describe('request timeouts', () => {
    it('returns DOWN on a timeout without throwing', async () => {
      mockGuardedFetch.mockRejectedValue(
        makeGuardedError(GuardedFetchErrorCode.TIMEOUT),
      );

      const result = await service.check('https://slow.example.com');

      expect(result.status).toBe('DOWN');
      expect(result.statusCode).toBeNull();
      expect(result.errorMessage).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Network failures
  // -------------------------------------------------------------------------

  describe('network failures', () => {
    it('returns DOWN on a connection refused error without throwing', async () => {
      mockGuardedFetch.mockRejectedValue(
        makeGuardedError(GuardedFetchErrorCode.NETWORK_ERROR),
      );

      const result = await service.check('https://unreachable.example.com');

      expect(result.status).toBe('DOWN');
      expect(result.statusCode).toBeNull();
      expect(result.errorMessage).toBeTruthy();
    });

    it('returns DOWN on a generic Error (non-GuardedFetchError)', async () => {
      mockGuardedFetch.mockRejectedValue(new Error('socket hang up'));

      const result = await service.check('https://example.com');

      expect(result.status).toBe('DOWN');
      expect(result.statusCode).toBeNull();
      expect(result.errorMessage).toBe('socket hang up');
    });

    it('returns DOWN on a non-Error throw without losing the check', async () => {
      mockGuardedFetch.mockRejectedValue('something weird');

      const result = await service.check('https://example.com');

      expect(result.status).toBe('DOWN');
      expect(result.statusCode).toBeNull();
      expect(result.errorMessage).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Redirect responses (followRedirects: false)
  // -------------------------------------------------------------------------

  describe('redirect responses', () => {
    it('returns UP for a 301 redirect (redirect is not followed)', async () => {
      // With followRedirects: false, a 3xx is returned as-is — status < 500 → UP.
      mockGuardedFetch.mockResolvedValue(makeResponse(301));

      const result = await service.check('https://example.com');

      expect(result.status).toBe('UP');
      expect(result.statusCode).toBe(301);
      expect(result.errorMessage).toBeNull();
    });

    it('returns UP for a 302 redirect', async () => {
      mockGuardedFetch.mockResolvedValue(makeResponse(302));

      const result = await service.check('https://example.com');

      expect(result.status).toBe('UP');
      expect(result.statusCode).toBe(302);
    });
  });

  // -------------------------------------------------------------------------
  // Runtime validation is independent of DTO validation
  // -------------------------------------------------------------------------

  describe('runtime validation independence', () => {
    it('blocks a non-standard port even when called directly without DTO validation', async () => {
      // Simulates a URL that might have been stored before policy enforcement
      // or injected by a code path that skips the DTO layer.
      const result = await service.check('https://example.com:9999');

      expect(result.status).toBe('DOWN');
      expect(result.statusCode).toBeNull();
      expect(result.errorMessage).toMatch(/port/i);
      expect(mockGuardedFetch).not.toHaveBeenCalled();
    });

    it('blocks a URL with credentials even when called directly without DTO validation', async () => {
      const result = await service.check('https://admin:secret@example.com');

      expect(result.status).toBe('DOWN');
      expect(result.statusCode).toBeNull();
      expect(result.errorMessage).toMatch(/credentials/i);
      expect(mockGuardedFetch).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // UP / DOWN status classification boundary
  // -------------------------------------------------------------------------

  describe('UP/DOWN status classification', () => {
    it('classifies status 499 as UP (last code below 500)', async () => {
      mockGuardedFetch.mockResolvedValue(makeResponse(499));

      const result = await service.check('https://example.com');

      expect(result.status).toBe('UP');
    });

    it('classifies status 500 as DOWN', async () => {
      mockGuardedFetch.mockResolvedValue(makeResponse(500));

      const result = await service.check('https://example.com');

      expect(result.status).toBe('DOWN');
      expect(result.statusCode).toBe(500);
      expect(result.errorMessage).toBeNull();
    });

    it('classifies status 503 as DOWN', async () => {
      mockGuardedFetch.mockResolvedValue(makeResponse(503));

      const result = await service.check('https://example.com');

      expect(result.status).toBe('DOWN');
      expect(result.statusCode).toBe(503);
    });
  });
});
