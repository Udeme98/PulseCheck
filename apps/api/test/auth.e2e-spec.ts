import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard.js';
import { MonitorsService } from '../src/monitors/monitors.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Authentication and authorization (e2e)', () => {
  let app: INestApplication<App>;
  let jwtService: JwtService;

  const monitorsServiceMock = {
    findAll: vi.fn().mockResolvedValue([
      {
        id: 'monitor-1',
        name: 'User One Monitor',
        url: 'https://example.com',
      },
    ]),

    findOne: vi.fn().mockImplementation((id: string, userId: string) => {
      if (id === 'monitor-1' && userId === 'user-1') {
        return Promise.resolve({
          id: 'monitor-1',
          name: 'User One Monitor',
          url: 'https://example.com',
        });
      }

      return Promise.reject(new NotFoundException('Monitor not found'));
    }),

    create: vi.fn().mockResolvedValue({
      id: 'monitor-new',
      name: 'New Monitor',
      url: 'https://example.com',
    }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(MonitorsService)
      .useValue(monitorsServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    const reflector = app.get(Reflector);
    app.useGlobalGuards(new JwtAuthGuard(reflector));

    jwtService = app.get(JwtService);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createToken(userId = 'user-1') {
    return jwtService.signAsync({
      sub: userId,
      email: `${userId}@example.com`,
    });
  }

  it('should reject requests without a JWT', async () => {
    await request(app.getHttpServer()).get('/monitors').expect(401);
  });

  it('should reject an invalid JWT', async () => {
    await request(app.getHttpServer())
      .get('/monitors')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });

  it('should allow a valid JWT to access the monitor endpoint', async () => {
    const token = await createToken('user-1');

    await request(app.getHttpServer())
      .get('/monitors')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect([
        {
          id: 'monitor-1',
          name: 'User One Monitor',
          url: 'https://example.com',
        },
      ]);

    expect(monitorsServiceMock.findAll).toHaveBeenCalledWith('user-1');
  });

  it('should prevent a user from accessing another user\u2019s monitor', async () => {
    const token = await createToken('user-1');

    await request(app.getHttpServer())
      .get('/monitors/monitor-2')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(monitorsServiceMock.findOne).toHaveBeenCalledWith(
      'monitor-2',
      'user-1',
    );
  });

  it('should reject a client-supplied userId', async () => {
    const token = await createToken('user-1');

    await request(app.getHttpServer())
      .post('/monitors')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Monitor',
        url: 'https://example.com',
        userId: 'user-2',
      })
      .expect(400);

    expect(monitorsServiceMock.create).not.toHaveBeenCalled();
  });

  it('should reject invalid monitor data', async () => {
    const token = await createToken('user-1');

    await request(app.getHttpServer())
      .post('/monitors')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Monitor',
        url: 'not-a-valid-url',
        intervalSeconds: 100,
      })
      .expect(400);

    expect(monitorsServiceMock.create).not.toHaveBeenCalled();
  });
});
