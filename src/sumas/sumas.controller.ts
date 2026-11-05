import { Controller, Get, Param, Post, Body } from '@nestjs/common';
import { SumasService } from './sumas.service';

@Controller('sumas')
export class SumasController {
  constructor(private readonly sumasService: SumasService) {}

  @Get('cliente/:cedula')
  obtenerCliente(@Param('cedula') cedula: string) {
    return this.sumasService.obtenerDatosCliente(cedula);
  }

  // Nuevo endpoint que recibe la orden de n8n
  @Post('actualizar-estado')
  actualizarEstado(@Body() payload: { cedula: string, decision: string, motivo: string, transactionId: string }) {
    console.log(`\n=== 🚨 ACTUALIZACIÓN EN SUMAS PARA TI ===`);
    console.log(`Cédula: ${payload.cedula}`);
    console.log(`Decisión Final: ${payload.decision}`);
    console.log(`Motivo: ${payload.motivo}`);
    console.log(`=========================================\n`);
    
    // Aquí a futuro se haría el UPDATE en la base de datos real
    return { 
      success: true, 
      message: `El cliente ${payload.cedula} fue marcado como ${payload.decision} en el sistema central.` 
    };
  }
}
