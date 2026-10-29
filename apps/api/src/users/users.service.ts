import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { User } from '@prisma/client';

/** Safe user shape — never includes passwordHash. */
export type SafeUser = Omit<User, 'passwordHash'>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find a user by email.
   * Returns the full row (including passwordHash) for internal auth use only.
   * Callers that expose data to clients must strip the hash themselves, or
   * use toSafeUser().
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /**
   * Find a user by primary key.
   * Returns the full row for internal use.
   */
  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * Create a new user. Throws ConflictException on duplicate email.
   *
   * The pre-check (findUnique before insert) provides a fast, friendly response
   * for the common case. The catch on P2002 handles the race condition where two
   * concurrent registrations both pass the pre-check before either commits.
   *
   * @param email     Unique email address.
   * @param name      Optional display name.
   * @param passwordHash  Pre-hashed password (use bcrypt before calling this).
   */
  async create(
    email: string,
    passwordHash: string,
    name?: string,
  ): Promise<SafeUser> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Generic message — do not reveal whether the email is registered.
      throw new ConflictException('Registration failed. Please try again.');
    }

    try {
      const user = await this.prisma.user.create({
        data: { email, passwordHash, name },
      });
      return this.toSafeUser(user);
    } catch (err) {
      // P2002 = unique constraint violation.
      // A concurrent registration for the same email slipped through the
      // pre-check above. Translate to the same friendly ConflictException.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Registration failed. Please try again.');
      }
      // All other database errors are unexpected — rethrow without masking.
      throw err;
    }
  }

  /** Strip passwordHash before returning to callers / responses. */
  toSafeUser(user: User): SafeUser {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _hash, ...safe } = user;
    return safe;
  }
}
