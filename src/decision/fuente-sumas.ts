import type { AlertaDto, DesdeCorreoDto, Proceso } from './alerta.dto';
import { SumasService } from '../sumas/sumas.service';

/** Único punto a sustituir cuando exista el endpoint real.
 * Hoy SOLO adapta los casos simulados del repositorio. No integra proveedores reales. */
export class FuenteSumas {
  constructor(private readonly sumas: SumasService) {}

  async consultar(body: DesdeCorreoDto, proceso: Proceso): Promise<AlertaDto> {
    const cliente = this.sumas.obtenerDatosCliente(body.cedula);
    const alerta = {
      transactionId: body.transactionId,
      monto: body.valorCredito,
      tipo: proceso,
      tienda: body.creCredito || 'Simulador Sumas',
      ciudadOrigen: cliente.alerta?.ciudadOrigen,
    };
    if (cliente.sinInformacion) return { alerta, carga: 'sin_informacion' };
    // En este mock se supone que los contactos del perfil fueron usados en la solicitud.
    // El adaptador real DEBE obtener los usados de la transacción, no del perfil principal.
    return {
      alerta,
      datos: {
        celular: cliente.celular
          ? { ...cliente.celular, valor: cliente.celularTexto }
          : undefined,
        correo: cliente.correo
          ? { ...cliente.correo, valor: cliente.correoTexto }
          : undefined,
        direccion: cliente.direccion
          ? { ...cliente.direccion, valor: cliente.direccion.descripcion }
          : undefined,
      },
      biometria: cliente.biometria,
      historial: cliente.historial,
      ciudadesFrecuentes: cliente.ciudadesFrecuentes,
    };
  }

  /** Operación síncrona del simulador. El adaptador real debe comprobar EN EL SERVIDOR
   * origen que la solicitud continúa pendiente y dentro del plazo, de forma atómica
   * con el bloqueo y usando transactionId como clave de idempotencia. */
  bloquear(
    body: DesdeCorreoDto,
    resultado: { motivo: string; tipoBloqueo: 'datos' | 'biometria' | null },
    vence: number,
  ) {
    if (Date.now() >= vence) return false;
    const cliente = this.sumas.actualizarEstadoCliente({
      cedula: body.cedula,
      transactionId: body.transactionId,
      decision: 'BLOQUEA',
      motivo: resultado.motivo,
      tipoBloqueo: resultado.tipoBloqueo,
    });
    if (!cliente) throw new Error('No se confirmó el bloqueo simulado');
    return true;
  }
}
