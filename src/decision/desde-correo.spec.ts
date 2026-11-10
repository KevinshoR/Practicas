import { BadRequestException, ConflictException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DecisionService } from './decision.service';
import { DecisionController } from './decision.controller';
import { SumasService } from '../sumas/sumas.service';
import type { AlertaDto, DesdeCorreoDto } from './alerta.dto';

const INICIO = Date.parse('2026-11-10T15:00:00Z');
let directorio: string;
let service: DecisionService;
let sumas: SumasService;
const original = {
  dry: process.env.DRY_RUN,
  state: process.env.ANTIFRAUDE_STATE_DIR,
};
const solicitud = (extra: Partial<DesdeCorreoDto> = {}): DesdeCorreoDto => ({
  cedula: '2002002002',
  transactionId: 'TX-PRUEBA',
  valorCredito: 350000,
  solicitudTomadaEn: new Date(INICIO).toISOString(),
  creCredito: 'CRE-1',
  ...extra,
});
function datos(body = solicitud()): AlertaDto {
  return {
    alerta: { transactionId: body.transactionId, monto: body.valorCredito },
    datos: {
      celular: { reportes: 0, entidades: 0 },
      correo: { reportes: 0, entidades: 0 },
      direccion: { reportes: 0 },
    },
    biometria: { disponible: true, proveedor: 'unicus', nivelUnicus: 7 },
    historial: { comprasPrevias: 0, creditosActivos: 0, alDia: false },
    ciudadesFrecuentes: [],
    carga: 'completa',
  };
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(INICIO);
  directorio = fs.mkdtempSync(path.join(os.tmpdir(), 'antifraude-test-'));
  process.env.ANTIFRAUDE_STATE_DIR = directorio;
  process.env.DRY_RUN = 'true';
  sumas = new SumasService();
  service = new DecisionService(sumas);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  fs.rmSync(directorio, { recursive: true, force: true });
  if (original.dry === undefined) delete process.env.DRY_RUN;
  else process.env.DRY_RUN = original.dry;
  if (original.state === undefined) delete process.env.ANTIFRAUDE_STATE_DIR;
  else process.env.ANTIFRAUDE_STATE_DIR = original.state;
});

