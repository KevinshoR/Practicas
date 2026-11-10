import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { AlertaDto, DesdeCorreoDto } from './alerta.dto';
import type { Proceso } from './alerta.dto';
import { SumasService } from '../sumas/sumas.service';
import { FuenteSumas } from './fuente-sumas';
import {
  CONFIG,
  evaluarReglas,
  informacionIncompleta,
  VERSION_REGLAS,
} from './reglas';
import { EstadoSolicitudes, hash } from './estado-solicitudes';
import type { EstadoSolicitud, RespuestaMotor } from './estado-solicitudes';
import { validarAlerta, validarProceso, validarSolicitud } from './validacion';
export type { AccionMotor } from './estado-solicitudes';

function cargarEnv() {
  const archivo = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(archivo)) return;
  for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const match = linea.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }
}
cargarEnv();

@Injectable()
export class DecisionService {
  readonly fuente: FuenteSumas;
  private readonly estados = new EstadoSolicitudes();
  private readonly enCurso = new Map<string, Promise<RespuestaMotor>>();
  private readonly cierresEnCurso = new Map<string, string>();

  constructor(@Optional() sumas?: SumasService) {
    this.fuente = new FuenteSumas(sumas ?? new SumasService());
  }
  /** Vista previa pura para la pantalla existente; no consume plazo ni bloquea. */
  evaluarRiesgo(dto: AlertaDto, proceso: string) {
    return evaluarReglas(dto, proceso);
  }
  evaluarCambioDatos(dto: AlertaDto) {
    return evaluarReglas(dto, 'cambio_datos');
  }
  esDryRun() {
    return process.env.DRY_RUN?.trim().toLowerCase() !== 'false';
  }
  enmascararCedula(cedula: string) {
    const valor = cedula.trim();
    return valor.length <= 3
      ? '***'
      : '*'.repeat(valor.length - 3) + valor.slice(-3);
  }
  private respuesta(
    estado: EstadoSolicitud,
    codigo: string,
    motivo: string,
  ): RespuestaMotor {
    return {
      transactionId: estado.transactionId,
      proceso: estado.proceso,
      decision: null,
      tipoBloqueo: null,
      codigo,
      motivo,
      senales: [],
      dryRun: estado.dryRun,
      accion: 'ninguna',
      venceEn: new Date(estado.vence).toISOString(),
      versionReglas: VERSION_REGLAS,
      entorno: 'simulador',
    };
  }
  private finalizar(
    estado: EstadoSolicitud,
    respuesta: RespuestaMotor,
    fase: EstadoSolicitud['fase'],
  ) {
    estado.fase = fase;
    estado.respuesta = respuesta;
    this.estados.guardar(estado);
    if (!this.estados.auditar(estado)) respuesta.auditoriaPendiente = true;
    return respuesta;
  }
  private cerrar(estado: EstadoSolicitud, codigo = 'PLAZO_VENCIDO') {
    return this.finalizar(
      estado,
      {
        ...this.respuesta(
          estado,
          codigo,
          codigo === 'PLAZO_VENCIDO'
            ? 'Tres minutos cumplidos: cierre sin acción tardía; no confirma desembolso'
            : 'Solicitud ya resuelta en origen: seguimiento cerrado sin acción',
        ),
        cerrada: true,
      },
      'CERRADA',
    );
  }
  listarRevision() {
    const pendientes: {
      id: string;
      transactionId: string;
      venceEn: string;
      resultado: RespuestaMotor;
    }[] = [];
    for (const estado of this.estados.listar()) {
      if (!['REVISION', 'ACCION_INCIERTA'].includes(estado.fase)) continue;
      if (Date.now() >= estado.vence) {
        this.cerrar(estado);
        continue;
      }
      const resultado = estado.respuesta ?? {
        ...this.respuesta(
          estado,
          'ACCION_INCIERTA',
          'Verificar si la acción previa se aplicó; no repetir automáticamente',
        ),
        decision: 'ALERTA_HUMANA' as const,
      };
      pendientes.push({
        id: estado.transactionId,
        transactionId: estado.transactionId,
        venceEn: resultado.venceEn,
        resultado,
      });
    }
    return pendientes;
  }
  procesarMonitoreoDesdeCorreo(body: DesdeCorreoDto) {
    return this.procesarSolicitud(body, 'monitoreo');
  }

