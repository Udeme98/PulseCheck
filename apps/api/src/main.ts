import { ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Validate JWT config at startup — JwtModule.registerAsync throws if
  // JWT_SECRET is missing, so the process exits before accepting requests.

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Apply JWT authentication globally; use @Public() to opt routes out.
  const reflector = app.get(Reflector);
  app.useGlobalGuards(new JwtAuthGuard(reflector));

  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
