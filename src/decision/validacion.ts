import { BadRequestException } from '@nestjs/common';
import type { AlertaDto, DesdeCorreoDto, Proceso } from './alerta.dto';

function error(campo: string): never {
  throw new BadRequestException(`Campo inválido: ${campo}`);
}
function objeto(
  v: unknown,
  campo: string,
): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) error(campo);
}
function texto(v: unknown, campo: string, obligatorio = false) {
  if (v === undefined && !obligatorio) return;
  if (typeof v !== 'string' || v.length > 500 || (obligatorio && !v.trim()))
    error(campo);
}
function numero(v: unknown, campo: string, entero = true, obligatorio = false) {
  if (v == null && !obligatorio) return;
  if (
    typeof v !== 'number' ||
    !Number.isFinite(v) ||
    v < 0 ||
    (entero && !Number.isSafeInteger(v))
  )
    error(campo);
}
function booleano(v: unknown, campo: string) {
  if (v !== undefined && typeof v !== 'boolean') error(campo);
}
export function validarProceso(v: string): asserts v is Proceso {
  if (!['onboarding', 'monitoreo', 'cambio_datos'].includes(v))
    error('proceso');
}
export function normalizarDato(
  v: string,
  tipo: 'celular' | 'correo' | 'direccion',
) {
  if (tipo === 'celular') return v.replace(/[\s()+.-]/g, '');
  return v.trim().toLowerCase().replace(/\s+/g, ' ');
}
export function validarAlerta(dto: AlertaDto) {
  objeto(dto, 'body');
  objeto(dto.alerta, 'alerta');
  texto(dto.alerta.transactionId, 'alerta.transactionId', true);
  numero(dto.alerta.monto, 'alerta.monto', false, true);
  texto(dto.alerta.ciudadOrigen, 'alerta.ciudadOrigen');
  texto(dto.alerta.tienda, 'alerta.tienda');
  if (dto.datos !== undefined) {
    objeto(dto.datos, 'datos');
    for (const tipo of ['celular', 'correo', 'direccion'] as const) {
      const dato = dto.datos[tipo];
      if (dato == null) continue;
      objeto(dato, `datos.${tipo}`);
      texto(dato.valor, `datos.${tipo}.valor`);
      numero(dato.reportes, `datos.${tipo}.reportes`);
      numero(dato.entidades, `datos.${tipo}.entidades`);
    }
  }
  if (dto.historialDatos !== undefined) {
    objeto(dto.historialDatos, 'historialDatos');
    const campos = {
      celulares: 'celular',
      correos: 'correo',
      direcciones: 'direccion',
    } as const;
    for (const campo of Object.keys(campos) as (keyof typeof campos)[]) {
      const lista = dto.historialDatos[campo];
      if (lista === undefined) continue;
      if (!Array.isArray(lista) || lista.length > 1000)
        error(`historialDatos.${campo}`);
      const vistos = new Set<string>();
      for (const dato of lista) {
        objeto(dato, `historialDatos.${campo}[]`);
        texto(dato.valor, `${campo}.valor`, true);
        numero(dato.reportes, `${campo}.reportes`, true, true);
        numero(dato.entidades, `${campo}.entidades`, true, true);
        const clave = normalizarDato(dato.valor, campos[campo]);
        if (!clave || vistos.has(clave))
          error(`${campo}: valor vacío o duplicado`);
        vistos.add(clave);
      }
    }
  }
  if (dto.biometria != null) {
    objeto(dto.biometria, 'biometria');
    if (typeof dto.biometria.disponible !== 'boolean')
      error('biometria.disponible');
    texto(dto.biometria.proveedor, 'biometria.proveedor');
    texto(dto.biometria.estado, 'biometria.estado');
    numero(dto.biometria.nivelUnicus, 'biometria.nivelUnicus', false);
  }
  if (dto.historial != null) {
    objeto(dto.historial, 'historial');
    numero(dto.historial.creditosActivos, 'historial.creditosActivos');
    numero(dto.historial.comprasPrevias, 'historial.comprasPrevias');
    numero(dto.historial.consumo_pct, 'historial.consumo_pct', false);
    booleano(dto.historial.alDia, 'historial.alDia');
  }
  if (dto.ciudadesFrecuentes !== undefined) {
    if (
      !Array.isArray(dto.ciudadesFrecuentes) ||
      dto.ciudadesFrecuentes.length > 1000
    )
      error('ciudadesFrecuentes');
    for (const ciudad of dto.ciudadesFrecuentes)
      texto(ciudad, 'ciudadesFrecuentes[]', true);
  }
  if (
    dto.carga !== undefined &&
    !['completa', 'parcial', 'sin_informacion'].includes(dto.carga)
  )
    error('carga');
}
export function validarSolicitud(body: DesdeCorreoDto, ahora: number) {
  objeto(body, 'body');
  texto(body.cedula, 'cedula', true);
  texto(body.transactionId, 'transactionId', true);
  texto(body.creCredito, 'creCredito');
  numero(body.valorCredito, 'valorCredito', false, true);
  booleano(body.esReintento, 'esReintento');
  booleano(body.soloSimulacion, 'soloSimulacion');
  texto(body.solicitudTomadaEn, 'solicitudTomadaEn', true);
  const inicio = Date.parse(body.solicitudTomadaEn);
  if (
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(
      body.solicitudTomadaEn,
    ) ||
    !Number.isFinite(inicio) ||
    inicio > ahora
  )
    error('solicitudTomadaEn: fecha inválida o futura');
  if (
    body.estadoSolicitud !== undefined &&
    !['PENDIENTE', 'APROBADA', 'RECHAZADA'].includes(body.estadoSolicitud)
  )
    error('estadoSolicitud');
}