  async procesarSolicitud(
    body: DesdeCorreoDto,
    proceso: string,
  ): Promise<RespuestaMotor> {
    validarProceso(proceso);
    validarSolicitud(body, Date.now());
    const limpio: DesdeCorreoDto = {
      cedula: body.cedula.trim(),
      transactionId: body.transactionId.trim(),
      valorCredito: body.valorCredito,
      creCredito: body.creCredito,
      solicitudTomadaEn: body.solicitudTomadaEn,
      esReintento: body.esReintento,
      soloSimulacion: body.soloSimulacion,
      estadoSolicitud: body.estadoSolicitud,
    };
    // Una notificación de aprobación puede llegar mientras la consulta está en curso.
    // No debe esperar detrás de esa consulta para impedir un bloqueo.
    if (
      this.enCurso.has(limpio.transactionId) &&
      limpio.estadoSolicitud &&
      limpio.estadoSolicitud !== 'PENDIENTE'
    ) {
      const actual = this.estados.obtener(limpio.transactionId);
      const huella = hash(
        JSON.stringify([
          limpio.cedula,
          proceso,
          limpio.valorCredito,
          Date.parse(limpio.solicitudTomadaEn),
          limpio.creCredito ?? '',
        ]),
      );
      if (actual && actual.huella !== huella)
        throw new ConflictException(
          'Notificación de cierre no corresponde a la solicitud',
        );
      this.cierresEnCurso.set(
        limpio.transactionId,
        `ORIGEN_${limpio.estadoSolicitud}`,
      );
    }
    // Serializa la misma transacción dentro de la única instancia soportada.
    while (this.enCurso.has(limpio.transactionId)) {
      await this.enCurso.get(limpio.transactionId)!.catch(() => undefined);
    }
    const promesa = this.procesar(limpio, proceso);
    this.enCurso.set(limpio.transactionId, promesa);
    try {
      return await promesa;
    } finally {
      this.enCurso.delete(limpio.transactionId);
      this.cierresEnCurso.delete(limpio.transactionId);
    }
  }
  private async procesar(
    body: DesdeCorreoDto,
    proceso: Proceso,
  ): Promise<RespuestaMotor> {
    const inicio = Date.parse(body.solicitudTomadaEn);
    const huella = hash(
      JSON.stringify([
        body.cedula,
        proceso,
        body.valorCredito,
        inicio,
        body.creCredito ?? '',
      ]),
    );
    let estado = this.estados.obtener(body.transactionId);
    if (body.soloSimulacion && (!this.esDryRun() || estado?.dryRun === false)) {
      throw new ConflictException(
        'El disparador exige DRY_RUN=true; no se ejecutó ninguna acción',
      );
    }
    if (estado && estado.huella !== huella)
      throw new ConflictException(
        'transactionId reutilizado con otra cédula, monto, proceso o fecha',
      );
    if (!estado) {
      if (body.esReintento)
        throw new BadRequestException(
          'No existe primer intento para esta transacción',
        );
      estado = {
        transactionId: body.transactionId,
        huella,
        cedulaEnmascarada: this.enmascararCedula(body.cedula),
        proceso,
        inicio,
        vence: inicio + CONFIG.PLAZO_MS,
        dryRun: this.esDryRun(),
        consultas: 0,
        fase: 'NUEVA',
      };
      this.estados.guardar(estado);
    }
    if (['FINAL', 'CERRADA'].includes(estado.fase))
      return { ...estado.respuesta!, duplicado: true };
    if (body.estadoSolicitud && body.estadoSolicitud !== 'PENDIENTE')
      return this.cerrar(estado, `ORIGEN_${body.estadoSolicitud}`);
    if (Date.now() >= estado.vence) return this.cerrar(estado);
    if (estado.fase === 'REVISION')
      return { ...estado.respuesta!, duplicado: true };
    if (estado.fase === 'ACCION_INCIERTA' || estado.fase === 'CONSULTANDO') {
      return this.finalizar(
        estado,
        {
          ...this.respuesta(
            estado,
            'INTENTO_INTERRUMPIDO',
            'Intento interrumpido: verificar manualmente sin repetir una posible acción',
          ),
          decision: 'ALERTA_HUMANA',
        },
        'REVISION',
      );
    }
    if (estado.fase === 'REINTENTO') {
      if (!body.esReintento || Date.now() < (estado.reintentarDesde ?? 0))
        return {
          ...estado.respuesta!,
          duplicado: !body.esReintento,
          reintentarEnMs: Math.max(
            0,
            (estado.reintentarDesde ?? 0) - Date.now(),
          ),
        };
    }
    estado.consultas += 1;
    estado.fase = 'CONSULTANDO';
    this.estados.guardar(estado);
    let dto: AlertaDto | undefined;
    let falloConsulta = false;
    const timeoutMs = Math.min(20_000, Math.max(1, estado.vence - Date.now()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      dto = await Promise.race([
        this.fuente.consultar(body, proceso),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Consulta vencida')),
            timeoutMs,
          );
        }),
      ]);
      validarAlerta(dto);
      if (
        dto.alerta.transactionId !== body.transactionId ||
        dto.alerta.monto !== body.valorCredito
      )
        throw new Error('Consulta no corresponde a la solicitud');
    } catch {
      falloConsulta = true;
      dto = undefined;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (Date.now() >= estado.vence) return this.cerrar(estado);
    const cierreExterno = this.cierresEnCurso.get(estado.transactionId);
    if (cierreExterno) return this.cerrar(estado, cierreExterno);
    const necesitaReintento =
      falloConsulta ||
      !dto ||
      informacionIncompleta(dto) ||
      !dto.biometria?.disponible;
    if (estado.consultas === 1 && necesitaReintento) {
      // Si queda poco plazo, se reintenta antes. Nunca se extiende la fecha original.
      const espera = Math.min(
        CONFIG.REINTENTO_MS,
        Math.max(0, estado.vence - Date.now() - 1000),
      );
      estado.reintentarDesde = Date.now() + espera;
      return this.finalizar(
        estado,
        {
          ...this.respuesta(
            estado,
            'REINTENTO_REQUERIDO',
            'Reconsultar una sola vez los datos y la biometría',
          ),
          pendienteConsulta: true,
          pendienteBiometria: !dto?.biometria?.disponible,
          reintentarEnMs: espera,
        },
        'REINTENTO',
      );
    }
    if (!dto || falloConsulta)
      return this.finalizar(
        estado,
        {
          ...this.respuesta(
            estado,
            'FUENTE_NO_DISPONIBLE',
            'No se pudo obtener una respuesta válida tras dos consultas',
          ),
          decision: 'ALERTA_HUMANA',
        },
        'REVISION',
      );
    const evaluacion = evaluarReglas(dto, proceso);
    let respuesta: RespuestaMotor = {
      ...this.respuesta(estado, evaluacion.codigo, evaluacion.motivo),
      ...evaluacion,
      accion:
        evaluacion.decision === 'BLOQUEA'
          ? estado.dryRun
            ? 'solo_registrar'
            : 'bloquear'
          : 'ninguna',
    };
    if (Date.now() >= estado.vence) return this.cerrar(estado);
    if (evaluacion.decision === 'BLOQUEA' && !estado.dryRun) {
      // Persistir intención antes del efecto evita repetirlo a ciegas tras un reinicio.
      estado.fase = 'ACCION_INCIERTA';
      estado.respuesta = { ...respuesta, accion: 'ninguna' };
      this.estados.guardar(estado);
      if (Date.now() >= estado.vence) return this.cerrar(estado);
      try {
        if (!this.fuente.bloquear(body, evaluacion, estado.vence))
          return this.cerrar(estado);
      } catch {
        respuesta = {
          ...respuesta,
          decision: 'ALERTA_HUMANA',
          tipoBloqueo: null,
          accion: 'ninguna',
          codigo: 'BLOQUEO_NO_CONFIRMADO',
          motivo:
            'No se confirmó el bloqueo; verificar sin repetir automáticamente',
        };
        return this.finalizar(estado, respuesta, 'REVISION');
      }
    }
    return this.finalizar(
      estado,
      respuesta,
      evaluacion.decision === 'ALERTA_HUMANA' ? 'REVISION' : 'FINAL',
    );
  }
}
