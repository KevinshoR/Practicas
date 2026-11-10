export class AlertaDto {
  alerta: {
    transactionId: string;
    tienda: string;
    monto: number;
    tipo: string;
    ciudadOrigen: string;
  };
  datos: {
    celular: { reportes: number; entidades: number };
    correo: { reportes: number; entidades: number };
    direccion: { reportes: number };
  };
  biometria: {
    disponible: boolean;
    proveedor: string;
    nivelUnicus?: number;
    estado?: string;
  };
  historial: {
    creditosActivos: number;
    alDia: boolean;
    consumo_pct?: number;
    comprasPrevias?: number;
  };
  ciudadesFrecuentes: string[];
}

export class DesdeCorreoDto {
  cedula: string;
  transactionId: string;
  valorCredito: number;
  creCredito: string;
  esReintento?: boolean;
}