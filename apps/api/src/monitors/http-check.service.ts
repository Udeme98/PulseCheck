import { Injectable } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { guardedFetch, isGuardedFetchError } from 'guarded-fetch';

export interface HttpCheckResult {
  url: string;
  status: 'UP' | 'DOWN';
  statusCode: number | null;
  responseTimeMs: number;
  errorMessage: string | null;
}

/** Ports that are valid for each scheme. Undefined (absent) is also valid. */
const ALLOWED_PORTS: Record<string, number> = {
  'http:': 80,
  'https:': 443,
};

/**
 * Validates a URL against SSRF-relevant rules that are checked before
 * handing off to guardedFetch:
 *
 * 1. Must parse as a valid URL.
 * 2. Protocol must be http: or https:.
 * 3. No username or password in the URL.
 * 4. Port must be absent, or equal to the standard port for the scheme.
 *
 * Returns the parsed URL on success, or throws an Error on failure.
 */
function validateUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  const allowedPort = ALLOWED_PORTS[parsed.protocol];
  if (allowedPort === undefined) {
    throw new Error(
      `Unsupported protocol "${parsed.protocol}": only http: and https: are allowed`,
    );
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error(
      'URLs with credentials (username or password) are not allowed',
    );
  }

  // parsed.port is an empty string when the port is absent (using scheme default).
  if (parsed.port !== '' && parseInt(parsed.port, 10) !== allowedPort) {
    throw new Error(
      `Non-standard port ${parsed.port} is not allowed for ${parsed.protocol}; ` +
        `only port ${allowedPort} (or absent) is permitted`,
    );
  }

  return parsed;
}

@Injectable()
export class HttpCheckService {
  async check(url: string): Promise<HttpCheckResult> {
    const startTime = performance.now();

    // Validate protocol, credentials, and port before making any network call.
    let parsed: URL;
    try {
      parsed = validateUrl(url);
    } catch (error: unknown) {
      const responseTimeMs = Math.round(performance.now() - startTime);
      return {
        url,
        status: 'DOWN',
        statusCode: null,
        responseTimeMs,
        errorMessage:
          error instanceof Error ? error.message : 'URL validation failed',
      };
    }

    try {
      const response = await guardedFetch(parsed, {
        method: 'GET',
        timeoutMs: 10_000,
        followRedirects: false,
        opaqueErrors: true,
      });

      const responseTimeMs = Math.round(performance.now() - startTime);

      // We only need the status code; cancel the body to free the connection.
      // Swallow any cancellation error — it must not change the health-check
      // result, because the HTTP status code was already successfully received.
      if (response.body) {
        await response.body.cancel().catch(() => undefined);
      }

      return {
        url,
        status: response.status < 500 ? 'UP' : 'DOWN',
        statusCode: response.status,
        responseTimeMs,
        errorMessage: null,
      };
    } catch (error: unknown) {
      const responseTimeMs = Math.round(performance.now() - startTime);

      let errorMessage: string;
      if (isGuardedFetchError(error)) {
        // opaqueErrors: true means error.message is already the safe opaque
        // string; we use the code for a concise internal record.
        errorMessage = `Request blocked or failed [${error.code}]`;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      } else {
        errorMessage = 'An unknown error occurred';
      }

      return {
        url,
        status: 'DOWN',
        statusCode: null,
        responseTimeMs,
        errorMessage,
      };
    }
  }
}
