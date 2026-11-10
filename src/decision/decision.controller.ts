import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { AlertaDto, DesdeCorreoDto } from './alerta.dto';
import { DecisionService } from './decision.service';

@Controller('decision')
export class DecisionController {
  constructor(private readonly decisionService: DecisionService) {}

  private procesar(dto: AlertaDto, proceso: string) {
    const r = this.decisionService.evaluarRiesgo(dto, proceso);
    if (r.decision === 'ALERTA_HUMANA') this.decisionService.agregarARevision(dto, r);
    return r;
  }

  @Post('onboarding')
  evaluarOnboarding(@Body() dto: AlertaDto) {
    return this.procesar(dto, 'onboarding');
  }

  @Post('monitoreo')
  evaluarMonitoreo(@Body() dto: AlertaDto) {
    return this.procesar(dto, 'monitoreo');
  }

  @Post('monitoreo/desde-correo')
  @HttpCode(200)
  evaluarMonitoreoDesdeCorreo(@Body() dto: DesdeCorreoDto) {
    return this.decisionService.procesarMonitoreoDesdeCorreo(dto);
  }

  @Post('cambio_datos')
  evaluarCambioDatos(@Body() dto: AlertaDto) {
    const r = this.decisionService.evaluarCambioDatos(dto);
    this.decisionService.agregarARevision(dto, r);
    return r;
  }

  @Get('revision')
  listarRevision() {
    return this.decisionService.listarRevision();
  }
}