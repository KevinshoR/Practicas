'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  opciones,
  comprobarModo,
  ejecutarCaso,
} = require('./disparador-local.cjs');
const casos = require('./casos-locales.json');
const signal = () => new AbortController().signal;
const valido = (body, caso, extra = {}) => ({
  transactionId: body.transactionId,
  dryRun: true,
  entorno: 'simulador',
  accion: caso.esperado === 'BLOQUEA' ? 'solo_registrar' : 'ninguna',
  decision: caso.esperado,
  codigo: caso.codigoEsperado,
  ...extra,
});

test('las opciones limitan el disparador a direcciones locales y carga acotada', () => {
  assert.equal(opciones([]).cantidad, 15);
  for (const args of [
    ['--url', 'https://externo.test'],
    ['--concurrencia', '100'],
    ['--cantidad', '0'],
    ['--intervalo-ms', '0'],
    ['--caso', 'no-existe'],
  ])
    assert.throws(() => opciones(args));
  assert.equal(opciones(['--continuo']).continuo, true);
});
test('rechaza backend activo o antiguo antes de generar solicitudes', async () => {
  for (const config of [
    { dryRun: false, entorno: 'simulador', admiteSoloSimulacion: true },
    { dryRun: true, entorno: 'simulador' },
    {},
  ]) {
    await assert.rejects(
      comprobarModo('http://localhost:3000', signal(), async () => config),
    );
  }
});
test('envía solicitud nueva y exige solo simulación', async () => {
  const caso = casos[0],
    bodies = [];
  const deps = {
    pedir: async (_u, body) => {
      bodies.push(structuredClone(body));
      return valido(body, caso);
    },
  };
  const a = await ejecutarCaso(
    caso,
    'http://localhost:3000',
    signal(),
    () => {},
    deps,
  );
  const b = await ejecutarCaso(
    caso,
    'http://localhost:3000',
    signal(),
    () => {},
    deps,
  );
  assert.equal(a.estado, 'OK');
  assert.equal(b.estado, 'OK');
  assert.notEqual(bodies[0].transactionId, bodies[1].transactionId);
  assert.equal(bodies[0].soloSimulacion, true);
});
test('reconsulta una vez conservando cédula, transacción y fecha', async () => {
  const caso = casos.find((c) => c.id === 'reintento_biometria'),
    bodies = [],
    esperas = [];
  const deps = {
    pedir: async (_u, body) => {
      bodies.push(structuredClone(body));
      return valido(
        body,
        caso,
        bodies.length === 1
          ? {
              decision: null,
              pendienteConsulta: true,
              reintentarEnMs: 10000,
              venceEn: new Date(Date.now() + 180000).toISOString(),
            }
          : {},
      );
    },
    esperar: async (ms) => {
      esperas.push(ms);
    },
  };
  const r = await ejecutarCaso(
    caso,
    'http://localhost:3000',
    signal(),
    () => {},
    deps,
  );
  assert.equal(r.estado, 'OK');
  assert.equal(bodies.length, 2);
  assert.equal(esperas.length, 1);
  assert.deepEqual({ ...bodies[0], esReintento: true }, bodies[1]);
});
test('no envía una tercera consulta si el motor sigue pendiente', async () => {
  let llamadas = 0;
  const caso = casos.find((c) => c.reintentoEsperado);
  const r = await ejecutarCaso(
    caso,
    'http://localhost:3000',
    signal(),
    () => {},
    {
      pedir: async (_u, b) => {
        llamadas++;
        return valido(b, caso, {
          decision: null,
          pendienteConsulta: true,
          reintentarEnMs: 1,
          venceEn: new Date(Date.now() + 180000).toISOString(),
        });
      },
      esperar: async () => {},
    },
  );
  assert.equal(llamadas, 2);
  assert.equal(r.estado, 'DIFERENCIA');
});
test('no reconsulta si la espera supera el plazo', async () => {
  let llamadas = 0;
  const caso = casos[0];
  const r = await ejecutarCaso(
    caso,
    'http://localhost:3000',
    signal(),
    () => {},
    {
      pedir: async (_u, b) => {
        llamadas++;
        return valido(b, caso, {
          decision: null,
          pendienteConsulta: true,
          reintentarEnMs: 10000,
          venceEn: new Date(Date.now() + 100).toISOString(),
        });
      },
    },
  );
  assert.equal(llamadas, 1);
  assert.equal(r.estado, 'DIFERENCIA');
});
test('una respuesta de bloqueo activo detiene el lote con error fatal', async () => {
  const caso = casos[0];
  const r = await ejecutarCaso(
    caso,
    'http://localhost:3000',
    signal(),
    () => {},
    {
      pedir: async (_u, b) =>
        valido(b, caso, { dryRun: false, accion: 'bloquear' }),
    },
  );
  assert.equal(r.estado, 'ERROR');
  assert.equal(r.fatal, true);
});
test('una respuesta de otra transacción no cuenta como éxito', async () => {
  const caso = casos[0];
  const r = await ejecutarCaso(
    caso,
    'http://localhost:3000',
    signal(),
    () => {},
    {
      pedir: async (_u, b) => valido(b, caso, { transactionId: 'OTRA' }),
    },
  );
  assert.equal(r.estado, 'ERROR');
});
test('cancelar durante la espera impide el segundo envío', async () => {
  const controlador = new AbortController();
  let llamadas = 0;
  const caso = casos[0];
  const r = await ejecutarCaso(
    caso,
    'http://localhost:3000',
    controlador.signal,
    () => {},
    {
      pedir: async (_u, b) => {
        llamadas++;
        return valido(b, caso, {
          decision: null,
          pendienteConsulta: true,
          reintentarEnMs: 10000,
          venceEn: new Date(Date.now() + 180000).toISOString(),
        });
      },
      esperar: async () => {
        controlador.abort();
        throw new Error('Cancelado');
      },
    },
  );
  assert.equal(r.estado, 'CANCELADA');
  assert.equal(llamadas, 1);
});
