import { Injectable, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { AlertaDto, DesdeCorreoDto } from './alerta.dto';
import { SumasService } from '../sumas/sumas.service';

type Calidad = 'buena' | 'baja' | 'rechazada' | 'duda' | 'sin_biometria';
type Contacto = { reportes: number; entidades: number };
type Decision = 'PASA' | 'BLOQUEA' | 'ALERTA_HUMANA';
type TipoBloqueo = 'datos' | 'biometria' | null;
export type AccionMotor = 'ninguna' | 'solo_registrar' | 'bloquear';

const CONFIG = {
  MONTO_ESTRICTO: 1_000_000,
  CONSUMO_ESTRICTO_PCT: 95,
  UNICUS_NORMAL: 5,
  UNICUS_ESTRICTO: 7,
  MIN_REPORTES_22: 2,
  MIN_ENTIDADES_22: 2,
  RESPALDO_MINIMO: 1,
  ONBOARDING_MIN_EN_AMBOS: 1,
  ONBOARDING_MIN_EN_ALGUNO: 3,
  // Lista de revisión reforzada: sube a modo estricto, no bloquea por sí sola
  ZONAS_REVISION_REFORZADA: [
    'barranquilla', 'cartagena', 'santa marta', 'soledad', 'malambo',
    'valledupar', 'monteria', 'sincelejo', 'riohacha',
  ],
};

const norm = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Carga ligera de .env en process.env si aún no fue cargado por @nestjs/config o Node
function asegurarCargaEnv() {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    const contenido = fs.readFileSync(envPath, 'utf8');
    for (const linea of contenido.split(/\r?\n/)) {
      const limpia = linea.trim();
      if (!limpia || limpia.startsWith('#')) continue;
      const idx = limpia.indexOf('=');
      if (idx === -1) continue;
      const clave = limpia.slice(0, idx).trim();
      const valor = limpia.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (process.env[clave] === undefined) {
        process.env[clave] = valor;
      }
    }
  } catch {
    // Si no existe .env, se usa el valor por defecto DRY_RUN=true
  }
}

asegurarCargaEnv();

@Injectable()
export class DecisionService {
  private cola: any[] = [];
  private transaccionesProcesadas = new Set<string>();
  private readonly sumasService: SumasService;

  constructor(@Optional() sumasService?: SumasService) {
    // Fallback por si un test unitario existente instancia new DecisionService() sin argumentos
    this.sumasService = sumasService ?? new SumasService();
  }

  private calidadBiometria(b: AlertaDto['biometria'], estricto: boolean): Calidad {
    if (!b?.disponible) return 'sin_biometria';
    const estado = norm(b.estado ?? '');
    if (b.proveedor === 'veriff') {
      if (['aprobado', 'approved'].includes(estado)) return 'buena';
      if (['rechazado', 'declined'].includes(estado)) return 'rechazada';
      if (['expirado', 'expired', 'abandonado', 'abandoned'].includes(estado)) return 'sin_biometria';
      return 'duda'; // review, resubmission_requested y cualquier otro
    }
    if (b.proveedor === 'unicus') {
      const min = estricto ? CONFIG.UNICUS_ESTRICTO : CONFIG.UNICUS_NORMAL;
      return (b.nivelUnicus ?? 0) >= min ? 'buena' : 'baja';
    }
    return 'duda';
  }

