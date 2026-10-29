import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { User } from '@prisma/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    name: 'Alice',
    passwordHash: '$2b$12$somehash',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('UsersService', () => {
  let service: UsersService;

  const mockPrisma = {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  // -------------------------------------------------------------------------
  // findByEmail
  // -------------------------------------------------------------------------
  describe('findByEmail()', () => {
    it('returns the user when found', async () => {
      const user = makeUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);

      const result = await service.findByEmail('alice@example.com');
      expect(result).toEqual(user);
    });

    it('returns null when not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findByEmail('nobody@example.com');
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  describe('create()', () => {
    it('creates a user and returns a safe user without passwordHash', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null); // no existing user
      const created = makeUser();
      mockPrisma.user.create.mockResolvedValue(created);

      const result = await service.create(
        'alice@example.com',
        '$2b$12$somehash',
        'Alice',
      );

      expect(result).not.toHaveProperty('passwordHash');
      expect(result.email).toBe('alice@example.com');
    });

    it('throws ConflictException when email already exists (pre-check path)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser());

      await expect(
        service.create('alice@example.com', '$2b$12$somehash'),
      ).rejects.toThrow(ConflictException);

      // The conflict message must not reveal whether the email is registered.
      await expect(
        service.create('alice@example.com', '$2b$12$somehash'),
      ).rejects.toThrow('Registration failed.');
    });

    it('throws ConflictException when Prisma raises P2002 (concurrent registration race)', async () => {
      // Both concurrent requests pass the pre-check; the second insert hits the
      // unique constraint and Prisma raises P2002.
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const { Prisma } = await import('@prisma/client');
      const uniqueError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`email`)',
        { code: 'P2002', clientVersion: '0.0.0' },
      );
      mockPrisma.user.create.mockRejectedValue(uniqueError);

      await expect(
        service.create('alice@example.com', '$2b$12$somehash'),
      ).rejects.toThrow(ConflictException);

      await expect(
        service.create('alice@example.com', '$2b$12$somehash'),
      ).rejects.toThrow('Registration failed.');
    });

    it('rethrows unrelated Prisma errors without masking them as ConflictException', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const { Prisma } = await import('@prisma/client');
      const unrelatedError = new Prisma.PrismaClientKnownRequestError(
        'An unexpected database error',
        { code: 'P2025', clientVersion: '0.0.0' },
      );
      mockPrisma.user.create.mockRejectedValue(unrelatedError);

      // Must NOT be wrapped in ConflictException.
      await expect(
        service.create('alice@example.com', '$2b$12$somehash'),
      ).rejects.toThrow(unrelatedError);

      await expect(
        service.create('alice@example.com', '$2b$12$somehash'),
      ).rejects.not.toThrow(ConflictException);
    });

    it('passes name as optional', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const created = makeUser({ name: undefined });
      mockPrisma.user.create.mockResolvedValue(created);

      await service.create('alice@example.com', '$2b$12$hash');

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'alice@example.com',
          passwordHash: '$2b$12$hash',
          name: undefined,
        },
      });
    });
  });

  // -------------------------------------------------------------------------
  // toSafeUser
  // -------------------------------------------------------------------------
  describe('toSafeUser()', () => {
    it('strips passwordHash from the returned object', () => {
      const user = makeUser();
      const safe = service.toSafeUser(user);

      expect(safe).not.toHaveProperty('passwordHash');
      expect(safe.id).toBe(user.id);
      expect(safe.email).toBe(user.email);
    });
  });
});
