import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppModule } from '../src/app.module';

let app: INestApplication;
let directorio: string;
const anterior = process.env.ANTIFRAUDE_STATE_DIR;
const dryAnterior = process.env.DRY_RUN;
beforeEach(async () => {
  directorio = fs.mkdtempSync(path.join(os.tmpdir(), 'antifraude-http-'));
  process.env.ANTIFRAUDE_STATE_DIR = directorio;
  process.env.DRY_RUN = 'true';
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = module.createNestApplication();
  await app.init();
});
afterEach(async () => {
  await app.close();
  fs.rmSync(directorio, { recursive: true, force: true });
  if (anterior === undefined) delete process.env.ANTIFRAUDE_STATE_DIR;
  else process.env.ANTIFRAUDE_STATE_DIR = anterior;
  if (dryAnterior === undefined) delete process.env.DRY_RUN;
  else process.env.DRY_RUN = dryAnterior;
});
const cuerpo = () => ({
  cedula: '1001001001',
  transactionId: 'HTTP-1',
  valorCredito: 400000,
  solicitudTomadaEn: new Date().toISOString(),
});
it('HTTP valida datos operativos faltantes', async () => {
  await request(app.getHttpServer())
    .post('/decision/monitoreo/desde-correo')
    .send({ cedula: '123' })
    .expect(400);
});
it('HTTP controla proceso y mantiene decisiones repetidas', async () => {
  const body = cuerpo();
  await request(app.getHttpServer())
    .post('/decision/solicitud/desconocido')
    .send(body)
    .expect(400);
  const first = await request(app.getHttpServer())
    .post('/decision/solicitud/onboarding')
    .send(body)
    .expect(200);
  expect(first.body.decision).toBe('PASA');
  const second = await request(app.getHttpServer())
    .post('/decision/solicitud/onboarding')
    .send(body)
    .expect(200);
  expect(second.body).toMatchObject({ decision: 'PASA', duplicado: true });
});
it('HTTP muestra cierre sin fingir una decisión antifraude PASA', async () => {
  const body = {
    ...cuerpo(),
    solicitudTomadaEn: new Date(Date.now() - 180000).toISOString(),
  };
  const res = await request(app.getHttpServer())
    .post('/decision/monitoreo/desde-correo')
    .send(body)
    .expect(200);
  expect(res.body).toMatchObject({
    decision: null,
    cerrada: true,
    accion: 'ninguna',
  });
});
it('HTTP vista previa de contacto fuerte no ejecuta bloqueo', async () => {
  const res = await request(app.getHttpServer())
    .post('/decision/monitoreo')
    .send({
      alerta: { transactionId: 'VISTA', monto: 500000 },
      datos: { correo: { reportes: 6, entidades: 0 } },
      biometria: { disponible: true, proveedor: 'unicus', nivelUnicus: 1 },
    })
    .expect(201);
  expect(res.body).toMatchObject({ decision: 'PASA', soloEvaluacion: true });
});

it('el disparador puede consultar que el backend admite simulación obligatoria', async () => {
  const res = await request(app.getHttpServer())
    .get('/decision/configuracion')
    .expect(200);
  expect(res.body).toMatchObject({
    dryRun: true,
    entorno: 'simulador',
    admiteSoloSimulacion: true,
  });
});
it('la solicitud de simulación se rechaza si DRY_RUN=false, antes de cualquier bloqueo', async () => {
  process.env.DRY_RUN = 'false';
  const body = { ...cuerpo(), cedula: '2002002002', soloSimulacion: true };
  await request(app.getHttpServer())
    .post('/decision/solicitud/monitoreo')
    .send(body)
    .expect(409);
  expect(fs.readdirSync(directorio)).toHaveLength(0);
});
it('soloSimulacion exige booleano, no texto', async () => {
  await request(app.getHttpServer())
    .post('/decision/solicitud/monitoreo')
    .send({ ...cuerpo(), soloSimulacion: 'true' })
    .expect(400);
});
