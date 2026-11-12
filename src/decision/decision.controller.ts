import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { AlertaDto, DesdeCorreoDto } from './alerta.dto';
import { DecisionService } from './decision.service';

@Controller('decision')
export class DecisionController {
  constructor(private readonly decisionService: DecisionService) {}

  @Post('disparar-n8n')
  async dispararN8n(@Body() body: Record<string, any>) {
    return await this.decisionService.enviarAN8n(body);
  }
  @Post('onboarding')
  evaluarOnboarding(@Body() dto: AlertaDto) {
    return {
      ...this.decisionService.evaluarRiesgo(dto, 'onboarding'),
      soloEvaluacion: true,
    };
  }
  @Post('monitoreo')
  evaluarMonitoreo(@Body() dto: AlertaDto) {
    return {
      ...this.decisionService.evaluarRiesgo(dto, 'monitoreo'),
      soloEvaluacion: true,
    };
  }
  @Post('cambio_datos')
  evaluarCambioDatos(@Body() dto: AlertaDto) {
    return {
      ...this.decisionService.evaluarCambioDatos(dto),
      soloEvaluacion: true,
    };
  }
  @Post('monitoreo/desde-correo')
  @HttpCode(200)
  evaluarMonitoreoDesdeCorreo(@Body() dto: DesdeCorreoDto) {
    return this.decisionService.procesarMonitoreoDesdeCorreo(dto);
  }
  /** Mismo control de plazo, reintento y deduplicación para los tres procesos. */
  @Post('solicitud/:proceso')
  @HttpCode(200)
  procesarSolicitud(
    @Param('proceso') proceso: string,
    @Body() dto: DesdeCorreoDto,
  ) {
    return this.decisionService.procesarSolicitud(dto, proceso);
  }
  @Get('configuracion')
  configuracion() {
    return {
      entorno: 'simulador',
      dryRun: this.decisionService.esDryRun(),
      admiteSoloSimulacion: true,
    };
  }
  @Get('revision')
  listarRevision() {
    return this.decisionService.listarRevision();
  }
}
