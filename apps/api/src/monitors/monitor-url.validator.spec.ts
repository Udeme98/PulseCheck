/**
 * Unit tests for the shared monitor URL policy.
 *
 * validateMonitorUrl() is the single source of truth for URL rules used by
 * both DTO validation and HttpCheckService. These tests pin every rule so a
 * future change to one side is immediately visible against the other.
 */

import { ValidateIf, validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { validateMonitorUrl, IsMonitorUrl } from './monitor-url.validator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal DTO that exercises the decorator on a required field. */
class RequiredUrlDto {
  @IsMonitorUrl()
  url!: string;
}

/**
 * Minimal DTO that exercises the decorator on an optional field.
 * Mirrors how UpdateMonitorDto uses @ValidateIf() + @IsMonitorUrl():
 * - undefined  → skip validation (field omitted in a partial update)
 * - null / ""  → validate and reject
 * - valid URL  → pass
 */
class OptionalUrlDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsMonitorUrl()
  url?: string;
}

async function validateRequired(plain: Record<string, unknown>) {
  return validate(plainToInstance(RequiredUrlDto, plain));
}

async function validateOptional(plain: Record<string, unknown>) {
  return validate(plainToInstance(OptionalUrlDto, plain));
}

function urlErrors(errors: Awaited<ReturnType<typeof validate>>) {
  return errors.filter((e) => e.property === 'url');
}

// ---------------------------------------------------------------------------
// validateMonitorUrl — direct unit tests
// ---------------------------------------------------------------------------

