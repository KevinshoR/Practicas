'use strict';

// Node 20+; no dependencias nuevas. Solo habla con el backend local de pruebas.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: esperar } = require('node:timers/promises');
const CASOS = require('./casos-locales.json');

function opciones(argv) {
  const o = {
    url: 'http://localhost:3000',
    cantidad: CASOS.length,
    intervaloMs: 2000,
    concurrencia: 3,
    continuo: false,
    caso: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--continuo') {
      o.continuo = true;
      continue;
    }
    if (k === '--listar') {
      o.listar = true;
      continue;
    }
    if (k === '--ayuda' || k === '--help') {
      o.ayuda = true;
      continue;
    }
    const campos = {
      '--url': 'url',
      '--cantidad': 'cantidad',
      '--intervalo-ms': 'intervaloMs',
      '--concurrencia': 'concurrencia',
      '--caso': 'caso',
    };
    if (!campos[k] || argv[i + 1] === undefined)
      throw new Error(`Opción desconocida o sin valor: ${k}`);
    o[campos[k]] = ['--url', '--caso'].includes(k)
      ? argv[++i]
      : Number(argv[++i]);
  }
  const url = new URL(o.url);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Usa una URL local, por ejemplo http://localhost:3000. Este disparador no envía datos a servidores remotos.',
    );
  }
  o.url = url.origin;
  for (const [campo, min, max] of [
    ['cantidad', 1, 10000],
    ['intervaloMs', 100, 60000],
    ['concurrencia', 1, 5],
  ]) {
    if (!Number.isInteger(o[campo]) || o[campo] < min || o[campo] > max)
      throw new Error(`${campo} debe estar entre ${min} y ${max}`);
  }
  if (o.caso && !CASOS.some((c) => c.id === o.caso))
    throw new Error('Caso desconocido. Usa --listar.');
  return o;
}
async function pedir(url, body, signal) {
  const respuesta = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    redirect: 'error',
  });
  const texto = await respuesta.text();
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new Error(`HTTP ${respuesta.status}: el backend no devolvió JSON`);
  }
  if (!respuesta.ok)
    throw new Error(
      `HTTP ${respuesta.status}: ${JSON.stringify(datos.message ?? datos)}`,
    );
  return datos;
}
async function comprobarModo(url, signal, request = pedir) {
  const config = await request(
    `${url}/decision/configuracion`,
    undefined,
    signal,
  );
  if (
    config.entorno !== 'simulador' ||
    config.dryRun !== true ||
    config.admiteSoloSimulacion !== true
  ) {
    throw new Error(
      'El backend debe estar actualizado y tener DRY_RUN=true. Detenido antes de enviar solicitudes.',
    );
  }
}
async function ejecutarCaso(caso, url, signal, emitir, deps = {}) {
  const request = deps.pedir ?? pedir;
  const sleep = deps.esperar ?? ((ms) => esperar(ms, undefined, { signal }));
  const body = {
    cedula: caso.cedula,
    transactionId: `DISPARADOR-${randomUUID()}`,
    valorCredito: caso.monto,
    creCredito: `SIM-${caso.id}`,
    solicitudTomadaEn: new Date().toISOString(),
    esReintento: false,
    soloSimulacion: true,
    estadoSolicitud: 'PENDIENTE',
  };
  const inicio = Date.now();
  let llamadas = 0;
  const evento = (tipo, extra = {}) =>
    emitir({
      tipo,
      caso: caso.id,
      cedula: caso.cedula,
      proceso: caso.proceso,
      transactionId: body.transactionId,
      ...extra,
    });
  evento('ENVIADA', { esperado: caso.esperado, solicitud: body });
  try {
    const llamar = async () => {
      llamadas++;
      const r = await request(
        `${url}/decision/solicitud/${caso.proceso}`,
        body,
        signal,
      );
      if (
        r.dryRun !== true ||
        r.entorno !== 'simulador' ||
        r.accion === 'bloquear'
      ) {
        const e = new Error(
          'El backend no respetó el modo simulación; detener el lote',
        );
        e.fatal = true;
        throw e;
      }
      if (r.transactionId !== body.transactionId)
        throw new Error('La respuesta no corresponde a la transacción enviada');
      evento('RESPUESTA', { intento: llamadas, respuesta: r });
      return r;
    };
    let resultado = await llamar();
    if (resultado.pendienteConsulta === true && !resultado.cerrada) {
      const espera = resultado.reintentarEnMs;
      const vence = Date.parse(resultado.venceEn);
      if (
        !Number.isFinite(espera) ||
        espera < 0 ||
        espera > 180000 ||
        !Number.isFinite(vence)
      )
        throw new Error('Plazo de reintento inválido');
      // Un solo reintento, con la misma hora e identidad. Si ya venció, no enviar otro POST.
      if (Date.now() + espera >= vence) {
        resultado = {
          ...resultado,
          decision: null,
          cerrada: true,
          pendienteConsulta: false,
          codigo: 'PLAZO_AGOTADO_EN_DISPARADOR',
        };
      } else {
        evento('ESPERANDO_REINTENTO', { esperaMs: espera });
        await sleep(espera + 30);
        if (Date.now() >= vence) {
          resultado = {
            ...resultado,
            decision: null,
            cerrada: true,
            pendienteConsulta: false,
            codigo: 'PLAZO_AGOTADO_EN_DISPARADOR',
          };
        } else {
          body.esReintento = true;
          resultado = await llamar();
        }
      }
    }
    const coincide =
      resultado.decision === caso.esperado &&
      resultado.codigo === caso.codigoEsperado &&
      (llamadas === 2) === caso.reintentoEsperado &&
      !resultado.cerrada &&
      !resultado.pendienteConsulta;
    const fin = {
      estado: coincide ? 'OK' : 'DIFERENCIA',
      caso: caso.id,
      cedula: caso.cedula,
      transactionId: body.transactionId,
      esperado: caso.esperado,
      recibido: resultado.decision,
      codigoEsperado: caso.codigoEsperado,
      codigo: resultado.codigo,
      llamadas,
      duracionMs: Date.now() - inicio,
    };
    evento('FINAL', fin);
    return fin;
  } catch (error) {
    const fin = {
      estado: signal.aborted ? 'CANCELADA' : 'ERROR',
      caso: caso.id,
      cedula: caso.cedula,
      transactionId: body.transactionId,
      llamadas,
      error: error.message,
      fatal: Boolean(error.fatal),
    };
    evento('FINAL', fin);
    return fin;
  }
}
async function main(argv = process.argv.slice(2)) {
  const o = opciones(argv);
  if (o.ayuda) {
    console.log(
      'node scripts/disparador-local.cjs [--continuo] [--cantidad 15] [--intervalo-ms 2000] [--concurrencia 3] [--caso ID] [--listar] [--url http://localhost:3000]',
    );
    return;
  }
  if (o.listar) {
    console.table(
      CASOS.map(({ id, cedula, proceso, esperado }) => ({
        id,
        cedula,
        proceso,
        esperado,
      })),
    );
    return;
  }
  const cancelacion = new AbortController();
  let detenidoPorUsuario = false;
  const detener = () => {
    detenidoPorUsuario = true;
    console.log('\nDeteniendo el disparador...');
    cancelacion.abort();
  };
  process.once('SIGINT', detener);
  process.once('SIGTERM', detener);
  let salida;
  try {
    await comprobarModo(o.url, cancelacion.signal);
    const dir = path.resolve(__dirname, '..', 'reportes-disparador');
    fs.mkdirSync(dir, { recursive: true });
    const lote =
      new Date().toISOString().replace(/[:.]/g, '-') +
      '-' +
      randomUUID().slice(0, 8);
    salida = path.join(dir, `${lote}.jsonl`);
    const resumen = {
      enviados: 0,
      OK: 0,
      DIFERENCIA: 0,
      ERROR: 0,
      CANCELADA: 0,
      PASA: 0,
      BLOQUEA: 0,
      ALERTA_HUMANA: 0,
    };
    const registrar = (evento) => {
      const registro = { hora: new Date().toISOString(), ...evento };
      fs.appendFileSync(salida, JSON.stringify(registro) + '\n', 'utf8');
      if (evento.tipo === 'ENVIADA')
        console.log(`[ENVIADA] ${evento.caso} | cédula ${evento.cedula}`);
      if (evento.tipo === 'ESPERANDO_REINTENTO')
        console.log(
          `[REINTENTO] ${evento.caso} | espera ${evento.esperaMs} ms`,
        );
      if (evento.tipo === 'FINAL')
        console.log(
          `[${evento.estado}] ${evento.caso} | ${evento.recibido ?? evento.error ?? 'sin decisión'} | ${evento.codigo ?? ''}`,
        );
    };
    const lista = o.caso ? CASOS.filter((c) => c.id === o.caso) : CASOS;
    const activos = new Set();
    console.log(
      `Disparador local: ${o.url}. Solo simulación. ${o.continuo ? 'Continuo hasta Ctrl+C' : o.cantidad + ' solicitudes'}.`,
    );
    console.log(`Evidencia: ${salida}`);
    try {
      while (
        !cancelacion.signal.aborted &&
        (o.continuo || resumen.enviados < o.cantidad)
      ) {
        if (activos.size >= o.concurrencia) await Promise.race(activos);
        if (cancelacion.signal.aborted) break;
        const caso = lista[resumen.enviados % lista.length];
        resumen.enviados++;
        const tarea = ejecutarCaso(caso, o.url, cancelacion.signal, registrar)
          .then((r) => {
            resumen[r.estado]++;
            if (['PASA', 'BLOQUEA', 'ALERTA_HUMANA'].includes(r.recibido))
              resumen[r.recibido]++;
            if (r.estado === 'ERROR') cancelacion.abort(); // No inundar un backend que falla.
          })
          .catch((error) => {
            resumen.ERROR++;
            console.error(error.message);
            cancelacion.abort();
          })
          .finally(() => activos.delete(tarea));
        activos.add(tarea);
        if (o.continuo || resumen.enviados < o.cantidad)
          await esperar(o.intervaloMs, undefined, {
            signal: cancelacion.signal,
          });
      }
    } catch (error) {
      if (!cancelacion.signal.aborted) throw error;
    } finally {
      await Promise.allSettled(activos);
    }
    registrar({ tipo: 'RESUMEN', ...resumen });
    console.table(resumen);
    console.log(`Reporte: ${salida}`);
    if (detenidoPorUsuario) process.exitCode = 130;
    else if (resumen.ERROR || resumen.DIFERENCIA) process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', detener);
    process.removeListener('SIGTERM', detener);
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(`No se pudo ejecutar: ${error.message}`);
    console.error(
      'Verifica que NestJS esté iniciado, que copiaste los archivos del backend y que DRY_RUN=true.',
    );
    process.exitCode = 1;
  });
module.exports = { opciones, comprobarModo, ejecutarCaso, main };
