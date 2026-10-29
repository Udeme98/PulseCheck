import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RegisterDto } from './register.dto.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function validateDto(plain: Record<string, unknown>) {
  const instance = plainToInstance(RegisterDto, plain);
  return validate(instance);
}

function asciiPassword(bytes: number): string {
  // Each ASCII character is exactly 1 UTF-8 byte.
  return 'a'.repeat(bytes);
}

// U+1F600 GRINNING FACE — encodes as 4 UTF-8 bytes.
// In JavaScript (UTF-16), it is a surrogate pair and counts as
// String.prototype.length === 2, not 1.
const EMOJI_4BYTES = '\u{1F600}';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('RegisterDto — password byte-length validation', () => {
  const BASE = {
    email: 'user@example.com',
    password: 'valid-password',
  };

  // -------------------------------------------------------------------------
  // Valid cases
  // -------------------------------------------------------------------------

  it('accepts a normal ASCII password (well under 72 bytes)', async () => {
    const errors = await validateDto({ ...BASE, password: 'correct-horse' });
    const pwErrors = errors.filter((e) => e.property === 'password');
    expect(pwErrors).toHaveLength(0);
  });

  it('accepts a password of exactly 72 ASCII bytes (boundary — must pass)', async () => {
    const password = asciiPassword(72);
    expect(Buffer.byteLength(password)).toBe(72);

    const errors = await validateDto({ ...BASE, password });
    const pwErrors = errors.filter((e) => e.property === 'password');
    expect(pwErrors).toHaveLength(0);
  });

  it('accepts a multibyte password whose UTF-8 encoding is exactly 72 bytes', async () => {
    // 18 emoji * 4 bytes = 72 UTF-8 bytes, but only 36 UTF-16 code units.
    const password = EMOJI_4BYTES.repeat(18);
    expect(Buffer.byteLength(password)).toBe(72);

    const errors = await validateDto({ ...BASE, password });
    const pwErrors = errors.filter((e) => e.property === 'password');
    expect(pwErrors).toHaveLength(0);
  });

  it('accepts a password of exactly 8 ASCII characters (minimum length boundary)', async () => {
    const errors = await validateDto({ ...BASE, password: '12345678' });
    const pwErrors = errors.filter((e) => e.property === 'password');
    expect(pwErrors).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Invalid cases — byte length exceeded
  // -------------------------------------------------------------------------

  it('rejects a password of 73 ASCII bytes (1 byte over the limit)', async () => {
    const password = asciiPassword(73);
    expect(Buffer.byteLength(password)).toBe(73);

    const errors = await validateDto({ ...BASE, password });
    const pwErrors = errors.filter((e) => e.property === 'password');
    expect(pwErrors.length).toBeGreaterThan(0);
    expect(pwErrors[0].constraints).toHaveProperty('isByteLength');
  });

  it('rejects a multibyte password whose UTF-8 byte count exceeds 72 even though its character count does not', async () => {
    // 18 emoji (4 bytes each) + 1 ASCII = 73 UTF-8 bytes.
    // String.prototype.length = 18*2 + 1 = 37 code units — well under 72,
    // so a naive @MaxLength(72) would incorrectly allow this input.
    // @IsByteLength must catch it.
    const password = EMOJI_4BYTES.repeat(18) + 'a';
    const byteLen = Buffer.byteLength(password);
    const charLen = password.length; // UTF-16 code units

    expect(byteLen).toBe(73); // over the 72-byte limit
    expect(charLen).toBeLessThan(72); // a MaxLength(72) check would pass this

    const errors = await validateDto({ ...BASE, password });
    const pwErrors = errors.filter((e) => e.property === 'password');
    expect(pwErrors.length).toBeGreaterThan(0);
    expect(pwErrors[0].constraints).toHaveProperty('isByteLength');
  });

  it('rejects a very long password (512 ASCII bytes)', async () => {
    const password = asciiPassword(512);
    const errors = await validateDto({ ...BASE, password });
    const pwErrors = errors.filter((e) => e.property === 'password');
    expect(pwErrors.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Minimum length still enforced
  // -------------------------------------------------------------------------

  it('rejects a password shorter than 8 characters', async () => {
    const errors = await validateDto({ ...BASE, password: 'short' });
    const pwErrors = errors.filter((e) => e.property === 'password');
    expect(pwErrors.length).toBeGreaterThan(0);
    expect(pwErrors[0].constraints).toHaveProperty('minLength');
  });

  // -------------------------------------------------------------------------
  // Custom error message
  // -------------------------------------------------------------------------

  it('uses the custom error message that references 72 bytes', async () => {
    const password = asciiPassword(73);
    const errors = await validateDto({ ...BASE, password });
    const pwErrors = errors.filter((e) => e.property === 'password');
    expect(pwErrors[0].constraints?.isByteLength).toContain('72 bytes');
  });
});
