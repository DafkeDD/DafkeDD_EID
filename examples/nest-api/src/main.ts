import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // De website draait op een ander adres dan de API: CORS met cookies toelaten.
  app.enableCors({ origin: process.env.APP_ORIGIN ?? 'http://localhost:3000', credentials: true });
  await app.listen(process.env.PORT ?? 3001);
}
await bootstrap();