describe('validateMonitorUrl()', () => {
  // -------------------------------------------------------------------------
  // Valid URLs — must return null
  // -------------------------------------------------------------------------

  describe('valid URLs', () => {
    it('accepts a plain HTTP URL', () => {
      expect(validateMonitorUrl('http://example.com')).toBeNull();
    });

    it('accepts a plain HTTPS URL', () => {
      expect(validateMonitorUrl('https://example.com')).toBeNull();
    });

    it('accepts HTTP with an explicit standard port 80', () => {
      expect(validateMonitorUrl('http://example.com:80')).toBeNull();
    });

    it('accepts HTTPS with an explicit standard port 443', () => {
      expect(validateMonitorUrl('https://example.com:443')).toBeNull();
    });

    it('accepts URLs with a path and query string', () => {
      expect(validateMonitorUrl('https://example.com/health?v=1')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Unsupported protocols — must return an error message
  // -------------------------------------------------------------------------

  describe('unsupported protocols', () => {
    it.each([
      'ftp://example.com',
      'file:///etc/passwd',
      'gopher://example.com',
    ])('rejects %s', (url) => {
      expect(validateMonitorUrl(url)).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Credentials — must return an error message
  // -------------------------------------------------------------------------

  describe('URLs with credentials', () => {
    it('rejects a URL with a username only', () => {
      const msg = validateMonitorUrl('https://user@example.com');
      expect(msg).not.toBeNull();
      expect(msg).toMatch(/credentials/i);
    });

    it('rejects a URL with username and password', () => {
      const msg = validateMonitorUrl('https://user:pass@example.com');
      expect(msg).not.toBeNull();
      expect(msg).toMatch(/credentials/i);
    });
  });

  // -------------------------------------------------------------------------
  // Non-standard and mismatched ports — must return an error message
  // -------------------------------------------------------------------------

  describe('non-standard ports', () => {
    it('rejects HTTP on port 8080', () => {
      const msg = validateMonitorUrl('http://example.com:8080');
      expect(msg).not.toBeNull();
      expect(msg).toMatch(/port/i);
    });

    it('rejects HTTPS on port 8443', () => {
      const msg = validateMonitorUrl('https://example.com:8443');
      expect(msg).not.toBeNull();
      expect(msg).toMatch(/port/i);
    });

    it('rejects HTTP on the HTTPS standard port (443)', () => {
      const msg = validateMonitorUrl('http://example.com:443');
      expect(msg).not.toBeNull();
      expect(msg).toMatch(/port/i);
    });

    it('rejects HTTPS on the HTTP standard port (80)', () => {
      const msg = validateMonitorUrl('https://example.com:80');
      expect(msg).not.toBeNull();
      expect(msg).toMatch(/port/i);
    });
  });

  // -------------------------------------------------------------------------
  // Malformed URLs — must return an error message
  // -------------------------------------------------------------------------

  describe('malformed URLs', () => {
    it.each(['not-a-url', '', 'example.com', '//example.com', 'http://'])(
      'rejects "%s"',
      (url) => {
        expect(validateMonitorUrl(url)).not.toBeNull();
      },
    );
  });
});

// ---------------------------------------------------------------------------
// @IsMonitorUrl decorator — integration with class-validator
// ---------------------------------------------------------------------------

describe('@IsMonitorUrl decorator', () => {
  // -------------------------------------------------------------------------
  // Required field — valid cases
  // -------------------------------------------------------------------------

  describe('required field — valid', () => {
    it('passes for a valid HTTP URL', async () => {
      const errors = await validateRequired({ url: 'http://example.com' });
      expect(urlErrors(errors)).toHaveLength(0);
    });

    it('passes for a valid HTTPS URL', async () => {
      const errors = await validateRequired({ url: 'https://example.com' });
      expect(urlErrors(errors)).toHaveLength(0);
    });

    it('passes for HTTP with explicit standard port 80', async () => {
      const errors = await validateRequired({
        url: 'http://example.com:80',
      });
      expect(urlErrors(errors)).toHaveLength(0);
    });

    it('passes for HTTPS with explicit standard port 443', async () => {
      const errors = await validateRequired({
        url: 'https://example.com:443',
      });
      expect(urlErrors(errors)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Required field — invalid cases
  // -------------------------------------------------------------------------

  describe('required field — invalid', () => {
    it('fails for an unsupported protocol', async () => {
      const errors = await validateRequired({ url: 'ftp://example.com' });
      expect(urlErrors(errors).length).toBeGreaterThan(0);
    });

    it('fails for credentials in URL', async () => {
      const errors = await validateRequired({
        url: 'https://user:pass@example.com',
      });
      expect(urlErrors(errors).length).toBeGreaterThan(0);
    });

    it('fails for a non-standard port', async () => {
      const errors = await validateRequired({
        url: 'https://example.com:8443',
      });
      expect(urlErrors(errors).length).toBeGreaterThan(0);
    });

    it('fails for a malformed URL', async () => {
      const errors = await validateRequired({ url: 'not-a-url' });
      expect(urlErrors(errors).length).toBeGreaterThan(0);
    });

    it('fails when url is missing entirely', async () => {
      const errors = await validateRequired({});
      expect(urlErrors(errors).length).toBeGreaterThan(0);
    });

    it('fails for a numeric value', async () => {
      const errors = await validateRequired({ url: 42 });
      expect(urlErrors(errors).length).toBeGreaterThan(0);
    });

    it('fails for an array value', async () => {
      const errors = await validateRequired({ url: ['https://example.com'] });
      expect(urlErrors(errors).length).toBeGreaterThan(0);
    });

    it('fails for a plain object value', async () => {
      const errors = await validateRequired({
        url: { href: 'https://example.com' },
      });
      expect(urlErrors(errors).length).toBeGreaterThan(0);
    });

    it('fails for an explicit null value', async () => {
      const errors = await validateRequired({ url: null });
      expect(urlErrors(errors).length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Optional field — @ValidateIf() + @IsMonitorUrl() combination
  // -------------------------------------------------------------------------

  describe('optional field', () => {
    it('passes when the url field is absent (undefined)', async () => {
      // ValidateIf skips only when the value is strictly undefined, so an
      // omitted field in a partial update is accepted.
      const errors = await validateOptional({});
      expect(urlErrors(errors)).toHaveLength(0);
    });

    it('passes when url is a valid HTTPS URL', async () => {
      const errors = await validateOptional({
        url: 'https://example.com',
      });
      expect(urlErrors(errors)).toHaveLength(0);
    });

    it('fails when url is present but invalid', async () => {
      const errors = await validateOptional({
        url: 'https://example.com:9999',
      });
      expect(urlErrors(errors).length).toBeGreaterThan(0);
    });

    it('fails for an explicit null value', async () => {
      // null is not undefined, so ValidateIf runs @IsMonitorUrl, which rejects it.
      const errors = await validateOptional({ url: null });
      expect(urlErrors(errors).length).toBeGreaterThan(0);
    });

    it('fails for an empty string', async () => {
      const errors = await validateOptional({ url: '' });
      expect(urlErrors(errors).length).toBeGreaterThan(0);
    });
  });
});
