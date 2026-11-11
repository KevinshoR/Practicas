import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  // 1. Servidor Backend / Motor (Puerto 3001 para n8n y API)
  const apiApp = await NestFactory.create<NestExpressApplication>(AppModule);
  apiApp.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  const apiPort = process.env.PORT ?? 3001;
  await apiApp.listen(apiPort, '0.0.0.0');
  console.log(`🚀 Motor Antifraude (API) corriendo en: http://localhost:${apiPort}`);

  // 2. Servidor Frontend (Puerto 3000 para tus archivos en /public)
  const frontApp = await NestFactory.create<NestExpressApplication>(AppModule);
  frontApp.enableCors();
  frontApp.useStaticAssets(join(__dirname, '..', 'public'));

  const frontPort = process.env.FRONTEND_PORT ?? 3000;
  await frontApp.listen(frontPort, '0.0.0.0');
  console.log(`💻 Frontend / Simulador corriendo en: http://localhost:${frontPort}`);
}
void bootstrap();