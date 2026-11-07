import { registerDecorator, ValidationOptions } from 'class-validator';

/** Standard port for each allowed scheme. */
const STANDARD_PORT: Record<string, number> = {
  'http:': 80,
  'https:': 443,
};

/**
 * Validates a monitor URL against the shared URL policy:
 *
 * 1. Must be parseable as a valid URL.
 * 2. Protocol must be http: or https:.
 * 3. Must not contain a username or password.
 * 4. Port must be absent or equal to the standard port for the scheme
 *    (80 for http:, 443 for https:).
 *
 * Returns `null` when the URL is valid, or a human-readable error message
 * string when it is not. Synchronous — performs no DNS resolution.
 */
export function validateMonitorUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return 'url must be a valid URL';
  }

  if (STANDARD_PORT[parsed.protocol] === undefined) {
    return 'url must use the http or https protocol';
  }

  if (parsed.username !== '' || parsed.password !== '') {
    return 'url must not contain credentials (username or password)';
  }

  const standardPort = STANDARD_PORT[parsed.protocol]!;
  if (parsed.port !== '' && parseInt(parsed.port, 10) !== standardPort) {
    return `url port must be ${standardPort} or absent for ${parsed.protocol.replace(':', '')} URLs`;
  }

  return null;
}

/**
 * class-validator decorator that applies the shared monitor URL policy.
 * Use on DTO fields that carry a monitor URL.
 */
export function IsMonitorUrl(options?: ValidationOptions): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    registerDecorator({
      name: 'isMonitorUrl',
      target: (object as { constructor: Function }).constructor,
      propertyName: String(propertyName),
      options,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          return validateMonitorUrl(value) === null;
        },
        defaultMessage(): string {
          return 'url must be a valid http or https URL on a standard port without credentials';
        },
      },
    });
  };
}
