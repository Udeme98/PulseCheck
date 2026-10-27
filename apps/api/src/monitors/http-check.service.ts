import { Injectable } from '@nestjs/common';
import { performance } from 'node:perf_hooks';

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

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(10_000),
      });

      const responseTimeMs = Math.round(performance.now() - startTime);

      return {
        url,
        status: response.status < 500 ? 'UP' : 'DOWN',
        statusCode: response.status,
        responseTimeMs,
        errorMessage: null,
      };
    } catch (error: unknown) {
      const responseTimeMs = Math.round(performance.now() - startTime);

      return {
        url,
        status: 'DOWN',
        statusCode: null,
        responseTimeMs,
        errorMessage:
          error instanceof Error ? error.message : 'An unknown error occurred',
      };
    }
  }
}
