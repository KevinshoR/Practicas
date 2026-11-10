export type Proceso = 'onboarding' | 'monitoreo' | 'cambio_datos';
export type Decision = 'PASA' | 'BLOQUEA' | 'ALERTA_HUMANA';
export type TipoBloqueo = 'datos' | 'biometria' | null;

/** Conteos del dato USADO en la compra. null/undefined = no cargó; 0 = cero confirmado. */
export interface DatoReportado {
  valor?: string;
  reportes?: number | null;
  entidades?: number | null;
}
export interface RegistroHistorico extends DatoReportado {
  valor: string;
  reportes: number;
  entidades: number;
}
export class AlertaDto {
  alerta: {
    transactionId: string;
    tienda?: string;
    monto: number;
    tipo?: string;
    ciudadOrigen?: string;
  };
  datos?: {
    celular?: DatoReportado | null;
    correo?: DatoReportado | null;
    direccion?: DatoReportado | null;
  };
  /** Si se incluyen listas, los conteos se obtienen del registro que coincida con datos.*.valor.
   * [] significa historial consultado sin registros; omitir significa sin detalle histórico.
   * No sumar registros: un crédito puede aparecer en más de un dato. */
  historialDatos?: {
    celulares?: RegistroHistorico[];
    correos?: RegistroHistorico[];
    direcciones?: RegistroHistorico[];
  };
  biometria?: {
    disponible: boolean;
    proveedor?: string;
    nivelUnicus?: number;
    estado?: string;
  } | null;
  historial?: {
    creditosActivos?: number;
    alDia?: boolean;
    consumo_pct?: number;
    comprasPrevias?: number;
  } | null;
  ciudadesFrecuentes?: string[];
  carga?: 'completa' | 'parcial' | 'sin_informacion';
}

export class DesdeCorreoDto {
  cedula: string;
  transactionId: string;
  valorCredito: number;
  creCredito?: string;
  /** Hora ORIGINAL en que Sumas tomó la solicitud, ISO 8601 con zona horaria.
   * Se conserva en el correo y en el reintento. Nunca generar una fecha nueva al reintentar. */
  solicitudTomadaEn: string;
  esReintento?: boolean;
  /** El disparador local exige modo sombra; el servidor rechaza si podría aplicar un bloqueo. */
  soloSimulacion?: boolean;
  estadoSolicitud?: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';
}
