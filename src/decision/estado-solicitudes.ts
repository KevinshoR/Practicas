import { ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { Decision, Proceso, TipoBloqueo } from './alerta.dto';
import type { Evaluacion } from './reglas';

export type AccionMotor = 'ninguna' | 'solo_registrar' | 'bloquear';
export interface RespuestaMotor {
  transactionId: string;
  proceso: Proceso;
  decision: Decision | null;
  tipoBloqueo: TipoBloqueo;
  codigo: string;
  motivo: string;
  senales: string[];
  dryRun: boolean;
  accion: AccionMotor;
  venceEn: string;
  versionReglas: string;
  entorno: 'simulador';
  evidencia?: Evaluacion['evidencia'];
  evaluacionSugerida?: Evaluacion['evaluacionSugerida'];
  pendienteConsulta?: boolean;
  pendienteBiometria?: boolean;
  reintentarEnMs?: number;
  cerrada?: boolean;
  duplicado?: boolean;
  auditoriaPendiente?: boolean;
}
export interface EstadoSolicitud {
  transactionId: string;
  huella: string;
  cedulaEnmascarada: string;
  proceso: Proceso;
  inicio: number;
  vence: number;
  dryRun: boolean;
  consultas: number;
  fase:
    | 'NUEVA'
    | 'CONSULTANDO'
    | 'REINTENTO'
    | 'ACCION_INCIERTA'
    | 'FINAL'
    | 'REVISION'
    | 'CERRADA';
  reintentarDesde?: number;
  respuesta?: RespuestaMotor;
}
export const hash = (valor: string) =>
  createHash('sha256').update(valor).digest('hex');

/** Almacén local para UNA instancia del simulador. No es una base distribuida.
 * Conserva el plazo y la deduplicación al reiniciar. Nunca guarda contactos ni la cédula completa. */
export class EstadoSolicitudes {
  private estados = new Map<string, EstadoSolicitud>();
  private cargado = false;
  readonly directorio: string;
  private readonly archivo: string;

  constructor() {
    this.directorio = path.resolve(
      process.env.ANTIFRAUDE_STATE_DIR ||
        path.join(process.cwd(), 'logs', 'antifraude'),
    );
    this.archivo = path.join(this.directorio, 'solicitudes.json');
  }
  private cargar() {
    if (this.cargado) return;
    try {
      if (fs.existsSync(this.archivo)) {
        const contenido = JSON.parse(fs.readFileSync(this.archivo, 'utf8'));
        if (contenido.version !== 1 || !Array.isArray(contenido.estados))
          throw new Error('Formato no reconocido');
        for (const e of contenido.estados as EstadoSolicitud[]) {
          if (
            !e ||
            typeof e.transactionId !== 'string' ||
            typeof e.huella !== 'string' ||
            !Number.isFinite(e.vence) ||
            !Number.isFinite(e.inicio) ||
            ![
              'NUEVA',
              'CONSULTANDO',
              'REINTENTO',
              'ACCION_INCIERTA',
              'FINAL',
              'REVISION',
              'CERRADA',
            ].includes(e.fase)
          ) {
            throw new Error('Estado inválido');
          }
          this.estados.set(e.transactionId, e);
        }
      }
      this.cargado = true;
    } catch {
      this.estados.clear();
      throw new ServiceUnavailableException(
        'No se pudo leer el estado antifraude; no se reinician plazos ni se ejecutan acciones',
      );
    }
  }
  obtener(id: string) {
    this.cargar();
    const e = this.estados.get(id);
    return e ? structuredClone(e) : undefined;
  }
  listar() {
    this.cargar();
    return [...this.estados.values()].map((e) => structuredClone(e));
  }
  guardar(estado: EstadoSolicitud) {
    this.cargar();
    const copia = new Map(this.estados);
    copia.set(estado.transactionId, structuredClone(estado));
    const temporal = `${this.archivo}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(this.directorio, { recursive: true, mode: 0o700 });
      const fd = fs.openSync(temporal, 'wx', 0o600);
      try {
        fs.writeFileSync(
          fd,
          JSON.stringify({ version: 1, estados: [...copia.values()] }),
          'utf8',
        );
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temporal, this.archivo);
      this.estados = copia;
    } catch {
      if (fs.existsSync(temporal)) fs.unlinkSync(temporal);
      throw new ServiceUnavailableException(
        'No se pudo persistir la decisión; no ejecutar acciones nuevas',
      );
    }
  }
  auditar(estado: EstadoSolicitud): boolean {
    try {
      fs.appendFileSync(
        path.join(this.directorio, 'decisiones.jsonl'),
        JSON.stringify({
          hora: new Date().toISOString(),
          cedula: estado.cedulaEnmascarada,
          consultas: estado.consultas,
          fase: estado.fase,
          ...estado.respuesta,
        }) + '\n',
        { encoding: 'utf8', mode: 0o600 },
      );
      return true;
    } catch {
      return false;
    } // La respuesta ya está persistida en solicitudes.json.
  }
}
