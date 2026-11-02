import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('AppController and rate limiting (e2e)', () => {
  let app: INestApplication<App>;

  const authServiceMock = {
    register: vi.fn().mockResolvedValue({ id: 'user-1' }),
    login: vi.fn().mockResolvedValue({ accessToken: 'test-token' }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(AuthService)
      .useValue(authServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET / should return the health check response', async () => {
    await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('should allow 5 login requests and reject the 6th', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'Password123!',
        })
        .expect(200);
    }

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'test@example.com',
        password: 'Password123!',
      })
      .expect(429);
  });

  it('should allow 3 registration requests and reject the 4th', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: `user${i}@example.com`,
          password: 'Password123!',
        })
        .expect(201);
    }

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'fourth@example.com',
        password: 'Password123!',
      })
      .expect(429);
  });
});