  evaluarRiesgo(dto: AlertaDto, proceso: string) {
    const { alerta, datos, biometria, historial, ciudadesFrecuentes } = dto;
    const cel: Contacto = { reportes: datos?.celular?.reportes ?? 0, entidades: datos?.celular?.entidades ?? 0 };
    const cor: Contacto = { reportes: datos?.correo?.reportes ?? 0, entidades: datos?.correo?.entidades ?? 0 };
    const monto = alerta?.monto ?? 0;
    const consumo = historial?.consumo_pct ?? 0;
    const ciudad = norm(alerta?.ciudadOrigen ?? '');
    const frecuentes = (ciudadesFrecuentes ?? []).map(norm);

    // Modo estricto
    const motivosEstricto: string[] = [];
    if (monto >= CONFIG.MONTO_ESTRICTO) motivosEstricto.push('monto de 1 millón o más');
    if (consumo >= CONFIG.CONSUMO_ESTRICTO_PCT) motivosEstricto.push('consumo del cupo de 95% o más');
    if (ciudad !== '' && CONFIG.ZONAS_REVISION_REFORZADA.map(norm).includes(ciudad)) {
      motivosEstricto.push('ciudad en lista de revisión reforzada');
    }
    const estricto = motivosEstricto.length > 0;
    const modo = estricto ? `estricto: ${motivosEstricto.join(', ')}` : 'normal';

    // Respaldo: ubicación coincide o compras anteriores en Sumas
    const hayCiudades = frecuentes.length > 0;
    const ubicacionCoincide = ciudad !== '' && hayCiudades && frecuentes.includes(ciudad);
    const compras = historial?.comprasPrevias ?? historial?.creditosActivos ?? 0;
    const historialFavorable = compras >= 1;
    const respaldo = (ubicacionCoincide ? 1 : 0) + (historialFavorable ? 1 : 0);
    const respaldoSuficiente = respaldo >= CONFIG.RESPALDO_MINIMO;
    const cumple22 = (c: Contacto) =>
      c.reportes >= CONFIG.MIN_REPORTES_22 && c.entidades >= CONFIG.MIN_ENTIDADES_22;

    // Señales para el analista (no deciden por sí solas)
    const senales: string[] = [];
    if (!hayCiudades) senales.push('Cliente sin ciudades registradas: se valida por datos y biometría');
    else if (ciudad !== '' && !ubicacionCoincide) senales.push('Ubicación de la compra sin coincidencia con las ciudades del cliente');
    if (!historialFavorable) senales.push('Sin compras anteriores en Sumas');
    if ((datos?.direccion?.reportes ?? 0) === 0) senales.push('Dirección sin reportes');

    const r = (decision: Decision, tipoBloqueo: TipoBloqueo, motivo: string) => ({
      decision, tipoBloqueo, motivo: `[${modo}] ${motivo}`, senales, proceso,
    });

    // 1. 0-0 en celular y correo: bloqueo inmediato
    if (cel.reportes === 0 && cor.reportes === 0) {
      return r('BLOQUEA', 'datos', 'Celular y correo sin reportes (0-0)');
    }

    // 2. Onboarding: cliente nuevo para Sumas
    if (proceso === 'onboarding') {
      const ambos =
        cel.reportes >= CONFIG.ONBOARDING_MIN_EN_AMBOS && cor.reportes >= CONFIG.ONBOARDING_MIN_EN_AMBOS;
      const alguno = Math.max(cel.reportes, cor.reportes) >= CONFIG.ONBOARDING_MIN_EN_ALGUNO;
      if (!ambos || !alguno) {
        return r('BLOQUEA', 'datos', 'Onboarding: se exige al menos 1 reporte en celular y correo, y 3 en alguno de los dos');
      }
    }

    const calidad = this.calidadBiometria(biometria, estricto);

    // 3. Sin biometría (n8n ya esperó 5 minutos)
    if (calidad === 'sin_biometria') {
      if (proceso === 'onboarding' && !estricto) {
        return r('PASA', null, 'Onboarding sin biometría; datos principales suficientes');
      }
      return cumple22(cel) && cumple22(cor)
        ? r('PASA', null, 'Sin biometría; celular y correo cumplen 2-2')
        : r('BLOQUEA', 'datos', 'Sin biometría; celular o correo no cumplen 2-2');
    }

    // 4. Biometría dudosa, rechazada o baja
    if (calidad === 'duda') return r('ALERTA_HUMANA', null, 'Biometría en revisión o inconclusa');
    if (calidad === 'rechazada') {
      senales.push('El proveedor rechazó la biometría');
      return respaldoSuficiente
        ? r('ALERTA_HUMANA', null, 'Biometría rechazada por el proveedor; hay respaldo, requiere revisión humana')
        : r('BLOQUEA', 'biometria', 'Biometría rechazada por el proveedor sin respaldo suficiente');
    }
    if (calidad === 'baja') {
      return respaldoSuficiente
        ? r('PASA', null, 'Biometría baja respaldada por ubicación o historial')
        : r('BLOQUEA', 'biometria', 'Biometría baja sin respaldo suficiente');
    }

    // 5. Biometría buena: un dato principal en 0 exige respaldo (en cualquier modo)
    if (cel.reportes < 1 || cor.reportes < 1) {
      return respaldoSuficiente
        ? r('PASA', null, 'Un dato principal en 0, respaldado por ubicación o historial')
        : r('BLOQUEA', 'datos', 'Un dato principal en 0 sin respaldo suficiente');
    }
    return r('PASA', null, estricto ? 'Estricto superado: biometría buena' : 'Biometría buena y datos principales con reportes');
  }

