import { Injectable } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { guardedFetch, isGuardedFetchError } from 'guarded-fetch';
import { validateMonitorUrl } from './monitor-url.validator.js';

export interface HttpCheckResult {
  url: string;
  status: 'UP' | 'DOWN';
  statusCode: number | null;
  responseTimeMs: number;
  errorMessage: string | null;
}

@Injectable()
export class HttpCheckService {
  async check(url: string): Promise<HttpCheckResult> {
    const startTime = performance.now();

    // Validate protocol, credentials, and port before making any network call.
    // Uses the same shared policy as the DTO validators.
    const validationError = validateMonitorUrl(url);
    if (validationError !== null) {
      return {
        url,
        status: 'DOWN',
        statusCode: null,
        responseTimeMs: Math.round(performance.now() - startTime),
        errorMessage: validationError,
      };
    }

    // validateMonitorUrl guarantees the URL is parseable and uses http/https.
    const parsed = new URL(url);

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
