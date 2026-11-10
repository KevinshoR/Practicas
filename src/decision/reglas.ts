import type {
  AlertaDto,
  DatoReportado,
  Decision,
  Proceso,
  RegistroHistorico,
  TipoBloqueo,
} from './alerta.dto';
import { normalizarDato, validarAlerta, validarProceso } from './validacion';

export const VERSION_REGLAS = '2026-11-10-v2';
export const CONFIG = Object.freeze({
  REPORTES_FUERTE: 6,
  MIN_ALTERNATIVO: 5,
  MONTO_ESTRICTO: 1_000_000,
  CONSUMO_ESTRICTO_PCT: 95,
  UNICUS_NORMAL: 5,
  UNICUS_ESTRICTO: 7,
  PLAZO_MS: 180_000,
  REINTENTO_MS: 10_000,
});
const ZONAS = [
  'barranquilla',
  'cartagena',
  'santa marta',
  'soledad',
  'malambo',
  'valledupar',
  'monteria',
  'sincelejo',
  'riohacha',
];
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
type Calidad = 'buena' | 'baja' | 'rechazada' | 'duda' | 'sin_biometria';
export interface ContactoEvaluado {
  reportes: number | null;
  entidades: number | null;
  coincide: boolean | null;
  fuerte: boolean;
  hayOtroFuerte: boolean;
  alternativoSuficiente: boolean;
  incompleto: boolean;
}
export interface Evaluacion {
  decision: Decision;
  tipoBloqueo: TipoBloqueo;
  motivo: string;
  codigo: string;
  senales: string[];
  proceso: Proceso;
  versionReglas: string;
  evidencia: {
    celular: ContactoEvaluado;
    correo: ContactoEvaluado;
    calidadBiometria: Calidad;
    estricto: boolean;
    ubicacionCoincide: boolean;
    historialFavorable: boolean;
    direccionFuerte: boolean;
    datosIncompletos: boolean;
  };
  evaluacionSugerida?: {
    decision: Decision;
    tipoBloqueo: TipoBloqueo;
    codigo: string;
  };
}
function contacto(
  actual: DatoReportado | null | undefined,
  lista: RegistroHistorico[] | undefined,
  tipo: 'celular' | 'correo' | 'direccion',
): ContactoEvaluado {
  let reportes = actual?.reportes ?? null;
  let entidades = actual?.entidades ?? null;
  let coincide: boolean | null = null;
  let hayOtroFuerte = false;
  if (lista !== undefined) {
    const valor = actual?.valor ? normalizarDato(actual.valor, tipo) : '';
    const encontrado = valor
      ? lista.find((x) => normalizarDato(x.valor, tipo) === valor)
      : undefined;
    coincide = valor ? Boolean(encontrado) : null;
    // Una lista cargada sin coincidencia confirma cero; un valor usado desconocido NO lo confirma.
    reportes = valor ? (encontrado?.reportes ?? 0) : null;
    entidades = valor ? (encontrado?.entidades ?? 0) : null;
    hayOtroFuerte = lista.some(
      (x) =>
        x.reportes >= CONFIG.REPORTES_FUERTE &&
        normalizarDato(x.valor, tipo) !== valor,
    );
  }
  return {
    reportes,
    entidades,
    coincide,
    hayOtroFuerte,
    fuerte: reportes !== null && reportes >= CONFIG.REPORTES_FUERTE,
    alternativoSuficiente:
      hayOtroFuerte &&
      ((reportes !== null && reportes >= CONFIG.MIN_ALTERNATIVO) ||
        (entidades !== null && entidades >= CONFIG.MIN_ALTERNATIVO)),
    incompleto:
      reportes === null || (tipo !== 'direccion' && entidades === null),
  };
}
function calidad(b: AlertaDto['biometria'], estricto: boolean): Calidad {
  if (!b?.disponible) return 'sin_biometria';
  const proveedor = norm(b.proveedor ?? '');
  const estado = norm(b.estado ?? '');
  if (proveedor === 'veriff') {
    if (['aprobado', 'approved'].includes(estado)) return 'buena';
    if (['rechazado', 'declined'].includes(estado)) return 'rechazada';
    if (['expirado', 'expired', 'abandonado', 'abandoned'].includes(estado))
      return 'sin_biometria';
    return 'duda';
  }
  if (proveedor === 'unicus') {
    if (b.nivelUnicus === undefined) return 'duda';
    return b.nivelUnicus >=
      (estricto ? CONFIG.UNICUS_ESTRICTO : CONFIG.UNICUS_NORMAL)
      ? 'buena'
      : 'baja';
  }
  return 'duda';
}
export function tieneInformacion(dto: AlertaDto) {
  if (dto.carga === 'sin_informacion') return false;
  return Boolean(
    Object.values(dto.datos ?? {}).some(
      (d) =>
        d &&
        (Boolean(d.valor?.trim()) || d.reportes != null || d.entidades != null),
    ) ||
    Object.values(dto.historialDatos ?? {}).some(
      (lista) => lista && lista.length > 0,
    ) ||
    (dto.historial &&
      Object.values(dto.historial).some((v) => v !== undefined)) ||
    dto.ciudadesFrecuentes?.length,
  );
}
export function informacionIncompleta(dto: AlertaDto) {
  return (
    dto.carga === 'parcial' ||
    !tieneInformacion(dto) ||
    contacto(dto.datos?.celular, dto.historialDatos?.celulares, 'celular')
      .incompleto ||
    contacto(dto.datos?.correo, dto.historialDatos?.correos, 'correo')
      .incompleto ||
    contacto(dto.datos?.direccion, dto.historialDatos?.direcciones, 'direccion')
      .incompleto ||
    dto.historial == null ||
    dto.ciudadesFrecuentes === undefined
  );
}
/** Evaluación pura: no espera, no consulta proveedores y nunca ejecuta un bloqueo.
 * El servicio operativo se encarga del único reintento antes de llamar a esta función. */