describe('Solicitud, reintento y plazo', () => {
  it('DRY_RUN registra bloqueo sin mutar Sumas', async () => {
    jest.spyOn(service.fuente, 'consultar').mockResolvedValue(datos());
    const bloquear = jest.spyOn(sumas, 'actualizarEstadoCliente');
    expect(
      await service.procesarMonitoreoDesdeCorreo(solicitud()),
    ).toMatchObject({ decision: 'BLOQUEA', accion: 'solo_registrar' });
    expect(bloquear).not.toHaveBeenCalled();
  });
  it('modo activo bloquea la cédula una sola vez', async () => {
    process.env.DRY_RUN = 'false';
    jest.spyOn(service.fuente, 'consultar').mockResolvedValue(datos());
    const bloquear = jest.spyOn(sumas, 'actualizarEstadoCliente');
    const primera = await service.procesarMonitoreoDesdeCorreo(solicitud());
    const segunda = await service.procesarMonitoreoDesdeCorreo(solicitud());
    expect(primera).toMatchObject({ decision: 'BLOQUEA', accion: 'bloquear' });
    expect(segunda).toMatchObject({ ...primera, duplicado: true });
    expect(bloquear).toHaveBeenCalledTimes(1);
  });
  it('deduplica dos solicitudes simultáneas', async () => {
    process.env.DRY_RUN = 'false';
    const consultar = jest
      .spyOn(service.fuente, 'consultar')
      .mockResolvedValue(datos());
    const bloquear = jest.spyOn(sumas, 'actualizarEstadoCliente');
    const [a, b] = await Promise.all([
      service.procesarMonitoreoDesdeCorreo(solicitud()),
      service.procesarMonitoreoDesdeCorreo(solicitud()),
    ]);
    expect(a.decision).toBe('BLOQUEA');
    expect(b.duplicado).toBe(true);
    expect(consultar).toHaveBeenCalledTimes(1);
    expect(bloquear).toHaveBeenCalledTimes(1);
  });
  it('una reconsulta obtiene datos nuevos y puede pasar', async () => {
    const incompleto = datos();
    incompleto.datos!.correo = null;
    const mejorado = datos();
    mejorado.datos!.correo = { reportes: 6, entidades: 0 };
    const consultar = jest
      .spyOn(service.fuente, 'consultar')
      .mockResolvedValueOnce(incompleto)
      .mockResolvedValueOnce(mejorado);
    const primero = await service.procesarMonitoreoDesdeCorreo(solicitud());
    expect(primero).toMatchObject({
      decision: null,
      pendienteConsulta: true,
      reintentarEnMs: 10000,
    });
    jest.setSystemTime(INICIO + 10000);
    const segundo = await service.procesarMonitoreoDesdeCorreo(
      solicitud({ esReintento: true }),
    );
    expect(segundo.decision).toBe('PASA');
    expect(consultar).toHaveBeenCalledTimes(2);
    await service.procesarMonitoreoDesdeCorreo(
      solicitud({ esReintento: true }),
    );
    expect(consultar).toHaveBeenCalledTimes(2);
  });
  it('si siguen faltando contactos sin respaldo suficiente, bloquea tras la reconsulta', async () => {
    const d = datos();
    d.datos!.correo = null;
    jest.spyOn(service.fuente, 'consultar').mockResolvedValue(d);
    await service.procesarMonitoreoDesdeCorreo(solicitud());
    jest.setSystemTime(INICIO + 10000);
    expect(
      await service.procesarMonitoreoDesdeCorreo(
        solicitud({ esReintento: true }),
      ),
    ).toMatchObject({ decision: 'BLOQUEA', codigo: 'CONTACTOS_INCOMPLETOS' });
  });
  it('ausencia total tras dos consultas termina en revisión humana', async () => {
    const body = solicitud({ cedula: '9999999999' });
    expect(await service.procesarMonitoreoDesdeCorreo(body)).toMatchObject({
      pendienteConsulta: true,
    });
    jest.setSystemTime(INICIO + 10000);
    expect(
      await service.procesarMonitoreoDesdeCorreo(
        solicitud({ cedula: body.cedula, esReintento: true }),
      ),
    ).toMatchObject({ decision: 'ALERTA_HUMANA', codigo: 'SIN_INFORMACION' });
    expect(service.listarRevision()).toHaveLength(1);
  });
  it('un reintento adelantado no consume otra consulta', async () => {
    const d = datos();
    d.biometria = { disponible: false };
    const consultar = jest
      .spyOn(service.fuente, 'consultar')
      .mockResolvedValue(d);
    await service.procesarMonitoreoDesdeCorreo(solicitud());
    expect(
      await service.procesarMonitoreoDesdeCorreo(
        solicitud({ esReintento: true }),
      ),
    ).toMatchObject({ pendienteConsulta: true });
    expect(consultar).toHaveBeenCalledTimes(1);
  });
  it('no permite saltarse el primer intento', async () => {
    await expect(
      service.procesarMonitoreoDesdeCorreo(solicitud({ esReintento: true })),
    ).rejects.toThrow(BadRequestException);
  });
  it.each([180000, 181000])(
    'a los %i ms cierra sin consulta ni bloqueo',
    async (demora) => {
      process.env.DRY_RUN = 'false';
      jest.setSystemTime(INICIO + demora);
      const consultar = jest.spyOn(service.fuente, 'consultar');
      const bloquear = jest.spyOn(sumas, 'actualizarEstadoCliente');
      expect(
        await service.procesarMonitoreoDesdeCorreo(solicitud()),
      ).toMatchObject({ cerrada: true, decision: null, accion: 'ninguna' });
      expect(consultar).not.toHaveBeenCalled();
      expect(bloquear).not.toHaveBeenCalled();
    },
  );
  it('a los 179999 ms aún puede decidir en el simulador síncrono', async () => {
    process.env.DRY_RUN = 'false';
    jest.setSystemTime(INICIO + 179999);
    jest.spyOn(service.fuente, 'consultar').mockResolvedValue(datos());
    expect(
      await service.procesarMonitoreoDesdeCorreo(solicitud()),
    ).toMatchObject({ decision: 'BLOQUEA', accion: 'bloquear' });
  });
  it('si vence durante la consulta no ejecuta el bloqueo', async () => {
    process.env.DRY_RUN = 'false';
    jest.spyOn(service.fuente, 'consultar').mockImplementation(async () => {
      jest.setSystemTime(INICIO + 180000);
      return datos();
    });
    const bloquear = jest.spyOn(sumas, 'actualizarEstadoCliente');
    expect(
      await service.procesarMonitoreoDesdeCorreo(solicitud()),
    ).toMatchObject({ cerrada: true });
    expect(bloquear).not.toHaveBeenCalled();
  });
  it('una solicitud aprobada en origen se cierra sin evaluar', async () => {
    const consultar = jest.spyOn(service.fuente, 'consultar');
    expect(
      await service.procesarMonitoreoDesdeCorreo(
        solicitud({ estadoSolicitud: 'APROBADA' }),
      ),
    ).toMatchObject({ cerrada: true, codigo: 'ORIGEN_APROBADA' });
    expect(consultar).not.toHaveBeenCalled();
  });
  it('una decisión PASA no se cambia ni bloquea después', async () => {
    const d = datos();
    d.datos!.celular!.reportes = 6;
    const consulta = jest
      .spyOn(service.fuente, 'consultar')
      .mockResolvedValueOnce(d)
      .mockResolvedValue(datos());
    await service.procesarMonitoreoDesdeCorreo(solicitud());
    process.env.DRY_RUN = 'false';
    jest.setSystemTime(INICIO + 200000);
    expect(
      await service.procesarMonitoreoDesdeCorreo(solicitud()),
    ).toMatchObject({ decision: 'PASA', duplicado: true });
    expect(consulta).toHaveBeenCalledTimes(1);
  });
  it('revisión humana deja de aparecer al vencer', async () => {
    const d = datos();
    d.datos!.correo!.reportes = 6;
    d.biometria = { disponible: true, proveedor: 'veriff', estado: 'review' };
    jest.spyOn(service.fuente, 'consultar').mockResolvedValue(d);
    await service.procesarMonitoreoDesdeCorreo(solicitud());
    expect(service.listarRevision()).toHaveLength(1);
    jest.setSystemTime(INICIO + 180000);
    expect(service.listarRevision()).toHaveLength(0);
    expect(
      await service.procesarMonitoreoDesdeCorreo(solicitud()),
    ).toMatchObject({ cerrada: true });
  });
  it('persiste deduplicación al reiniciar sin volver a bloquear', async () => {
    process.env.DRY_RUN = 'false';
    jest.spyOn(service.fuente, 'consultar').mockResolvedValue(datos());
    const bloquear = jest.spyOn(sumas, 'actualizarEstadoCliente');
    await service.procesarMonitoreoDesdeCorreo(solicitud());
    const reiniciado = new DecisionService(sumas);
    expect(
      await reiniciado.procesarMonitoreoDesdeCorreo(solicitud()),
    ).toMatchObject({ duplicado: true });
    expect(bloquear).toHaveBeenCalledTimes(1);
  });
  it('persiste el plazo del reintento al reiniciar', async () => {
    const d = datos();
    d.biometria = { disponible: false };
    jest.spyOn(service.fuente, 'consultar').mockResolvedValue(d);
    await service.procesarMonitoreoDesdeCorreo(solicitud());
    jest.setSystemTime(INICIO + 180000);
    const reiniciado = new DecisionService(sumas);
    expect(
      await reiniciado.procesarMonitoreoDesdeCorreo(
        solicitud({ esReintento: true }),
      ),
    ).toMatchObject({ cerrada: true });
  });
  it('rechaza cambiar la hora para reiniciar los tres minutos', async () => {
    jest.spyOn(service.fuente, 'consultar').mockResolvedValue(datos());
    await service.procesarMonitoreoDesdeCorreo(solicitud());
    jest.setSystemTime(INICIO + 10000);
    await expect(
      service.procesarMonitoreoDesdeCorreo(
        solicitud({ solicitudTomadaEn: new Date().toISOString() }),
      ),
    ).rejects.toThrow(ConflictException);
  });
  it('rechaza reutilizar transactionId con otra cédula', async () => {
    jest.spyOn(service.fuente, 'consultar').mockResolvedValue(datos());
    await service.procesarMonitoreoDesdeCorreo(solicitud());
    await expect(
      service.procesarMonitoreoDesdeCorreo(solicitud({ cedula: '1001001001' })),
    ).rejects.toThrow(ConflictException);
  });
  it.each([
    { esReintento: 'false' },
    { valorCredito: -1 },
    { solicitudTomadaEn: '' },
    { transactionId: '' },
    { solicitudTomadaEn: '2027-01-01T00:00:00Z' },
  ])('rechaza entrada inválida %j', async (extra) => {
    await expect(
      service.procesarMonitoreoDesdeCorreo(
        solicitud(extra as Partial<DesdeCorreoDto>),
      ),
    ).rejects.toThrow(BadRequestException);
  });
  it('fallo de fuente se reintenta una vez y luego se revisa sin confundirlo con cero', async () => {
    const consultar = jest
      .spyOn(service.fuente, 'consultar')
      .mockRejectedValue(new Error('No disponible'));
    await service.procesarMonitoreoDesdeCorreo(solicitud());
    jest.setSystemTime(INICIO + 10000);
    expect(
      await service.procesarMonitoreoDesdeCorreo(
        solicitud({ esReintento: true }),
      ),
    ).toMatchObject({
      decision: 'ALERTA_HUMANA',
      codigo: 'FUENTE_NO_DISPONIBLE',
    });
    expect(consultar).toHaveBeenCalledTimes(2);
  });
  it('timeout de consulta vuelve al cliente sin esperar más de 20 segundos', async () => {
    jest
      .spyOn(service.fuente, 'consultar')
      .mockImplementation(() => new Promise(() => undefined));
    const pendiente = service.procesarMonitoreoDesdeCorreo(solicitud());
    await jest.advanceTimersByTimeAsync(20000);
    expect(await pendiente).toMatchObject({ pendienteConsulta: true });
  });
  it('un fallo al bloquear no se informa como bloqueo confirmado ni se repite', async () => {
    process.env.DRY_RUN = 'false';
    jest.spyOn(service.fuente, 'consultar').mockResolvedValue(datos());
    const bloquear = jest
      .spyOn(service.fuente, 'bloquear')
      .mockImplementation(() => {
        throw new Error('Fallo');
      });
    expect(
      await service.procesarMonitoreoDesdeCorreo(solicitud()),
    ).toMatchObject({
      decision: 'ALERTA_HUMANA',
      codigo: 'BLOQUEO_NO_CONFIRMADO',
      accion: 'ninguna',
    });
    await service.procesarMonitoreoDesdeCorreo(solicitud());
    expect(bloquear).toHaveBeenCalledTimes(1);
  });
  it('estado persistido corrupto no se borra ni inicia un plazo nuevo', async () => {
    fs.writeFileSync(path.join(directorio, 'solicitudes.json'), 'corrupto');
    const consultar = jest.spyOn(service.fuente, 'consultar');
    await expect(
      service.procesarMonitoreoDesdeCorreo(solicitud()),
    ).rejects.toThrow('No se pudo leer');
    expect(consultar).not.toHaveBeenCalled();
  });
  it('logs y estado no guardan la cédula completa', async () => {
    jest.spyOn(service.fuente, 'consultar').mockResolvedValue(datos());
    await service.procesarMonitoreoDesdeCorreo(solicitud());
    for (const archivo of ['solicitudes.json', 'decisiones.jsonl']) {
      const contenido = fs.readFileSync(path.join(directorio, archivo), 'utf8');
      expect(contenido).not.toContain('2002002002');
      expect(contenido).toContain('*******002');
    }
  });
  it.each(['monitoreo', 'onboarding', 'cambio_datos'])(
    'ruta operativa disponible para %s',
    async (proceso) => {
      const d = datos();
      d.datos!.correo!.reportes = 6;
      jest.spyOn(service.fuente, 'consultar').mockResolvedValue(d);
      const controller = new DecisionController(service);
      expect(
        (await controller.procesarSolicitud(proceso, solicitud())).decision,
      ).toBe(proceso === 'cambio_datos' ? 'ALERTA_HUMANA' : 'PASA');
    },
  );
});

