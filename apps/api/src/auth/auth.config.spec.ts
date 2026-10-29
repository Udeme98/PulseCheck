import { describe, expect, it } from 'vitest';
import { validateJwtSecret, JWT_SECRET_MIN_LENGTH } from './auth.config.js';

describe('validateJwtSecret', () => {
  it('rejects an undefined secret', () => {
    expect(() => validateJwtSecret(undefined)).toThrow(
      /JWT_SECRET is not set/i,
    );
  });

  it('rejects an empty or whitespace-only secret', () => {
    expect(() => validateJwtSecret('')).toThrow(/JWT_SECRET is not set/i);
    expect(() => validateJwtSecret('   ')).toThrow(/JWT_SECRET is not set/i);
  });

  it('rejects a secret shorter than the minimum length', () => {
    expect(() => validateJwtSecret('short-secret')).toThrow(
      /JWT_SECRET is too short/i,
    );
  });

  it('rejects a known placeholder', () => {
    const placeholder =
      'replace-with-a-cryptographically-random-secret-at-least-64-chars';

    expect(() => validateJwtSecret(placeholder)).toThrow(/known placeholder/i);
  });

  it('rejects a known placeholder regardless of capitalization', () => {
    const placeholder =
      'REPLACE-WITH-A-CRYPTOGRAPHICALLY-RANDOM-SECRET-AT-LEAST-64-CHARS';

    expect(() => validateJwtSecret(placeholder)).toThrow(/known placeholder/i);
  });

  it('accepts a sufficiently long, non-placeholder secret', () => {
    const secret = 'a'.repeat(JWT_SECRET_MIN_LENGTH);

    expect(validateJwtSecret(secret)).toBe(secret);
  });

  it('does not include the supplied secret in validation errors', () => {
    const secret = 'short-secret-value-that-must-not-be-exposed';

    try {
      validateJwtSecret(secret);
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