export function evaluarReglas(dto: AlertaDto, proceso: string): Evaluacion {
  validarProceso(proceso);
  validarAlerta(dto);
  const cel = contacto(
    dto.datos?.celular,
    dto.historialDatos?.celulares,
    'celular',
  );
  const cor = contacto(
    dto.datos?.correo,
    dto.historialDatos?.correos,
    'correo',
  );
  const dir = contacto(
    dto.datos?.direccion,
    dto.historialDatos?.direcciones,
    'direccion',
  );
  const ciudad = norm(dto.alerta.ciudadOrigen ?? '');
  const estricto =
    dto.alerta.monto >= CONFIG.MONTO_ESTRICTO ||
    (dto.historial?.consumo_pct ?? 0) >= CONFIG.CONSUMO_ESTRICTO_PCT ||
    ZONAS.includes(ciudad);
  // Siempre se examina, incluso si después prevalece un bloqueo por datos.
  const bio = calidad(dto.biometria, estricto);
  const ubicacionCoincide = Boolean(
    ciudad && dto.ciudadesFrecuentes?.some((c) => norm(c) === ciudad),
  );
  const historialFavorable =
    dto.historial?.alDia === true &&
    ((dto.historial.comprasPrevias ?? 0) >= 1 ||
      (dto.historial.creditosActivos ?? 0) >= 1);
  // La dirección fuerte se registra, pero no aprueba por sí sola.
  const respaldoContextual = ubicacionCoincide || historialFavorable;
  const contactoSuficiente =
    cel.fuerte ||
    cor.fuerte ||
    cel.alternativoSuficiente ||
    cor.alternativoSuficiente;
  const senales: string[] = [];
  if (!ubicacionCoincide) senales.push('Sin coincidencia de ciudad');
  if (!historialFavorable)
    senales.push(
      'Sin historial de compras/créditos con pagos al día confirmado',
    );
  if (cel.hayOtroFuerte && !cel.fuerte && !cel.alternativoSuficiente)
    senales.push('Celular usado débil frente a otro celular fuerte');
  if (cor.hayOtroFuerte && !cor.fuerte && !cor.alternativoSuficiente)
    senales.push('Correo usado débil frente a otro correo fuerte');
  if (dto.historialDatos === undefined)
    senales.push(
      'Sin detalle histórico: se confía en que los conteos recibidos pertenecen a los contactos usados',
    );
  if (
    contactoSuficiente &&
    !respaldoContextual &&
    !(cel.reportes && cor.reportes)
  ) {
    senales.push(
      'Un solo contacto suficiente; segundo respaldo recomendado, no obligatorio',
    );
  }
  const evidencia = {
    celular: cel,
    correo: cor,
    calidadBiometria: bio,
    estricto,
    ubicacionCoincide,
    historialFavorable,
    direccionFuerte: dir.fuerte,
    datosIncompletos: informacionIncompleta(dto),
  };
  const r = (
    decision: Decision,
    tipoBloqueo: TipoBloqueo,
    codigo: string,
    motivo: string,
  ): Evaluacion => ({
    decision,
    tipoBloqueo,
    codigo,
    motivo,
    senales,
    proceso,
    versionReglas: VERSION_REGLAS,
    evidencia,
  });
  function estudiar(): Evaluacion {
    if (!tieneInformacion(dto))
      return r(
        'ALERTA_HUMANA',
        null,
        'SIN_INFORMACION',
        'No hay datos del cliente cargados',
      );
    // Un contacto suficiente compensa al otro. Dirección/ciudad/biometría solas no lo sustituyen.
    if (!contactoSuficiente) {
      if (cel.hayOtroFuerte || cor.hayOtroFuerte) {
        return r(
          'BLOQUEA',
          'datos',
          'CONTACTOS_DEBILES_FRENTE_A_HISTORIAL',
          'Ningún contacto usado cumple el mínimo frente a los registros fuertes del historial',
        );
      }
      if (cel.incompleto || cor.incompleto)
        return r(
          'BLOQUEA',
          'datos',
          'CONTACTOS_INCOMPLETOS',
          'Tras consultar los datos, no hay un contacto suficiente y faltan conteos de celular o correo',
        );
      if (cel.reportes === 0 && cor.reportes === 0)
        return r(
          'BLOQUEA',
          'datos',
          'CONTACTOS_SIN_REPORTES',
          'Celular y correo usados sin reportes; los demás respaldos no bastan por sí solos',
        );
      if (
        proceso === 'onboarding' &&
        !(
          (cel.reportes ?? 0) >= 1 &&
          (cor.reportes ?? 0) >= 1 &&
          Math.max(cel.reportes ?? 0, cor.reportes ?? 0) >= 3
        )
      ) {
        return r(
          'BLOQUEA',
          'datos',
          'ONBOARDING_DATOS_INSUFICIENTES',
          'Sin contacto fuerte: onboarding exige un reporte en cada contacto y tres en alguno',
        );
      }
    }
    if (bio === 'duda')
      return r(
        'ALERTA_HUMANA',
        null,
        'BIOMETRIA_INCONCLUSA',
        'Biometría en revisión o inconclusa',
      );
    if (bio === 'rechazada')
      return contactoSuficiente || respaldoContextual
        ? r(
            'ALERTA_HUMANA',
            null,
            'VERIFF_RECHAZADO_CON_RESPALDO',
            'Veriff rechazado con respaldo: revisión humana',
          )
        : r(
            'BLOQUEA',
            'biometria',
            'VERIFF_RECHAZADO_SIN_RESPALDO',
            'Veriff rechazado sin respaldo',
          );
    if (contactoSuficiente)
      return r(
        'PASA',
        null,
        cel.fuerte || cor.fuerte
          ? 'CONTACTO_FUERTE'
          : 'CONTACTO_ALTERNATIVO_SUFICIENTE',
        'Celular o correo usado suficiente; otro respaldo es recomendable, no obligatorio',
      );
    // Para los únicos contactos de respaldo bajo se conserva la matriz anterior.
    if (bio === 'sin_biometria') {
      const cumple22 = (c: ContactoEvaluado) =>
        (c.reportes ?? 0) >= 2 && (c.entidades ?? 0) >= 2;
      if (proceso === 'onboarding' && !estricto)
        return r(
          'PASA',
          null,
          'ONBOARDING_SIN_BIOMETRIA',
          'Onboarding normal con datos suficientes',
        );
      return cumple22(cel) && cumple22(cor)
        ? r(
            'PASA',
            null,
            'CONTACTOS_22',
            'Sin biometría: ambos contactos cumplen dos reportes y dos entidades',
          )
        : r(
            'BLOQUEA',
            'datos',
            'CONTACTOS_NO_CUMPLEN_22',
            'Sin biometría ni contacto fuerte: los contactos no cumplen 2-2',
          );
    }
    if (bio === 'baja')
      return respaldoContextual
        ? r(
            'PASA',
            null,
            'BIOMETRIA_BAJA_CON_RESPALDO',
            'Contactos con reportes y respaldo contextual compensan Unicus bajo',
          )
        : r(
            'BLOQUEA',
            'biometria',
            'BIOMETRIA_BAJA_SIN_RESPALDO',
            'Unicus bajo sin respaldo suficiente',
          );
    if ((cel.reportes ?? 0) < 1 || (cor.reportes ?? 0) < 1)
      return respaldoContextual
        ? r(
            'PASA',
            null,
            'CONTACTO_CON_RESPALDO',
            'Biometría buena y un contacto con reportes respaldado por contexto',
          )
        : r(
            'BLOQUEA',
            'datos',
            'CONTACTO_CERO_SIN_RESPALDO',
            'Un contacto sin reportes y sin respaldo contextual',
          );
    return r(
      'PASA',
      null,
      'CONTACTOS_Y_BIOMETRIA',
      'Ambos contactos con reportes y biometría buena',
    );
  }
  const evaluacion = estudiar();
  if (proceso !== 'cambio_datos') return evaluacion;
  return {
    ...r(
      'ALERTA_HUMANA',
      null,
      'CAMBIO_DATOS',
      'Cambio de datos: revisar vigencia de la línea; datos y biometría ya fueron evaluados',
    ),
    evaluacionSugerida: {
      decision: evaluacion.decision,
      tipoBloqueo: evaluacion.tipoBloqueo,
      codigo: evaluacion.codigo,
    },
  };
}
