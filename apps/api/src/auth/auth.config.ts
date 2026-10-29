/**
 * Known development placeholder values that must never be used in production.
 * Exact string matches — add any placeholder that appears in docs or examples.
 */
const KNOWN_PLACEHOLDERS = new Set([
  'change-this-to-a-long-random-secret-before-deploying',
  'replace-with-a-cryptographically-random-secret-at-least-64-chars',
  'your-secret-key',
  'secret',
  'mysecret',
]);

/** Minimum acceptable secret length (characters). */
export const JWT_SECRET_MIN_LENGTH = 32;

/**
 * Validate the JWT_SECRET value at startup.
 * Throws a descriptive Error — not an HTTP exception — so the process exits
 * before accepting any requests if misconfigured.
 *
 * Rules:
 * - Must not be undefined/empty.
 * - Must be at least JWT_SECRET_MIN_LENGTH characters.
 * - Must not be a known development placeholder.
 *
 * The actual secret value is never included in the error message.
 */
export function validateJwtSecret(secret: string | undefined): string {
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      'JWT_SECRET is not set. ' +
        'Generate a cryptographically random secret with: ' +
        "node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"",
    );
  }

  if (secret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `JWT_SECRET is too short (${secret.length} characters). ` +
        `A minimum of ${JWT_SECRET_MIN_LENGTH} characters is required. ` +
        'Generate a strong secret with: ' +
        "node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"",
    );
  }

  if (KNOWN_PLACEHOLDERS.has(secret.trim().toLowerCase())) {
    throw new Error(
      'JWT_SECRET is set to a known placeholder value. ' +
        'Replace it with a cryptographically random secret before running the application.',
    );
  }

  return secret;
}