  evaluarCambioDatos(_dto: AlertaDto) {
    return {
      decision: 'ALERTA_HUMANA' as Decision,
      tipoBloqueo: null as TipoBloqueo,
      motivo: 'Cambio de datos: verificar manualmente que la línea telefónica siga activa',
      senales: [] as string[],
      proceso: 'cambio_datos',
    };
  }

  // Cola de revisión (en memoria; se pierde al reiniciar)
  agregarARevision(dto: AlertaDto, resultado: unknown) {
    this.cola.push({
      id: `${Date.now()}-${this.cola.length}`,
      recibidoEn: new Date().toISOString(),
      transactionId: dto.alerta?.transactionId,
      resultado,
    });
  }

  listarRevision() {
    return this.cola;
  }

  // =========================================================================
  // NUEVA LÓGICA: POST /decision/monitoreo/desde-correo, DRY_RUN Y LOGS JSONL
  // =========================================================================

  esDryRun(): boolean {
    const raw = process.env.DRY_RUN;
    if (raw === undefined || raw.trim() === '') return true; // Por defecto true (modo sombra)
    return raw.trim().toLowerCase() !== 'false';
  }

  enmascararCedula(cedula: string): string {
    const limpia = String(cedula ?? '').trim();
    if (limpia.length <= 3) return `***${limpia}`;
    return `${'*'.repeat(limpia.length - 3)}${limpia.slice(-3)}`;
  }

  private calcularAccion(decision: Decision, dryRun: boolean): AccionMotor {
    if (decision === 'PASA') return 'ninguna';
    if (decision === 'BLOQUEA') {
      return dryRun ? 'solo_registrar' : 'bloquear';
    }
    // Para ALERTA_HUMANA no hay bloqueo automático en Sumas
    return 'ninguna';
  }

  private registrarEnJsonl(params: {
    transactionId: string;
    cedula: string;
    decision: Decision;
    tipoBloqueo: TipoBloqueo;
    motivo: string;
    senales: string[];
    dryRun: boolean;
    accion: AccionMotor;
  }) {
    const dirLogs = path.resolve(process.cwd(), 'logs');
    if (!fs.existsSync(dirLogs)) {
      fs.mkdirSync(dirLogs, { recursive: true });
    }
    const rutaArchivo = path.join(dirLogs, 'decisiones.jsonl');

    const registro = {
      hora: new Date().toISOString(),
      transactionId: params.transactionId,
      cedula: this.enmascararCedula(params.cedula),
      decision: params.decision,
      tipoBloqueo: params.tipoBloqueo,
      motivo: params.motivo,
      senales: params.senales,
      dryRun: params.dryRun,
      accion: params.accion,
    };

    fs.appendFileSync(rutaArchivo, JSON.stringify(registro) + '\n', 'utf8');
  }

