import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service.js';
import type { AuthResponseDto } from './dto/auth-response.dto.js';
import type { JwtPayload } from './auth.types.js';

/** Number of bcrypt salt rounds. 12 is a good balance for 2024+ hardware. */
const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Register a new user, hash their password, and return a signed JWT.
   * Throws ConflictException (via UsersService) on duplicate email.
   */
  async register(
    email: string,
    password: string,
    name?: string,
  ): Promise<AuthResponseDto> {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await this.usersService.create(email, passwordHash, name);

    const token = this.signToken(user.id, user.email);
    return { accessToken: token, user };
  }

  /**
   * Validate credentials and return a signed JWT on success.
   * Always throws the same UnauthorizedException regardless of failure reason
   * (wrong email or wrong password) to avoid user enumeration.
   */
  async login(email: string, password: string): Promise<AuthResponseDto> {
    const user = await this.usersService.findByEmail(email);

    // Use a constant-time comparison even when no user is found to prevent
    // timing-based enumeration attacks.
    const hashToCheck =
      user?.passwordHash ??
      '$2b$12$invalidhashpadding.to.ensure.constant.time.comparison.xx';

    const isValid = await bcrypt.compare(password, hashToCheck);

    if (!user || !isValid) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const safeUser = this.usersService.toSafeUser(user);
    const token = this.signToken(user.id, user.email);
    return { accessToken: token, user: safeUser };
  }

  private signToken(userId: string, email: string): string {
    const payload: JwtPayload = { sub: userId, email };
    return this.jwtService.sign(payload);
  }
}
