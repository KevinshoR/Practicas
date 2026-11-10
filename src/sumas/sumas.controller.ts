import { Controller, Get, Param, Post, Body } from '@nestjs/common';
import { SumasService, DisparoCompraDto } from './sumas.service';

@Controller('sumas')
export class SumasController {
  constructor(private readonly sumasService: SumasService) {}

  @Get('clientes')
  listarClientes() {
    return this.sumasService.listarClientes();
  }

  @Get('cliente/:cedula')
  obtenerCliente(@Param('cedula') cedula: string) {
    return this.sumasService.obtenerDatosCliente(cedula);
  }

  // Disparador individual: simula una compra en Sumas y envía el correo de alerta a n8n
  @Post('simular-compra')
  async simularCompra(@Body() body: DisparoCompraDto) {
    return this.sumasService.dispararAlertaCorreo(body);
  }

  // Disparador por lote: dispara las 10 cédulas de la tabla de pruebas hacia n8n
  @Post('simular-lote')
  async simularLote(@Body() body?: { webhookUrl?: string }) {
    return this.sumasService.dispararLotePerfilesPrueba(body?.webhookUrl);
  }

  // Endpoint que recibe la confirmación / bloqueo preventivo cuando DRY_RUN=false
  @Post('actualizar-estado')
  actualizarEstado(
    @Body()
    payload: {
      cedula: string;
      decision: string;
      motivo: string;
      transactionId?: string;
      tipoBloqueo?: 'datos' | 'biometria' | null;
    },
  ) {
    console.log(`\n=== 🚨 ACTUALIZACIÓN EN SUMAS PARA TI ===`);
    console.log(`Cédula: ${payload.cedula}`);
    console.log(`Decisión Final: ${payload.decision}`);
    if (payload.tipoBloqueo) {
      console.log(`Tipo de Bloqueo: ${payload.tipoBloqueo}`);
    }
    console.log(`Motivo: ${payload.motivo}`);
    console.log(`=========================================\n`);

    this.sumasService.actualizarEstadoCliente(payload);

    return {
      success: true,
      tipoBloqueo: payload.tipoBloqueo ?? null,
      message: `El cliente ${payload.cedula} fue marcado como ${payload.decision} en el sistema central.`,
    };
  }
}