import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service.js';
import { UsersService } from '../users/users.service.js';
import type { SafeUser } from '../users/users.service.js';
import type { User } from '@prisma/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSafeUser(overrides: Partial<SafeUser> = {}): SafeUser {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    name: 'Alice',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeFullUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    name: 'Alice',
    passwordHash: '$2b$12$hashedpassword',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AuthService', () => {
  let service: AuthService;

  const mockUsersService = {
    findByEmail: vi.fn(),
    create: vi.fn(),
    toSafeUser: vi.fn((user: User): SafeUser => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { passwordHash: _h, ...safe } = user;
      return safe;
    }),
  };

  const mockJwtService = {
    sign: vi.fn().mockReturnValue('signed-token'),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // -------------------------------------------------------------------------
  // register
  // -------------------------------------------------------------------------
  describe('register()', () => {
    it('hashes the password and returns accessToken + safe user', async () => {
      const safeUser = makeSafeUser();
      mockUsersService.create.mockResolvedValue(safeUser);

      const result = await service.register('alice@example.com', 'password123');

      // Password must be hashed — the plain text must NOT appear in the call.
      const [_email, hash] = mockUsersService.create.mock.calls[0] as [
        string,
        string,
        string?,
      ];
      expect(hash).not.toBe('password123');
      expect(hash.startsWith('$2b$')).toBe(true);

      expect(result.accessToken).toBe('signed-token');
      expect(result.user).toEqual(safeUser);
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('propagates ConflictException from UsersService on duplicate email', async () => {
      mockUsersService.create.mockRejectedValue(
        new ConflictException('Registration failed. Please try again.'),
      );

      await expect(
        service.register('alice@example.com', 'password123'),
      ).rejects.toThrow(ConflictException);
    });

    it('passes optional name through to UsersService', async () => {
      const safeUser = makeSafeUser({ name: 'Alice' });
      mockUsersService.create.mockResolvedValue(safeUser);

      await service.register('alice@example.com', 'password123', 'Alice');

      expect(mockUsersService.create).toHaveBeenCalledWith(
        'alice@example.com',
        expect.any(String), // hash
        'Alice',
      );
    });

    it('signs a JWT with the correct sub and email claims', async () => {
      const safeUser = makeSafeUser({ id: 'user-abc', email: 'x@y.com' });
      mockUsersService.create.mockResolvedValue(safeUser);

      await service.register('x@y.com', 'password123');

      expect(mockJwtService.sign).toHaveBeenCalledWith({
        sub: 'user-abc',
        email: 'x@y.com',
      });
    });
  });

  // -------------------------------------------------------------------------
  // login
  // -------------------------------------------------------------------------
  describe('login()', () => {
    it('returns accessToken + safe user on valid credentials', async () => {
      const plainPassword = 'correct-password';
      const hash = await bcrypt.hash(plainPassword, 10);
      const fullUser = makeFullUser({ passwordHash: hash });

      mockUsersService.findByEmail.mockResolvedValue(fullUser);

      const result = await service.login('alice@example.com', plainPassword);

      expect(result.accessToken).toBe('signed-token');
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('throws UnauthorizedException for wrong password', async () => {
      const hash = await bcrypt.hash('correct-password', 10);
      const fullUser = makeFullUser({ passwordHash: hash });
      mockUsersService.findByEmail.mockResolvedValue(fullUser);

      await expect(
        service.login('alice@example.com', 'wrong-password'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user does not exist', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login('nobody@example.com', 'password123'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws the same UnauthorizedException message for wrong email and wrong password (no enumeration)', async () => {
      // Wrong password case
      const hash = await bcrypt.hash('correct', 10);
      mockUsersService.findByEmail.mockResolvedValueOnce(
        makeFullUser({ passwordHash: hash }),
      );
      let error1: UnauthorizedException | undefined;
      try {
        await service.login('alice@example.com', 'wrong');
      } catch (e) {
        error1 = e as UnauthorizedException;
      }

      // Non-existent user case
      mockUsersService.findByEmail.mockResolvedValueOnce(null);
      let error2: UnauthorizedException | undefined;
      try {
        await service.login('noone@example.com', 'password');
      } catch (e) {
        error2 = e as UnauthorizedException;
      }

      expect(error1?.message).toBe(error2?.message);
    });

    it('does not expose passwordHash in the returned user', async () => {
      const hash = await bcrypt.hash('pass1234', 10);
      const fullUser = makeFullUser({ passwordHash: hash });
      mockUsersService.findByEmail.mockResolvedValue(fullUser);

      const result = await service.login('alice@example.com', 'pass1234');

      expect(Object.keys(result.user)).not.toContain('passwordHash');
    });
  });
});