  procesarMonitoreoDesdeCorreo(body: DesdeCorreoDto) {
    const cedula = String(body.cedula ?? '').trim();
    const transactionId = String(body.transactionId ?? '').trim();
    const valorCredito = Number(body.valorCredito ?? 0);
    const esReintento = Boolean(body.esReintento);

    // 1. Duplicados: si el transactionId ya fue decidido, responder { duplicado: true } sin reprocesar
    if (this.transaccionesProcesadas.has(transactionId)) {
      return { duplicado: true };
    }

    const dryRun = this.esDryRun();
    const cliente = this.sumasService.obtenerDatosCliente(cedula);

    // 2. Si la cédula no existe en el mock (o viene marcada como sinInformacion)
    if (!cliente || cliente.sinInformacion) {
      const decision: Decision = 'ALERTA_HUMANA';
      const tipoBloqueo: TipoBloqueo = null;
      const motivo = 'Cliente no encontrado en el sistema';
      const senales: string[] = [];
      const accion = this.calcularAccion(decision, dryRun);

      const dtoInexistente: AlertaDto = {
        alerta: {
          transactionId,
          tienda: body.creCredito || 'Correo Monitoreo',
          monto: valorCredito,
          tipo: 'monitoreo',
          ciudadOrigen: '',
        },
        datos: {
          celular: { reportes: 0, entidades: 0 },
          correo: { reportes: 0, entidades: 0 },
          direccion: { reportes: 0 },
        },
        biometria: { disponible: false, proveedor: 'veriff' },
        historial: { creditosActivos: 0, alDia: false, consumo_pct: 0, comprasPrevias: 0 },
        ciudadesFrecuentes: [],
      };

      const resultado = {
        decision,
        tipoBloqueo,
        motivo,
        senales,
        proceso: 'monitoreo',
        transactionId,
        dryRun,
        accion,
      };

      this.agregarARevision(dtoInexistente, resultado);
      this.transaccionesProcesadas.add(transactionId);
      this.registrarEnJsonl({
        transactionId,
        cedula,
        decision,
        tipoBloqueo,
        motivo,
        senales,
        dryRun,
        accion,
      });

      return resultado;
    }

    // 3. Biometría pendiente: si biometria.disponible es false y esReintento no es true
    if (!cliente.biometria?.disponible && !esReintento) {
      return {
        pendienteBiometria: true,
        decision: null,
      };
    }

    // 4. Armar el AlertaDto desde el mock + valorCredito del correo
    const dto: AlertaDto = {
      alerta: {
        transactionId,
        tienda: cliente.alerta?.tienda || body.creCredito || 'Tienda Sumas',
        monto: valorCredito,
        tipo: 'monitoreo',
        ciudadOrigen: cliente.alerta?.ciudadOrigen ?? '',
      },
      datos: {
        celular: {
          reportes: cliente.celular?.reportes ?? 0,
          entidades: cliente.celular?.entidades ?? 0,
        },
        correo: {
          reportes: cliente.correo?.reportes ?? 0,
          entidades: cliente.correo?.entidades ?? 0,
        },
        direccion: {
          reportes: cliente.direccion?.reportes ?? 0,
        },
      },
      biometria: {
        disponible: Boolean(cliente.biometria?.disponible),
        proveedor: cliente.biometria?.proveedor ?? 'veriff',
        nivelUnicus: (cliente.biometria as { nivelUnicus?: number })?.nivelUnicus,
        estado: cliente.biometria?.estado,
      },
      historial: {
        creditosActivos: cliente.historial?.creditosActivos ?? 0,
        alDia: Boolean(cliente.historial?.alDia),
        consumo_pct: cliente.historial?.consumo_pct ?? 0,
        comprasPrevias: cliente.historial?.comprasPrevias ?? 0,
      },
      ciudadesFrecuentes: cliente.ciudadesFrecuentes ?? [],
    };

    // 5. Evaluar riesgo con las reglas intactas
    const evaluacion = this.evaluarRiesgo(dto, 'monitoreo');
    const accion = this.calcularAccion(evaluacion.decision, dryRun);

    // Si hay bloqueo y DRY_RUN es false, actualizar estado en Sumas con tipoBloqueo
    if (evaluacion.decision === 'BLOQUEA' && !dryRun) {
      this.sumasService.actualizarEstadoCliente({
        cedula,
        decision: evaluacion.decision,
        motivo: evaluacion.motivo,
        transactionId,
        tipoBloqueo: evaluacion.tipoBloqueo,
      });
    }

    const respuestaFinal = {
      ...evaluacion,
      transactionId,
      dryRun,
      accion,
    };

    // Si es ALERTA_HUMANA, agregar a la cola de revisión existente
    if (evaluacion.decision === 'ALERTA_HUMANA') {
      this.agregarARevision(dto, respuestaFinal);
    }

    // Marcar transactionId como procesado y guardar en logs/decisiones.jsonl
    this.transaccionesProcesadas.add(transactionId);
    this.registrarEnJsonl({
      transactionId,
      cedula,
      decision: evaluacion.decision,
      tipoBloqueo: evaluacion.tipoBloqueo,
      motivo: evaluacion.motivo,
      senales: evaluacion.senales,
      dryRun,
      accion,
    });

    return respuestaFinal;
  }
}