describe('Workflow n8n', () => {
  const workflow = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../simulador-correo.workflow.json'),
      'utf8',
    ),
  );
  const codigo = workflow.nodes.find(
    (n: { name: string }) => n.name === 'Preparar solicitud',
  ).parameters.jsCode;
  /* oxlint-disable typescript/no-implied-eval -- Ejecuta exclusivamente el código estático local del workflow en esta prueba. */
  const preparar = (json: unknown) =>
    new Function('$input', codigo)({ first: () => ({ json }) });
  /* oxlint-enable typescript/no-implied-eval */
  it('el archivo JSON y las conexiones apuntan a nodos existentes', () => {
    const nombres = new Set(
      workflow.nodes.map((n: { name: string }) => n.name),
    );
    for (const [origen, conexion] of Object.entries(workflow.connections) as [
      string,
      { main: { node: string }[][] },
    ][]) {
      expect(nombres.has(origen)).toBe(true);
      for (const salidas of conexion.main)
        for (const salida of salidas)
          expect(nombres.has(salida.node)).toBe(true);
    }
  });
  it('preserva la fecha original del simulador', () => {
    const resultado = preparar({
      body: {
        fecha: solicitud().solicitudTomadaEn,
        datosExtraidos: solicitud(),
      },
    });
    expect(resultado[0].json.solicitudTomadaEn).toBe(
      solicitud().solicitudTomadaEn,
    );
  });
  it('un correo real sin fecha original falla en vez de inventar un plazo nuevo', () => {
    expect(() =>
      preparar({ cedula: '123', transactionId: 'T', valorCredito: 10 }),
    ).toThrow('Falta hora ORIGINAL');
  });
  it('la ejecución manual genera una solicitud de demostración válida', () => {
    expect(preparar({})[0].json).toMatchObject({
      cedula: '1001001001',
      esReintento: false,
    });
  });
  it('ambas llamadas usan el mismo origen y la reconsulta tiene esReintento=true', () => {
    const reconsulta = workflow.nodes.find(
      (n: { name: string }) => n.name === 'Reconsultar una vez',
    );
    expect(reconsulta.parameters.jsonBody).toContain(
      "$('Preparar solicitud').item.json",
    );
    expect(reconsulta.parameters.jsonBody).toContain('esReintento: true');
  });
});

describe('Cierre recibido durante la consulta', () => {
  it('una aprobación notificada mientras se consulta impide el bloqueo', async () => {
    process.env.DRY_RUN = 'false';
    let resolver!: (dto: AlertaDto) => void;
    jest.spyOn(service.fuente, 'consultar').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolver = resolve;
        }),
    );
    const bloquear = jest.spyOn(service.fuente, 'bloquear');
    const evaluacion = service.procesarMonitoreoDesdeCorreo(solicitud());
    const cierre = service.procesarMonitoreoDesdeCorreo(
      solicitud({ estadoSolicitud: 'APROBADA' }),
    );
    resolver(datos());
    expect(await evaluacion).toMatchObject({
      cerrada: true,
      codigo: 'ORIGEN_APROBADA',
    });
    expect(await cierre).toMatchObject({ cerrada: true });
    expect(bloquear).not.toHaveBeenCalled();
  });
});

describe('Recuperación de acciones interrumpidas', () => {
  it('una intención de bloqueo persistida nunca se repite a ciegas tras reiniciar', async () => {
    jest.spyOn(service.fuente, 'consultar').mockResolvedValue(datos());
    await service.procesarMonitoreoDesdeCorreo(solicitud());
    const archivo = path.join(directorio, 'solicitudes.json');
    const estado = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    estado.estados[0].fase = 'ACCION_INCIERTA';
    fs.writeFileSync(archivo, JSON.stringify(estado));
    process.env.DRY_RUN = 'false';
    const reiniciado = new DecisionService(sumas);
    const bloquear = jest.spyOn(reiniciado.fuente, 'bloquear');
    expect(
      await reiniciado.procesarMonitoreoDesdeCorreo(solicitud()),
    ).toMatchObject({ decision: 'ALERTA_HUMANA', accion: 'ninguna' });
    expect(bloquear).not.toHaveBeenCalled();
  });
  it('no convierte una simulación pendiente en bloqueo activo al cambiar DRY_RUN', async () => {
    const d = datos();
    d.biometria = { disponible: false };
    jest.spyOn(service.fuente, 'consultar').mockResolvedValue(d);
    await service.procesarMonitoreoDesdeCorreo(solicitud());
    process.env.DRY_RUN = 'false';
    jest.setSystemTime(INICIO + 10000);
    const bloquear = jest.spyOn(service.fuente, 'bloquear');
    expect(
      await service.procesarMonitoreoDesdeCorreo(
        solicitud({ esReintento: true }),
      ),
    ).toMatchObject({
      decision: 'BLOQUEA',
      dryRun: true,
      accion: 'solo_registrar',
    });
    expect(bloquear).not.toHaveBeenCalled();
  });
});
